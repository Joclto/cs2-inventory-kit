const fs = require('fs');
const path = require('path');
const https = require('https');

const FILE_TRACKER_REPO = 'ByMykel/counter-strike-file-tracker';
const FILES = ['items_game.json', 'csgo_schinese.json', 'csgo_english.json'];

class DataLoader {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.cachePath = path.join(dataDir, 'cache.json');
    }

    async load(opts = {}) {
        const { forceUpdate = false } = opts;
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });

        const cache = this.readCache();
        await this.checkAndUpdate(cache, forceUpdate);

        // 返回加载的数据 + manifest 信息
        const result = {
            itemsGame: this.readJson('items_game.json'),
            schinese: this.readJson('csgo_schinese.json'),
            english: this.readJson('csgo_english.json'),
            manifestId: cache.manifestId,
        };

        return result;
    }

    async checkAndUpdate(cache, force) {
        try {
            await this._doCheckAndUpdate(cache, force);
        } catch (err) {
            // 网络失败 fallback
            const allFilesExist = FILES.every(f => fs.existsSync(path.join(this.dataDir, f)));
            if (allFilesExist) {
                console.warn(`[DataLoader] 网络检查失败，使用本地缓存: ${err.message}`);
                return;
            }
            throw new Error(`数据加载失败且本地无缓存: ${err.message}`);
        }
    }

    async _doCheckAndUpdate(cache, force) {
        // cache 损坏/为空 → 全量重下（首次使用场景）
        if (!cache || !cache.files || Object.keys(cache.files).length === 0) {
            console.log('[DataLoader] 缓存为空或损坏，全量下载');
            force = true;
        }

        const newCache = { ...cache, files: cache.files || {}, checkIntervalHours: cache.checkIntervalHours || 24 };
        let anyChanged = false;
        const now = Date.now();

        for (const file of FILES) {
            const localPath = path.join(this.dataDir, file);

            // 本地不存在的文件必须下载
            if (!fs.existsSync(localPath)) {
                console.log(`[DataLoader] ${file} 本地缺失，下载中...`);
                await this.downloadFile(file);
                const commitInfo = await this.getLatestCommitInfo(file);
                newCache.files[file] = {
                    commitSha: commitInfo.sha,
                    downloadedAt: new Date().toISOString(),
                };
                anyChanged = true;
                continue;
            }

            // 已有文件：查 SHA + 24h 双条件
            const latestSha = await this.getLatestCommitSha(file);
            const fileInfo = newCache.files[file];
            const currentSha = fileInfo?.commitSha;
            const lastDownload = fileInfo?.downloadedAt ? new Date(fileInfo.downloadedAt).getTime() : 0;
            const hoursSinceDownload = (now - lastDownload) / (3600 * 1000);
            const exceededTimeout = hoursSinceDownload >= (newCache.checkIntervalHours || 24);

            if (force || latestSha !== currentSha || exceededTimeout) {
                const reasons = [];
                if (force) reasons.push('强制');
                if (latestSha !== currentSha) reasons.push(`SHA 变化（${currentSha || '无'} → ${latestSha}）`);
                if (exceededTimeout) reasons.push(`超过 ${newCache.checkIntervalHours}h（已 ${hoursSinceDownload.toFixed(1)}h）`);
                console.log(`[DataLoader] ${file} 需要更新，原因: ${reasons.join('，')}`);
                await this.downloadFile(file);
                newCache.files[file] = {
                    commitSha: latestSha,
                    downloadedAt: new Date().toISOString(),
                };
                anyChanged = true;
            } else {
                console.log(`[DataLoader] ${file} 已是最新（SHA 未变，${hoursSinceDownload.toFixed(1)}h 内下载过）`);
            }
        }

        // 记录 manifest ID 和 lastDownloadTime
        if (anyChanged) {
            try {
                const commitInfo = await this.getLatestCommitInfo(FILES[0]);
                const m = commitInfo.commit?.message?.match(/manifest\s+(\d+)/i);
                if (m) newCache.manifestId = m[1];
                newCache.lastDownloadTime = new Date().toISOString();
            } catch (e) { /* 忽略 manifest 解析失败 */ }
        }

        this.writeCache(newCache);
        // 更新外部传入的 cache 引用（供 load() 读取 manifestId）
        Object.assign(cache, newCache);
    }

    getLatestCommitSha(file) {
        const url = `https://api.github.com/repos/${FILE_TRACKER_REPO}/commits?path=static/${file}&per_page=1`;
        return this.httpGetJson(url).then(d => d[0]?.sha);
    }

    getLatestCommitInfo(file) {
        const url = `https://api.github.com/repos/${FILE_TRACKER_REPO}/commits?path=static/${file}&per_page=1`;
        return this.httpGetJson(url).then(d => d[0]);
    }

    downloadFile(file) {
        const url = `https://raw.githubusercontent.com/${FILE_TRACKER_REPO}/main/static/${file}`;
        const dest = path.join(this.dataDir, file);
        return new Promise((resolve, reject) => {
            const f = fs.createWriteStream(dest);
            https.get(url, { headers: { 'User-Agent': 'cs2-inventory-kit' }, timeout: 30000 }, (res) => {
                if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${file}`)); return; }
                res.pipe(f);
                f.on('finish', () => { f.close(); resolve(); });
            }).on('error', reject);
        });
    }

    readJson(file) {
        return JSON.parse(fs.readFileSync(path.join(this.dataDir, file), 'utf8'));
    }

    readCache() {
        try { return JSON.parse(fs.readFileSync(this.cachePath, 'utf8')); }
        catch { return { version: 1, files: {} }; }
    }

    writeCache(cache) {
        fs.writeFileSync(this.cachePath, JSON.stringify(cache, null, 2));
    }

    httpGetJson(url) {
        return new Promise((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'cs2-inventory-kit' }, timeout: 10000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(e); }
                });
            }).on('error', reject);
        });
    }
}

module.exports = { DataLoader };
