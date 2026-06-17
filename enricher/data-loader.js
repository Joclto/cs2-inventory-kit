const fs = require('fs');
const path = require('path');
const https = require('https');

const FILE_TRACKER_REPO = 'ByMykel/counter-strike-file-tracker';

/**
 * 支持的语言关键词（对应 csgo_{lang}.json 文件名）。
 * 用户通过 init({ languages: ['french', 'japanese'] }) 指定额外语言。
 *
 * 完整列表：
 *   brazilian, bulgarian, czech, danish, dutch, english, finnish,
 *   french, german, greek, hungarian, italian, japanese, koreana,
 *   latam, norwegian, polish, portuguese, romanian, russian,
 *   schinese, schinese_pw, spanish, swedish, tchinese, thai,
 *   turkish, ukrainian, vietnamese
 *
 * @type {string[]}
 */
const SUPPORTED_LANGUAGES = [
	'brazilian', 'bulgarian', 'czech', 'danish', 'dutch', 'english', 'finnish',
	'french', 'german', 'greek', 'hungarian', 'italian', 'japanese', 'koreana',
	'latam', 'norwegian', 'polish', 'portuguese', 'romanian', 'russian',
	'schinese', 'schinese_pw', 'spanish', 'swedish', 'tchinese', 'thai',
	'turkish', 'ukrainian', 'vietnamese'
];

// 默认下载的 3 个文件（items_game + schinese + english）
const DEFAULT_FILES = ['items_game.json', 'csgo_schinese.json', 'csgo_english.json'];

class DataLoader {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.cachePath = path.join(dataDir, 'cache.json');
    }

    /**
     * 加载数据，自动检查更新。
     * @param {object} [opts]
     * @param {boolean} [opts.forceUpdate=false] - 强制重新下载
     * @param {string[]} [opts.languages=[]] - 额外语言（如 ['french', 'japanese']）
     * @param {number} [opts.checkIntervalHours=24] - 更新检查间隔
     * @returns {Promise<object>} { itemsGame, schinese, english, extraLanguages, manifestId }
     */
    async load(opts = {}) {
        const { forceUpdate = false, languages = [], checkIntervalHours = 24 } = opts;
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });

        // 构建动态文件列表：默认 3 个 + 额外语言
        const files = [...DEFAULT_FILES];
        const langFileMap = {}; // { french: 'csgo_french.json', ... }
        for (const lang of languages) {
            if (!SUPPORTED_LANGUAGES.includes(lang)) {
                console.warn(`[DataLoader] 不支持的语言: ${lang}，跳过。支持的语言见 SUPPORTED_LANGUAGES`);
                continue;
            }
            const fileName = 'csgo_' + lang + '.json';
            if (!files.includes(fileName)) {
                files.push(fileName);
                langFileMap[lang] = fileName;
            }
        }

        const cache = this.readCache();
        if (checkIntervalHours !== 24) {
            cache.checkIntervalHours = checkIntervalHours;
        }
        await this.checkAndUpdate(cache, forceUpdate, files);

        // 返回加载的数据
        const result = {
            itemsGame: this.readJson('items_game.json'),
            schinese: this.readJson('csgo_schinese.json'),
            english: this.readJson('csgo_english.json'),
            extraLanguages: {},
            manifestId: cache.manifestId,
        };

        // 加载额外语言数据
        for (const [lang, fileName] of Object.entries(langFileMap)) {
            try {
                result.extraLanguages[lang] = this.readJson(fileName);
            } catch (e) {
                console.warn(`[DataLoader] 加载 ${fileName} 失败: ${e.message}`);
            }
        }

        return result;
    }

    async checkAndUpdate(cache, force, files) {
        try {
            await this._doCheckAndUpdate(cache, force, files);
        } catch (err) {
            // 网络失败 fallback：检查默认文件是否都在
            const allDefaultExist = DEFAULT_FILES.every(f => fs.existsSync(path.join(this.dataDir, f)));
            if (allDefaultExist) {
                console.warn(`[DataLoader] 网络检查失败，使用本地缓存: ${err.message}`);
                return;
            }
            throw new Error(`数据加载失败且本地无缓存: ${err.message}`);
        }
    }

    async _doCheckAndUpdate(cache, force, files) {
        // cache 损坏/为空 → 全量重下（首次使用场景）
        if (!cache || !cache.files || Object.keys(cache.files).length === 0) {
            console.log('[DataLoader] 缓存为空或损坏，全量下载');
            force = true;
        }

        const newCache = { ...cache, files: cache.files || {}, checkIntervalHours: cache.checkIntervalHours || 24 };
        let anyChanged = false;
        const now = Date.now();

        for (const file of files) {
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
                const commitInfo = await this.getLatestCommitInfo(DEFAULT_FILES[0]);
                const m = commitInfo.commit?.message?.match(/manifest\s+(\d+)/i);
                if (m) newCache.manifestId = m[1];
                newCache.lastDownloadTime = new Date().toISOString();
            } catch (e) { /* 忽略 manifest 解析失败 */ }
        }

        this.writeCache(newCache);
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

module.exports = { DataLoader, SUPPORTED_LANGUAGES };
