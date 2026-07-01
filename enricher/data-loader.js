/**
 * DataLoader — CSGO-API 数据加载器（并行下载 + 双通道进度通知）
 *
 * 数据源变更：
 *   旧版：ByMykel/counter-strike-file-tracker（items_game.json / csgo_schinese.json / csgo_english.json）
 *   新版：ByMykel/CSGO-API（8 种物品类型 × 中英两语言 = 16 个 JSON 数组）
 *
 * 远程文件布局：
 *   https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/{lang}/{base}.json
 *     {lang} ∈ {zh-CN, en}
 *     {base} ∈ {skins, music_kits, graffiti, keychains, sticker_slabs, highlights, stickers, collectibles}
 *
 * 本地文件名：{base}-{lang}.json（与 Python 版 cs2_data_service._local_file 一致）
 *
 * 特性：
 *   - 并行下载（并发限 8），单文件 3 次重试 + 指数退避（2s → 4s）
 *   - 双通道进度：EventEmitter 事件 + opts.onDownloadProgress 回调
 *   - canary SHA 缓存策略：仅检查 skins-zh-CN.json 的 commit SHA 作为"数据是否更新"信号
 *     （CSGO-API 所有文件同步生成，一处变即全量变），避免触发 GitHub API 速率限制
 *   - manifestId 从仓库根目录 manifestIdUpdate.txt 提取
 *
 * 参考：Python 版 ByMykel/CSGO-API 下载器（cs2_data_service.py）。
 *
 * 仅依赖 Node.js 内置模块（fs, path, https, events）。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');

const CSGO_API_REPO = 'ByMykel/CSGO-API';
const BASE_RAW_URL = `https://raw.githubusercontent.com/${CSGO_API_REPO}/main/public/api`;
const MANIFEST_ID_URL = `https://raw.githubusercontent.com/${CSGO_API_REPO}/main/manifestIdUpdate.txt`;
const GITHUB_API_BASE = `https://api.github.com/repos/${CSGO_API_REPO}/commits`;

const MAX_CONCURRENCY = 8;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 4000]; // 第 1 次失败后等 2s，第 2 次后等 4s，第 3 次失败放弃

/**
 * 16 个端点定义：8 种物品类型 × {zh-CN, en}。
 * key —— load() 返回对象的字段名（itemProcessor 依赖此精确命名）
 * base —— CSGO-API 远程文件名（不含扩展名）+ 本地文件名前缀
 * lang —— 语言子目录（zh-CN / en）
 * label —— 人类可读名称（进度通知用）
 *
 * 每个端点在构造后追加 localFile / remoteUrl 两个派生字段。
 */
const ENDPOINTS = [
    { key: 'skinsZhCN',           base: 'skins',          lang: 'zh-CN', label: '皮肤(中文)' },
    { key: 'skinsEn',             base: 'skins',          lang: 'en',    label: 'Skins(EN)' },
    { key: 'musicKitsZhCN',       base: 'music_kits',     lang: 'zh-CN', label: '音乐盒(中文)' },
    { key: 'musicKitsEn',         base: 'music_kits',     lang: 'en',    label: 'Music Kits(EN)' },
    { key: 'graffitiZhCN',        base: 'graffiti',       lang: 'zh-CN', label: '涂鸦(中文)' },
    { key: 'graffitiEn',          base: 'graffiti',       lang: 'en',    label: 'Graffiti(EN)' },
    { key: 'keychainsZhCN',       base: 'keychains',      lang: 'zh-CN', label: '挂件(中文)' },
    { key: 'keychainsEn',         base: 'keychains',      lang: 'en',    label: 'Keychains(EN)' },
    { key: 'stickerSlabsZhCN',    base: 'sticker_slabs',  lang: 'zh-CN', label: '印花板(中文)' },
    { key: 'stickerSlabsEn',      base: 'sticker_slabs',  lang: 'en',    label: 'Sticker Slabs(EN)' },
    { key: 'highlightsZhCN',      base: 'highlights',     lang: 'zh-CN', label: '高光时刻(中文)' },
    { key: 'highlightsEn',        base: 'highlights',     lang: 'en',    label: 'Highlights(EN)' },
    { key: 'stickersZhCN',        base: 'stickers',       lang: 'zh-CN', label: '印花(中文)' },
    { key: 'stickersEn',          base: 'stickers',       lang: 'en',    label: 'Stickers(EN)' },
    { key: 'collectiblesZhCN',    base: 'collectibles',   lang: 'zh-CN', label: '收藏品(中文)' },
    { key: 'collectiblesEn',      base: 'collectibles',   lang: 'en',    label: 'Collectibles(EN)' },
].map((ep) => ({
    ...ep,
    localFile: `${ep.base}-${ep.lang}.json`,
    remoteUrl: `${BASE_RAW_URL}/${ep.lang}/${ep.base}.json`,
}));

// canary：用 skins-zh-CN.json 的 commit SHA 作为整批数据是否更新的信号
const CANARY = ENDPOINTS.find((ep) => ep.key === 'skinsZhCN');

class DataLoader extends EventEmitter {
    /**
     * @param {string} dataDir 本地数据存储目录
     */
    constructor(dataDir) {
        super();
        this.dataDir = dataDir;
        this.cachePath = path.join(dataDir, 'cache.json');
        /** @type {((payload: object) => void)|null} 便利进度回调通道 */
        this._onDownloadProgress = null;
    }

    /**
     * 加载数据：按需检查更新 → 并行下载 → 读取本地 JSON 返回。
     *
     * @param {object} [opts]
     * @param {boolean} [opts.forceUpdate=false] 强制重新下载全部 16 个文件
     * @param {number}  [opts.checkIntervalHours=24] 更新检查间隔（小时）
     * @param {(payload: {completed:number,total:number,overallPercent:number}) => void} [opts.onDownloadProgress]
     *        便利进度回调：每次整体进度变化时同步调用（与 'progress' 事件等价）
     * @returns {Promise<object>} 16 个 JSON 数组字段 + { manifestId: string|null }
     */
    async load(opts = {}) {
        const { forceUpdate = false, checkIntervalHours = 24, onDownloadProgress } = opts;
        this._onDownloadProgress = typeof onDownloadProgress === 'function' ? onDownloadProgress : null;

        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        const cache = this.readCache();
        if (checkIntervalHours !== 24) {
            cache.checkIntervalHours = checkIntervalHours;
        }
        const interval = cache.checkIntervalHours || checkIntervalHours || 24;

        let manifestId = cache.manifestId || null;

        try {
            const decision = await this._decideUpdate(cache, forceUpdate, interval);

            if (decision.download) {
                // manifestId 与 16 个文件并发获取（失败不阻塞主流程）
                const manifestPromise = this._fetchManifestId().catch((e) => {
                    console.warn(`[DataLoader] manifestId 获取失败: ${e.message}`);
                    return null;
                });

                await this._downloadAllParallel();

                manifestId = await manifestPromise;

                // 记录 canary SHA（代表整批），刷新缓存
                let canarySha = decision.canarySha;
                if (!canarySha) {
                    try {
                        canarySha = await this._getCanarySha();
                    } catch (e) {
                        canarySha = null;
                    }
                }
                const nowIso = new Date().toISOString();
                const newFiles = {};
                for (const ep of ENDPOINTS) {
                    // CSGO-API 所有文件同步生成，canary SHA 代表整批
                    newFiles[ep.localFile] = { commitSha: canarySha, downloadedAt: nowIso };
                }
                cache.version = 1;
                cache.files = newFiles;
                cache.manifestId = manifestId;
                cache.lastDownloadTime = nowIso;
                cache.checkIntervalHours = interval;
                this.writeCache(cache);
            } else if (decision.refreshTimestamp) {
                // 超过间隔但 SHA 未变：仅刷新时间戳，避免每次启动都查 API
                cache.lastDownloadTime = new Date().toISOString();
                cache.checkIntervalHours = interval;
                this.writeCache(cache);
            }
        } catch (err) {
            // 网络失败 fallback：所有默认文件本地存在则使用缓存
            const allExist = ENDPOINTS.every((ep) => fs.existsSync(path.join(this.dataDir, ep.localFile)));
            if (allExist) {
                console.warn(`[DataLoader] 网络检查失败，使用本地缓存: ${err.message}`);
            } else {
                throw new Error(`数据加载失败且本地无完整缓存: ${err.message}`);
            }
        }

        // 从本地文件构建返回结果
        const result = {};
        for (const ep of ENDPOINTS) {
            try {
                result[ep.key] = this.readJson(ep.localFile);
            } catch (e) {
                console.warn(`[DataLoader] 加载 ${ep.localFile} 失败: ${e.message}`);
                result[ep.key] = [];
            }
        }
        result.manifestId = manifestId;

        return result;
    }

    // ============================================================
    // 更新决策（canary SHA 策略）
    // ============================================================

    /**
     * 决定是否需要下载。
     * @returns {Promise<{download:boolean, canarySha?:string|null, refreshTimestamp?:boolean}>}
     */
    async _decideUpdate(cache, force, interval) {
        // 缓存为空/损坏 → 全量下载
        if (!cache || !cache.files || Object.keys(cache.files).length === 0) {
            console.log('[DataLoader] 缓存为空或损坏，全量下载');
            return { download: true };
        }

        if (force) {
            console.log('[DataLoader] forceUpdate=true，全量下载');
            return { download: true };
        }

        // 本地文件缺失 → 全量下载
        const missing = ENDPOINTS.filter((ep) => !fs.existsSync(path.join(this.dataDir, ep.localFile)));
        if (missing.length > 0) {
            console.log(`[DataLoader] ${missing.length} 个本地文件缺失，全量下载`);
            return { download: true };
        }

        // 检查时间间隔
        const now = Date.now();
        const lastDownload = cache.lastDownloadTime ? new Date(cache.lastDownloadTime).getTime() : 0;
        const hoursSince = (now - lastDownload) / (3600 * 1000);

        if (hoursSince >= interval) {
            // 超过间隔 → 查 canary SHA
            let canarySha = null;
            try {
                canarySha = await this._getCanarySha();
            } catch (e) {
                // GitHub API 失败：保守起见不重下（本地文件齐全），仅刷新时间戳
                console.warn(`[DataLoader] canary SHA 查询失败（${e.message}），保持本地缓存`);
                return { download: false, refreshTimestamp: true };
            }
            const storedSha = cache.files[CANARY.localFile] && cache.files[CANARY.localFile].commitSha;
            if (canarySha && canarySha !== storedSha) {
                console.log(`[DataLoader] canary SHA 变化（${storedSha || '无'} → ${canarySha}），全量更新`);
                return { download: true, canarySha };
            }
            console.log(`[DataLoader] 超过 ${interval}h 但 canary SHA 未变，刷新时间戳`);
            return { download: false, refreshTimestamp: true };
        }

        console.log(`[DataLoader] 缓存有效（${hoursSince.toFixed(1)}h 内下载过），跳过更新`);
        return { download: false };
    }

    /**
     * 查询 canary 文件（public/api/zh-CN/skins.json）最新 commit SHA。
     * @returns {Promise<string|null>}
     */
    async _getCanarySha() {
        const url = `${GITHUB_API_BASE}?path=public/api/zh-CN/skins.json&per_page=1`;
        const data = await this.httpGetJson(url);
        return data && data[0] && data[0].sha ? data[0].sha : null;
    }

    /**
     * 获取 manifestId（仓库根目录 manifestIdUpdate.txt 纯文本内容）。
     * @returns {Promise<string>}
     */
    _fetchManifestId() {
        return new Promise((resolve, reject) => {
            const req = https.get(
                MANIFEST_ID_URL,
                { headers: { 'User-Agent': 'cs2-inventory-kit' }, timeout: 10000 },
                (res) => {
                    if (res.statusCode !== 200) {
                        res.resume();
                        reject(new Error(`HTTP ${res.statusCode} for manifestIdUpdate.txt`));
                        return;
                    }
                    let data = '';
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () => resolve(data.trim()));
                }
            );
            req.on('error', reject);
            req.on('timeout', () => req.destroy(new Error('manifestId request timeout')));
        });
    }

    // ============================================================
    // 并行下载（并发限 MAX_CONCURRENCY）
    // ============================================================

    /**
     * 并行下载全部 16 个端点，并发上限 MAX_CONCURRENCY。
     * 发射 downloadStart / fileProgress / progress / fileError / downloadDone 事件。
     * 单文件失败不阻塞其他文件。
     * @returns {Promise<object>} { [key]: { ok, bytes, error } }
     */
    async _downloadAllParallel() {
        const total = ENDPOINTS.length;
        const perFileFraction = {}; // key -> 0..1（用于整体百分比平滑计算）
        const results = {};
        let completed = 0;

        for (const ep of ENDPOINTS) perFileFraction[ep.key] = 0;

        this.emit('downloadStart', {
            files: ENDPOINTS.map((ep) => ({ key: ep.key, label: ep.label })),
            total,
        });

        const emitOverall = () => {
            const sum = Object.values(perFileFraction).reduce((a, b) => a + b, 0);
            const overallPercent = total > 0 ? Math.round((sum / total) * 100) : 100;
            this._emitProgress({ completed, total, overallPercent });
        };

        emitOverall(); // 起始 0%

        await this._runWithConcurrency(ENDPOINTS, MAX_CONCURRENCY, async (ep) => {
            const res = await this._downloadOneWithRetry(ep, (phase, extra) => {
                // 单文件进度（节流已在 _downloadFile 内完成）
                this.emit('fileProgress', { key: ep.key, label: ep.label, phase, ...extra });
                if (phase === 'downloading' && extra.percent != null) {
                    perFileFraction[ep.key] = extra.percent / 100;
                }
                emitOverall();
            });

            results[ep.key] = res;
            if (res.ok) {
                completed++;
                perFileFraction[ep.key] = 1;
            }
            emitOverall();
        });

        const succeeded = Object.values(results).filter((r) => r.ok).length;
        const failed = total - succeeded;
        this.emit('downloadDone', {
            results: ENDPOINTS.map((ep) => ({
                key: ep.key,
                label: ep.label,
                ok: results[ep.key].ok,
                bytes: results[ep.key].bytes,
                error: results[ep.key].error,
            })),
            succeeded,
            failed,
        });

        return results;
    }

    /**
     * 并发池：启动最多 limit 个 worker，每个 worker 从共享索引拉取任务。
     * @template T
     * @param {T[]} items
     * @param {number} limit
     * @param {(item: T) => Promise<void>} worker
     */
    async _runWithConcurrency(items, limit, worker) {
        let index = 0;
        const workerCount = Math.min(limit, items.length);
        const workers = [];
        for (let i = 0; i < workerCount; i++) {
            workers.push(
                (async () => {
                    while (true) {
                        const myIndex = index++;
                        if (myIndex >= items.length) break;
                        await worker(items[myIndex]);
                    }
                })()
            );
        }
        await Promise.all(workers);
    }

    /**
     * 下载单个端点：最多 MAX_ATTEMPTS 次，失败指数退避（2s → 4s）。
     * 每次失败发射 'fileError' 事件（非最终放弃）。
     * @param {object} ep 端点定义
     * @param {(phase:string, extra:object) => void} onProgress 文件进度回调
     * @returns {Promise<{ok:boolean, bytes:number, error:string|null}>}
     */
    async _downloadOneWithRetry(ep, onProgress) {
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const bytes = await this._downloadFile(ep, onProgress);
                return { ok: true, bytes, error: null };
            } catch (err) {
                lastError = err;
                this.emit('fileError', {
                    key: ep.key,
                    label: ep.label,
                    error: err.message,
                    attempt,
                });
                if (attempt < MAX_ATTEMPTS) {
                    await this._sleep(RETRY_DELAYS_MS[attempt - 1]);
                }
            }
        }
        // 全部重试耗尽
        onProgress('error', {});
        return { ok: false, bytes: 0, error: lastError ? lastError.message : 'unknown error' };
    }

    /**
     * 流式下载单个文件到本地，附带字节级进度通知（节流：percent 变化 ≥10% 才发射）。
     * 无 content-length 时只报 phase，不报 percent。
     * @param {object} ep 端点定义
     * @param {(phase:string, extra:object) => void} onProgress
     * @returns {Promise<number>} 已下载字节数
     */
    _downloadFile(ep, onProgress) {
        return new Promise((resolve, reject) => {
            const dest = path.join(this.dataDir, ep.localFile);
            const file = fs.createWriteStream(dest);
            let bytesDownloaded = 0;
            let bytesTotal = 0;
            let lastPercent = -1;
            let settled = false;

            const fail = (err) => {
                if (settled) return;
                settled = true;
                file.destroy();
                try { fs.unlinkSync(dest); } catch (_) { /* 忽略清理失败 */ }
                reject(err);
            };

            onProgress('pending', {});

            const req = https.get(
                ep.remoteUrl,
                { headers: { 'User-Agent': 'cs2-inventory-kit' }, timeout: 30000 },
                (res) => {
                    if (res.statusCode !== 200) {
                        fail(new Error(`HTTP ${res.statusCode} for ${ep.localFile}`));
                        res.resume();
                        return;
                    }

                    bytesTotal = parseInt(res.headers['content-length'] || '0', 10) || 0;

                    // 起始 downloading（有 content-length 则带 percent:0）
                    onProgress(
                        'downloading',
                        bytesTotal > 0 ? { bytesDownloaded: 0, bytesTotal, percent: 0 } : {}
                    );

                    res.on('data', (chunk) => {
                        bytesDownloaded += chunk.length;
                        if (bytesTotal > 0) {
                            const percent = Math.min(
                                Math.floor((bytesDownloaded / bytesTotal) * 100),
                                100
                            );
                            // 节流：percent 变化 ≥10% 或到达 100% 才发射
                            if (percent - lastPercent >= 10 || percent >= 100) {
                                lastPercent = percent;
                                onProgress('downloading', { bytesDownloaded, bytesTotal, percent });
                            }
                        }
                        // 无 content-length：只报 phase 变化，避免事件风暴
                    });

                    res.pipe(file);

                    file.on('finish', () => {
                        file.close((closeErr) => {
                            if (settled) return;
                            if (closeErr) {
                                fail(new Error(`close error for ${ep.localFile}: ${closeErr.message}`));
                                return;
                            }
                            settled = true;
                            onProgress('done', { bytesDownloaded: bytesDownloaded || bytesTotal });
                            resolve(bytesDownloaded);
                        });
                    });

                    file.on('error', (err) => {
                        fail(new Error(`write error for ${ep.localFile}: ${err.message}`));
                    });
                }
            );

            req.on('error', (err) => {
                fail(new Error(`request error for ${ep.localFile}: ${err.message}`));
            });

            req.on('timeout', () => {
                fail(new Error(`timeout for ${ep.localFile}`));
            });
        });
    }

    // ============================================================
    // 进度通知（双通道：EventEmitter + onDownloadProgress 回调）
    // ============================================================

    /**
     * 发射 'progress' 事件并同步调用 onDownloadProgress 回调（若提供）。
     * @param {{completed:number, total:number, overallPercent:number}} payload
     */
    _emitProgress(payload) {
        this.emit('progress', payload);
        if (this._onDownloadProgress) {
            try {
                this._onDownloadProgress(payload);
            } catch (e) {
                console.warn(`[DataLoader] onDownloadProgress 回调异常: ${e.message}`);
            }
        }
    }

    // ============================================================
    // 工具方法
    // ============================================================

    /**
     * 同步读取并解析本地 JSON 文件。
     * @param {string} file 文件名（相对 dataDir）
     * @returns {object|Array}
     */
    readJson(file) {
        return JSON.parse(fs.readFileSync(path.join(this.dataDir, file), 'utf8'));
    }

    /**
     * 读取 cache.json；损坏/不存在返回空骨架。
     * @returns {{version?:number, files?:object, manifestId?:string|null, lastDownloadTime?:string, checkIntervalHours?:number}}
     */
    readCache() {
        try {
            return JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        } catch (_) {
            return { version: 1, files: {} };
        }
    }

    /**
     * 写入 cache.json。
     * @param {object} cache
     */
    writeCache(cache) {
        fs.writeFileSync(this.cachePath, JSON.stringify(cache, null, 2));
    }

    /**
     * GET 请求并解析 JSON（GitHub API / 其他 JSON 端点）。
     * @param {string} url
     * @returns {Promise<object>}
     */
    httpGetJson(url) {
        return new Promise((resolve, reject) => {
            const req = https.get(
                url,
                { headers: { 'User-Agent': 'cs2-inventory-kit' }, timeout: 10000 },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(e);
                        }
                    });
                }
            );
            req.on('error', reject);
            req.on('timeout', () => req.destroy(new Error('request timeout')));
        });
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = { DataLoader };
