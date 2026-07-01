# CS2 物品解析逻辑参考

> **更新日期**: 2026-07-01
> **数据源版本**: [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) `main` 分支
> **对齐参考实现**: `cs2_db_manager/src/services/inventory_parser_service.py`（Python）

本文件详细阐述 `cs2-inventory-kit` enricher 模块（`enricher/data-loader.js` + `enricher/itemProcessor.js`）的解析逻辑，涵盖数据源下载、内存索引构建、单品富化流水线、8 种物品类型分支路由、属性字节解码、StatTrak/Souvenir 名称拼接、挂件判定、磨损分段，以及 marks 外置注入机制。

> 阅读前置：熟悉 [`node-globaloffensive`](https://github.com/DoctorMcKay/node-globaloffensive) 的 inventory/item 对象结构。本文聚焦"GC 给一条原始物品 row 后，如何被加工成富化对象"。

---

## 目录

1. [概述](#1-概述)
2. [数据源与下载](#2-数据源与下载)
3. [查找索引构建](#3-查找索引构建)
4. [processItem 输出字段 Schema](#4-processitem-输出字段-schema)
5. [物品类型分支路由](#5-物品类型分支路由)
6. [StatTrak / Souvenir 拼接规则](#6-stattrak--souvenir-拼接规则)
7. [挂件解析](#7-挂件解析)
8. [磨损分段](#8-磨损分段)
9. [marks 外置注入机制](#9-marks-外置注入机制)
10. [init() 选项与事件](#10-init-选项与事件)
11. [已删除的功能（迁移注意）](#11-已删除的功能迁移注意)

---

## 1. 概述

### 1.1 数据源变更

本项目近期完成了一次重大架构简化，核心变更是**数据源切换**：

| 维度 | 旧版 | 新版 |
|---|---|---|
| 数据源仓库 | `ByMykel/counter-strike-file-tracker` | `ByMykel/CSGO-API` |
| 数据形态 | 原始 VDF 转 JSON（`items_game.json` + 翻译表 `csgo_{lang}.json`） | 预处理结构化 JSON（16 个数组文件） |
| 语言支持 | 29 种语言 | 中英双语（`zh-CN` + `en`） |
| 翻译查表 | `getTranslation(key)` 查 `#SFUI_WPN_*` 等 token | 无，CSGO-API 已内置中英文名 |
| 字段语言 | Valve 标识符（`ancient_weapon`）+ 可选 `*_local` | 直接中文（`隐秘级`） |

### 1.2 设计理念

CSGO-API 是社区维护的预处理数据集，把原始 `items_game.txt` VDF 和翻译表提前合并成了按物品类型分类的 JSON 数组，字段已经是人类可读的中英文名。这意味着解析器不再需要：

解析 VDF / 抽取 `items_game` 的 11 个段落
维护翻译字典（`#SFUI_*` token → 显示名）
处理 29 种语言的查表 fallback

解析器的工作变成了：按 `(weapon_id, paint_index)` 或 `def_index` 在预处理数组中直接查条目，拿到已经是中文的 `name` / `rarity.name` / `crates[0].name` 等字段。

### 1.3 与 cs2_db_manager 的对齐

Node 版 `ItemProcessor` 的输出语义与 Python 参考实现 `cs2_db_manager` 的 `InventoryParserService.process_item` 精确对齐。两个实现共享：

相同的 7 个内存索引结构
相同的 8 种物品类型分支路由
相同的 StatTrak / Souvenir 名称拼接规则
相同的磨损分段阈值和中英文名
相同的 recipe 计算公式（`rarity - 1`，`quality==9` 时 `+10`）

唯一差异：Node 版的 marks 映射完全外置（由 `init({marks})` 注入），Python 版内置了 `RARITY_NAME_TO_MARK` / `QUALITY_MAP` / `WEAR_MARKS` 三张硬编码表。

---

## 2. 数据源与下载

对应文件：`enricher/data-loader.js`

### 2.1 16 个端点

CSGO-API 按"物品类型 × 语言"组织数据，共 8 种物品类型 × 中英双语 = **16 个 JSON 端点**：

| key（内存字段名） | base（远程文件名） | lang | 本地文件名 | 中文标签 |
|---|---|---|---|---|
| `skinsZhCN` | `skins` | `zh-CN` | `skins-zh-CN.json` | 皮肤(中文) |
| `skinsEn` | `skins` | `en` | `skins-en.json` | Skins(EN) |
| `musicKitsZhCN` | `music_kits` | `zh-CN` | `music_kits-zh-CN.json` | 音乐盒(中文) |
| `musicKitsEn` | `music_kits` | `en` | `music_kits-en.json` | Music Kits(EN) |
| `graffitiZhCN` | `graffiti` | `zh-CN` | `graffiti-zh-CN.json` | 涂鸦(中文) |
| `graffitiEn` | `graffiti` | `en` | `graffiti-en.json` | Graffiti(EN) |
| `keychainsZhCN` | `keychains` | `zh-CN` | `keychains-zh-CN.json` | 挂件(中文) |
| `keychainsEn` | `keychains` | `en` | `keychains-en.json` | Keychains(EN) |
| `stickerSlabsZhCN` | `sticker_slabs` | `zh-CN` | `sticker_slabs-zh-CN.json` | 印花板(中文) |
| `stickerSlabsEn` | `sticker_slabs` | `en` | `sticker_slabs-en.json` | Sticker Slabs(EN) |
| `highlightsZhCN` | `highlights` | `zh-CN` | `highlights-zh-CN.json` | 高光时刻(中文) |
| `highlightsEn` | `highlights` | `en` | `highlights-en.json` | Highlights(EN) |
| `stickersZhCN` | `stickers` | `zh-CN` | `stickers-zh-CN.json` | 印花(中文) |
| `stickersEn` | `stickers` | `en` | `stickers-en.json` | Stickers(EN) |
| `collectiblesZhCN` | `collectibles` | `zh-CN` | `collectibles-zh-CN.json` | 收藏品(中文) |
| `collectiblesEn` | `collectibles` | `en` | `collectibles-en.json` | Collectibles(EN) |

### 2.2 URL 模式

所有端点遵循统一的 URL 模式：

```
https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/{lang}/{base}.json
```

其中 `{lang}` 为 `zh-CN` 或 `en`，`{base}` 为上表第二列（如 `skins`、`music_kits`）。

### 2.3 本地存储

文件下载到 `{dataDir}/` 目录（默认 `./cs2-inventory-schema/`），文件名格式为 `{base}-{lang}.json`。例如 `skins-zh-CN.json`、`music_kits-en.json`。

此外还有一个缓存元数据文件 `cache.json`，记录每个文件的 commit SHA、下载时间戳和 manifestId。

### 2.4 并行下载

16 个文件并行下载，关键参数（均为代码内常量，不可配置）：

| 参数 | 值 | 说明 |
|---|---|---|
| `MAX_CONCURRENCY` | 8 | 同时最多 8 个 HTTP 请求 |
| `MAX_ATTEMPTS` | 3 | 单文件最多重试 3 次 |
| `RETRY_DELAYS_MS` | `[2000, 4000]` | 第 1 次失败后等 2s，第 2 次后等 4s，第 3 次失败放弃 |

并发模型是一个共享索引的 worker 池：启动最多 8 个 worker，每个 worker 从共享计数器拉取下一个待下载端点，直到全部完成。单文件失败不阻塞其他文件。

下载使用流式写入（`https.get` → `res.pipe(file)`），并在传输过程中按字节计算进度。

### 2.5 进度通知（双通道）

进度通知提供两个并行通道，调用方按需选用：

#### 通道一：EventEmitter 事件

DataLoader 内部发射以下事件，`index.js` 会把它们转发到 `GlobalOffensive` 实例上：

| 事件名 | 触发时机 | payload |
|---|---|---|
| `downloadStart` | 并行下载开始 | `{ files: [{key, label}], total: 16 }` |
| `fileProgress` | 单文件进度变化（节流：percent 变化 >= 10% 才发射） | `{ key, label, phase, ...extra }` |
| `progress` | 整体进度变化（每次 fileProgress 后聚合计算） | `{ completed, total, overallPercent }` |
| `fileError` | 单文件某次尝试失败（非最终放弃） | `{ key, label, error, attempt }` |
| `downloadDone` | 全部下载完成 | `{ results: [{key, label, ok, bytes, error}], succeeded, failed }` |

`fileProgress` 的 `phase` 字段取值：

| phase | 含义 | extra 字段 |
|---|---|---|
| `pending` | 请求发出前 | 无 |
| `downloading` | 传输中 | `bytesDownloaded`, `bytesTotal`, `percent`（有 content-length 时） |
| `done` | 文件写入完成 | `bytesDownloaded` |
| `error` | 重试耗尽 | 无 |

> 节流规则：`percent` 变化达到 10% 或到达 100% 时才发射 `fileProgress`。没有 `content-length` 响应头时只报 phase 变化，不报 percent，避免事件风暴。

#### 通道二：回调函数

```js
csgo.init({
    onDownloadProgress: (payload) => {
        // payload: { completed, total, overallPercent }
        console.log(`下载进度: ${payload.overallPercent}%`);
    }
});
```

与 `progress` 事件等价，适合不想用 EventEmitter 的场景。

#### 事件监听示例

```js
const GlobalOffensive = require('cs2-inventory-kit');
const csgo = new GlobalOffensive(user);

csgo.on('downloadStart', (info) => {
    console.log(`开始下载 ${info.total} 个数据文件`);
});

csgo.on('downloadProgress', (info) => {
    console.log(`整体进度: ${info.completed}/${info.total} (${info.overallPercent}%)`);
});

csgo.on('fileError', (info) => {
    console.warn(`文件 ${info.label} 第 ${info.attempt} 次失败: ${info.error}`);
});

csgo.on('downloadDone', (info) => {
    console.log(`下载完成: 成功 ${info.succeeded}, 失败 ${info.failed}`);
});
```

### 2.6 缓存策略：canary SHA 检查

CSGO-API 的所有 16 个文件由同一套脚本同步生成并提交，因此"一处变更即全量变更"。基于这个特性，缓存策略只检查**一个文件**（`skins-zh-CN.json`）的 GitHub commit SHA 作为整批数据的更新信号，避免对 16 个文件分别查 SHA 触发 GitHub API 速率限制。

这个被选中的文件称为 **canary**（金丝雀），定义在代码中：

```js
const CANARY = ENDPOINTS.find((ep) => ep.key === 'skinsZhCN');
```

更新决策流程（`_decideUpdate` 方法）：

```
1. cache.json 不存在或 files 为空    → 全量下载
2. forceUpdate = true                → 全量下载
3. 16 个本地文件有缺失               → 全量下载
4. 距上次下载 >= checkIntervalHours  → 查 canary SHA:
     a. SHA 变了                     → 全量下载
     b. SHA 没变                     → 仅刷新时间戳，不下载
     c. SHA 查询失败（网络/GitHub）   → 保守不重下，仅刷新时间戳
5. 距上次下载 < checkIntervalHours   → 跳过，用缓存
```

下载完成后，canary SHA 会统一写入所有 16 个文件的 `commitSha` 字段（代表整批）。

### 2.7 manifestId

manifestId 从仓库根目录的 `manifestIdUpdate.txt` 纯文本文件获取：

```
https://raw.githubusercontent.com/ByMykel/CSGO-API/main/manifestIdUpdate.txt
```

获取失败不阻塞主流程，`manifestId` 会是 `null`。这个值代表 CS2 当前 depot 的 Steam manifest 版本号，用于判断数据是否对应当前游戏版本。

### 2.8 网络失败回退

GitHub API 或文件下载失败时，只要 16 个本地文件全部存在，就使用本地缓存继续启动。只有本地缓存也不完整时才抛错。

### 2.9 缓存文件结构

`cache.json` 的结构：

```json
{
    "version": 1,
    "files": {
        "skins-zh-CN.json": { "commitSha": "abc123", "downloadedAt": "2026-07-01T..." },
        "skins-en.json": { "commitSha": "abc123", "downloadedAt": "2026-07-01T..." }
    },
    "manifestId": "1234567890",
    "lastDownloadTime": "2026-07-01T...",
    "checkIntervalHours": 24
}
```

---

## 3. 查找索引构建

对应文件：`enricher/itemProcessor.js` 的 `constructor`。

DataLoader 加载完 16 个 JSON 数组后，`ItemProcessor` 在构造函数中把它们重新组织为 7 个查找索引。

### 3.1 索引总览

| 索引名 | 类型 | key 格式 | value | 数据来源 |
|---|---|---|---|---|
| `_enById` | `Object` | `id`（字符串，如 `"skin-1_0"`） | 英文 entry（含 `name` 字段） | 8 个英文 JSON 合并 |
| `_skinIndex` | `Map` | `weapon_id + \u0000 + paint_index` | 中文 skin entry | `skinsZhCN` |
| `_musicIndex` | `Object` | `def_index`（字符串） | 中文 music_kit entry | `musicKitsZhCN` |
| `_keychainIndex` | `Object` | `def_index`（字符串） | 中文 keychain entry | `keychainsZhCN` |
| `_stickerSlabIndex` | `Object` | `def_index`（字符串） | 中文 sticker_slab entry | `stickerSlabsZhCN` |
| `_highlightIndex` | `Object` | `def_index`（字符串） | 中文 highlight entry | `highlightsZhCN` |
| `_stickerIndex` | `Object` | `def_index`（字符串） | 中文 sticker entry | `stickersZhCN` |
| `_collectibleIndex` | `Object` | `def_index`（字符串） | 中文 collectible entry | `collectiblesZhCN` |
| `_graffitiIndex` | `Object` | 组合 `id`（如 `"graffiti-1654_3"`） | 中文 graffiti entry | `graffitiZhCN` |

### 3.2 `_enById`：统一英文索引

所有 8 种物品类型的英文 JSON 合并到一个对象，以 `id` 字段为 key：

```js
const enSources = [
    data.skinsEn, data.musicKitsEn, data.graffitiEn, data.keychainsEn,
    data.stickerSlabsEn, data.highlightsEn, data.stickersEn, data.collectiblesEn
];
for (const source of enSources) {
    for (const item of source) {
        if (item && item.id) {
            this._enById[item.id] = item;
        }
    }
}
```

这是整个架构的关键桥梁：**CSGO-API 的中英数据共享同一个 `id` 字段**。从中文 entry 取 `entry.id`，就能在 `_enById` 中查到对应的英文 entry，取其 `name` 作为 `hash_name`。

查询函数：

```js
_getEnName(cnEntry) {
    if (!cnEntry) return '';
    const enEntry = this._enById[cnEntry.id || ''];
    return (enEntry && enEntry.name) || '';
}
```

### 3.3 `_skinIndex`：皮肤复合索引

唯一使用 `Map` 的索引。key 由 `weapon_id` 和 `paint_index` 组合而成，用 null 字节 `\u0000` 分隔：

```js
const KEY_SEP = '\u0000';
// key = weapon_id + KEY_SEP + paint_index
// 例如 "1\u00000"（weapon_id=1, paint_index=0）
```

构建时 `weapon_id` 来自 `skin.weapon.weapon_id`，`paint_index` 来自 `skin.paint_index`，两者都转字符串。空 `weapon_id` 的条目会跳过。

> null 字节分隔符是安全选择：`weapon_id` 和 `paint_index` 都是数字串，不会包含 `\u0000`，因此不会有 key 冲突。

### 3.4 按 `def_index` 键控的索引（6 个）

music_kits / keychains / sticker_slabs / highlights / stickers / collectibles 共用同一套构建逻辑：

```js
_buildDefIndex(items) {
    const idx = {};
    for (const it of items) {
        if (!it || it.def_index === undefined || it.def_index === null) continue;
        idx[String(it.def_index)] = it;
    }
    return idx;
}
```

`def_index` 统一转字符串作为 key。查询时也用 `String(def_index)`。

### 3.5 `_graffitiIndex`：涂鸦组合 id 索引

涂鸦的 `id` 字段是一个组合标识，格式为 `graffiti-{sticker_id}_{color}`（如 `graffiti-1654_3`）。直接以这个 `id` 作为 key：

```js
for (const g of data.graffitiZhCN) {
    if (g && g.id) {
        this._graffitiIndex[g.id] = g;
    }
}
```

查询时需要从 `storageRow.stickers[0].sticker_id` 和 attribute `def_index=233` 解码的颜色代号拼出组合 id。

---

## 4. processItem 输出字段 Schema

`processItem(storageRow)` 是核心入口，接收 GC 协议层原始物品，返回富化结果对象。

输出字段分四组：pass-through（直接复制）、解析字段、marks 字段（可选）、诊断字段。

### 4.1 Pass-through 字段

这些字段从 `storageRow` 直接复制（部分有改名或默认值处理），不经过任何解析逻辑：

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `appid` | number | 常量 `730` | CS2 的 Steam App ID |
| `assetid` | any | `storageRow.id` | 物品实例 ID |
| `paint_wear` | number? | `storageRow.paint_wear` | 磨损浮点值（0~1） |
| `paint_index` | number? | `storageRow.paint_index` | 涂装索引 |
| `paint_seed` | number? | `storageRow.paint_seed` | 涂装种子（图案变体） |
| `def_index` | number? | `storageRow.def_index` | 物品定义索引 |
| `quality` | number? | `storageRow.quality` | 品质数值 |
| `rarity` | number? | `storageRow.rarity` | 稀有度数值 |
| `item_origin` | number? | `storageRow.origin` | 来源（注意改名：输入 `origin`，输出 `item_origin`） |
| `position` | number? | `storageRow.position` | 库存位置 |
| `account_id` | number? | `storageRow.account_id` | 所属账户 ID |
| `custom_name` | string? | `storageRow.custom_name` | 用户自定义名称 |
| `custom_desc` | string? | `storageRow.custom_desc` | 用户自定义描述 |
| `casket_id` | string? | `storageRow.casket_id` | 所属储物柜 ID |
| `casket_contained_item_count` | number? | `storageRow.casket_contained_item_count` | 储物柜内物品数 |
| `tradable_after` | number? | `storageRow.tradable_after` | 可交易时间戳 |
| `item_storage_total` | number? | 同 `casket_contained_item_count` | 别名字段，值完全相同 |

> `item_origin` 的改名是为了避免与某些上游库的 `origin` 字段冲突。

### 4.2 解析字段

这些字段由 `processItem` 根据物品类型和 CSGO-API 数据计算得出：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `trade_protect` | boolean | `false` | 交易保护标记（attribute 含 `def_index=312`）。被保护的物品无法消耗、修改或转移 |
| `name` | string | `''` | 中文显示名 |
| `hash_name` | string | `''` | 英文市场名（Steam Market 标准命名） |
| `market_name` | string | `''` | `name + ' (' + exterior_name + ')'`，中文显示名加中文磨损后缀 |
| `exterior_name` | string | `''` | 中文磨损名（崭新出厂/略有磨损/久经沙场/破损不堪/战痕累累），无 `paint_wear` 时为空字符串 |
| `rarity_name` | string | `''` | 中文稀有度名，来自 CSGO-API 条目的 `rarity.name` 字段（如 `"隐秘级"`） |
| `quality_name` | string | `'普通'` | 由 `name` 中关键词推断的品质名（见下方值域） |
| `itemset_name` | string | `''` | 中文箱子/收藏品名，优先取 `crates[0].name`，空则 fallback `collections[0].name` |
| `pendant` | string? | `null` | 挂件描述字符串，无挂件为 `null` |
| `recipe` | number? | `null` | 汰换索引：`rarity - 1`，`quality == 9` 时再 `+10`。无 `rarity` 时为 `null` |
| `stickers` | Array | `[]` | 武器上的印花列表，每项含 `{slot, sticker_id, name, hash_name, wear}`。仅武器皮肤分支填充 |
| `wear_min` | number? | `null` | 涂装最小磨损值，来自 CSGO-API `skin.min_float` |
| `wear_max` | number? | `null` | 涂装最大磨损值，来自 CSGO-API `skin.max_float` |
| `paint_wear_norm` | number? | `null` | 归一化磨损：`(paint_wear - wear_min) / (wear_max - wear_min)` |

#### `rarity_name` 值域

来自 CSGO-API 条目的 `rarity.name` 字段，是中文稀有度名：

| rarity_name | 对应 Valve rarity 数值（参考） |
|---|---|
| `"消费级"` | 1 |
| `"工业级"` | 2 |
| `"军规级"` | 3 |
| `"受限级"` | 4 |
| `"保密级"` | 5 |
| `"隐秘级"` | 6 |

> 注意：这是 CSGO-API 提供的中文显示名，不是 Valve 原始标识符（旧版的 `ancient_weapon` 等）。

#### `quality_name` 值域（推断值）

由 `_inferQualityName(result.name)` 根据 `name` 中是否包含特定关键词推断：

| 推断条件 | quality_name |
|---|---|
| name 含 `★` 且含 `StatTrak™` | `"★ StatTrak™"` |
| name 含 `★` | `"★"` |
| name 含 `StatTrak™` | `"StatTrak™"` |
| name 含 `Souvenir` 或 `纪念品` | `"纪念品"` |
| 以上都不匹配 | `"普通"` |

> 这是一个纯字符串推断，不查 GC 的 `quality` 数值字段。GC 的 `quality == 9` 只用于 recipe 计算。

#### `exterior_name` 值域

中文磨损名，由 `paint_wear` 浮点值分段决定（见 [第 8 节](#8-磨损分段)）：

`崭新出厂` / `略有磨损` / `久经沙场` / `破损不堪` / `战痕累累`

无 `paint_wear` 时为空字符串 `''`。

#### `itemset_name` 来源

优先级：

1. `cnSkin.crates[0].name`（中文箱子名，如 `"棱彩武器箱"`）
2. `cnSkin.collections[0].name`（中文收藏品名）
3. 空字符串（两者都不存在）

#### `recipe` 计算公式

```
if (rarity 存在) {
    recipe = rarity - 1
    if (quality == 9) recipe += 10
}
```

| rarity | quality | recipe |
|---|---|---|
| 4 | 4（普通） | 3 |
| 4 | 9（StatTrak） | 13 |
| 1 | 4 | 0 |
| 不存在 | 任意 | `null`（不生成） |

> `quality == 9` 等价于 Python 版的 `QUALITY_MAP[9] == "ST"` 判断。

### 4.3 marks 字段（仅 `init({marks})` 时生成）

当 `init()` 传入 `marks` 配置时，输出对象会额外包含以下字段：

| 字段 | 来源 | 说明 |
|---|---|---|
| `rarity_mark` | `marks.rarity[rarity_name]` | 用中文稀有度名查表 |
| `quality_mark` | `marks.quality[quality_name]` | 用推断的品质名查表 |
| `exterior_mark` | `marks.exterior[exterior_name]` | 用中文磨损名查表 |
| `itemset_mark` | `marks.itemset[itemset_name]` | 用中文箱子/收藏品名查表 |
| `mark` | 四者拼接 | `[quality_mark, rarity_mark, exterior_mark, itemset_mark].join('_')`，仅当 4 个都有效时才拼接，否则为 `''` |

> 每个 mark 字段查表未命中时值为 `null`（不是空字符串）。但 `mark` 组合字段要求 4 个全部非 null/非 undefined/非空字符串才拼接。

详见 [第 9 节](#9-marks-外置注入机制)。

### 4.4 诊断字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `msg` | string? | `null` = 解析成功；字符串 = 解析过程中的异常 message。异常不中断已计算的字段 |

### 4.5 字段清理

每次调用 `processItem` 会先从 `storageRow` 中删除可能残留的旧输出字段（防止重复富化时字段污染）。被清理的字段列表：

```js
const staleKeys = [
    'name', 'hash_name', 'market_name', 'item_set',
    'itemset_mark', 'itemset_name', 'pendant',
    'exterior_name', 'exterior_mark', 'rarity_name',
    'rarity_mark', 'quality_name', 'quality_mark',
    'wear_category', 'rarity_name_local',
    'quality_name_local', 'recipe', 'mark', 'msg'
];
```

> 这也兼容旧版输出字段（`item_set` / `wear_category` / `rarity_name_local` / `quality_name_local`）的清理。

---

## 5. 物品类型分支路由

对应文件：`enricher/itemProcessor.js` 的 `processItem` 方法。

`processItem` 首先填 pass-through 字段，然后按优先级判断物品类型，走不同的查找分支。8 个分支按以下顺序匹配（匹配到即停止）：

### 5.1 分支优先级表

| 优先级 | 判别条件 | 物品类型 | 处理逻辑 |
|---|---|---|---|
| 1 | `def_index == 1201` | 储物柜 | 固定名：`name = "库存存储组件"`，`hash_name = "Storage Unit"` |
| 2 | `musicindex != null` | 音乐盒（B 类） | 查 `_musicIndex[String(musicindex)]` |
| 3 | attribute 含 `def_index == 233` | 涂鸦 | 拼 `"graffiti-{sticker_id}_{color}"` 查 `_graffitiIndex` |
| 4 | `def_index == 1209` | 独立贴纸 | 取 `stickers[0].sticker_id` 查 `_stickerIndex` |
| 5 | `def_index == 1314` | 音乐盒物品 | 从 attribute `def_index == 166` 解码 music def_index，查 `_musicIndex` |
| 6 | `def_index == 1355` | 独立挂件/印花板/高光 | 调用 `_resolvePendantItem` 分发 |
| 7 | else | 普通武器皮肤 | 查 `_skinIndex[(def_index, paint_index)]` |
| 8 | 皮肤查不到（fallback） | 收藏品 | 查 `_collectibleIndex[def_index]` |

### 5.2 各分支详细说明

#### 分支 1：储物柜（`def_index == 1201`）

```js
result.name = '库存存储组件';
result.hash_name = 'Storage Unit';
```

固定名称，不查任何索引。

#### 分支 2：音乐盒（`musicindex != null`）

GC 推送的物品如果带了 `musicindex` 字段（注意不是 `def_index`），直接用它查 `_musicIndex`：

```js
const mk = this._musicIndex[String(musicindex)];
if (mk) {
    result.name = mk.name || '';
    result.hash_name = this._getEnName(mk);
    result.rarity_name = (mk.rarity || {}).name || '';
}
```

#### 分支 3：涂鸦（attribute 含 `def_index == 233`）

涂鸦颜色代号从 attribute `def_index == 233` 的 `value_bytes` 解码（4 字节小端 uint32）。涂鸦的组合 id 由 `sticker_id` 和颜色代号拼成：

```js
const graffitiColor = this._extractGraffitiColor(storageRow);
// graffitiColor 仅在 musicindex 为 null 时提取
if (graffitiColor !== null) {
    const stickerId = storageRow.stickers[0].sticker_id;
    const gid = 'graffiti-' + stickerId + '_' + graffitiColor;
    const g = this._graffitiIndex[gid];
    // ...
}
```

> 涂鸦颜色提取有前置条件：`musicindex` 为 null 或 undefined 时才提取。这是为了避免音乐盒物品误入涂鸦分支。

#### 分支 4：独立贴纸（`def_index == 1209`）

单个印花物品（不是武器上的印花，是库存里独立的贴纸物品）。取 `stickers[0].sticker_id` 查 `_stickerIndex`：

```js
const first = storageRow.stickers[0];
const entry = this._stickerIndex[String(first.sticker_id)];
```

#### 分支 5：音乐盒物品（`def_index == 1314`）

这是一种特殊的"音乐盒容器"物品。真正的音乐盒 def_index 藏在 attribute `def_index == 166` 的 `value_bytes` 里：

```js
// 从 attribute[166] 解码出真正的 music def_index
let musicDi = null;
for (const a of storageRow.attribute) {
    if (a.def_index === 166) {
        musicDi = this._readUInt32LE(a);
        break;
    }
}
// 用 musicDi 查 _musicIndex
const mk = this._musicIndex[String(musicDi)];
if (mk) {
    result.name = '音乐盒 | ' + (mk.name || '');
    result.hash_name = 'Music Kit | ' + this._getEnName(mk);
}
```

注意名称格式与分支 2 不同：分支 5 会加 `"音乐盒 | "` 前缀。

#### 分支 6：独立挂件/印花板/高光（`def_index == 1355`）

调用 `_resolvePendantItem(storageRow)`，根据 attribute `def_index == 299` 的 `keychain_val` 值分发：

| `keychain_val` | 类型 | 查找索引 |
|---|---|---|
| 37 | 印花板 | `_stickerSlabIndex[sticker_kit_id]`（attr 321） |
| 36 | 高光 | `_highlightIndex[highlight_index]`（attr 314） |
| 其他 | 普通挂件 | `_keychainIndex[keychain_val]` |

详见 [第 7 节](#7-挂件解析)。

#### 分支 7：普通武器皮肤（else）

最核心的分支。用 `(def_index, paint_index)` 组合 key 查 `_skinIndex`：

```js
const cnSkin = this._skinIndex.get(defIndexStr + KEY_SEP + paintIndexStr);
```

如果查到，执行：
1. StatTrak 名称拼接（attribute 80）
2. Souvenir 名称拼接（attribute 140）
3. 设置 `rarity_name`（从 `cnSkin.rarity.name`）
4. 计算 `wear_min` / `wear_max` / `paint_wear_norm`（仅 `paint_wear` 存在时）
5. 设置 `itemset_name`（crates 优先，fallback collections）
6. 解析 `stickers` 列表

如果查不到，走 fallback。

#### 分支 8：收藏品 fallback

武器皮肤查不到时，按 `def_index` 查 `_collectibleIndex`：

```js
const pendantEntry = this._collectibleIndex[String(defIndex)];
if (pendantEntry) {
    result.name = pendantEntry.name || '';
    result.hash_name = this._getEnName(pendantEntry);
    result.rarity_name = (pendantEntry.rarity || {}).name || '';
}
```

这覆盖了非皮肤类收藏品（如勋章、包裹等）。

### 5.3 分支后的统一处理

无论走哪个分支，接下来都会执行：

1. **磨损后缀**：设置 `exterior_name`，给 `hash_name` 追加英文磨损后缀，计算 `market_name`
2. **quality_name 推断**：从 `result.name` 的关键词推断
3. **recipe 计算**：`rarity - 1`（+10 if quality == 9）
4. **marks 注入**（仅 `init({marks})` 时）
5. **pendant 解析**：调用 `_getPendant`（对所有物品类型调用）

---

## 6. StatTrak / Souvenir 拼接规则

仅在**普通武器皮肤分支**（分支 7）中执行。照搬 Python 参考实现 `cs2_db_manager` 的 L494-521。

### 6.1 StatTrak 拼接（attribute `def_index == 80`）

当 `_isStatTrak(storageRow)` 返回 `true`（attribute 数组中存在 `def_index == 80`）时，对中英文名分别拼接：

#### 中文名（`cnName`）拼接规则

| 条件 | 拼接方式 | 示例 |
|---|---|---|
| 含 `（★）` | 替换为 `（★ StatTrak™）` | `★ 蝴蝶刀（★）` → `★ 蝴蝶刀（★ StatTrak™）` |
| 含 ` \| `（第一个） | 在第一个 ` \| ` 前插入 `（StatTrak™）` | `AK-47 \| 红线` → `AK-47（StatTrak™） \| 红线` |
| 都不含 | 末尾追加 `（StatTrak™）` | `音乐盒` → `音乐盒（StatTrak™）` |

> 注意：仅在第一个 ` | ` 处切分（等价 Python 的 `split(" | ", 1)`）。

#### 英文名（`enName`）拼接规则

| 条件 | 拼接方式 | 示例 |
|---|---|---|
| 以 `★ ` 开头 | 替换为 `★ StatTrak™ ` | `★ Karambit \| Fade` → `★ StatTrak™ Karambit \| Fade` |
| 其他 | 前缀 `StatTrak™ ` | `AK-47 \| Redline` → `StatTrak™ AK-47 \| Redline` |

> 英文走前缀是 Steam Market 的命名规范。

### 6.2 Souvenir 拼接（attribute `def_index == 140`）

当 `_isSouvenir(storageRow)` 返回 `true` 时，在 StatTrak 拼接之后执行：

#### 中文名拼接规则

先检查 `cnName` 是否已含 `纪念品`，不含才拼接：

| 条件 | 拼接方式 | 示例 |
|---|---|---|
| 含 ` \| `（第一个） | 在第一个 ` \| ` 前插入 `（纪念品）` | `AK-47 \| 红线` → `AK-47（纪念品） \| 红线` |
| 不含 ` \| ` | 末尾追加 `（纪念品）` | `包裹` → `包裹（纪念品）` |

#### 英文名拼接规则

先检查 `enName` 是否已含 `Souvenir`，不含才前缀：

| 条件 | 拼接方式 | 示例 |
|---|---|---|
| 不含 `Souvenir` | 前缀 `Souvenir ` | `AK-47 \| Redline` → `Souvenir AK-47 \| Redline` |

### 6.3 防重复保护

- StatTrak 中文 `（★）` → `（★ StatTrak™）` 是替换，不会重复
- Souvenir 中文检查 `name.indexOf('纪念品') === -1` 避免重复追加
- Souvenir 英文检查 `name.indexOf('Souvenir') === -1` 避免重复前缀

### 6.4 拼接示例

| 物品 | StatTrak | Souvenir | 中文名结果 | 英文名结果 |
|---|---|---|---|---|
| AK-47 红线 | 是 | 否 | `AK-47（StatTrak™） \| 红线` | `StatTrak™ AK-47 \| Redline` |
| AK-47 红线 | 否 | 是 | `AK-47（纪念品） \| 红线` | `Souvenir AK-47 \| Redline` |
| ★ 蝴蝶刀 渐变 | 是 | 否 | `★ 蝴蝶刀（★ StatTrak™） \| 渐变` | `★ StatTrak™ ★ Butterfly Knife \| Fade` |
| 普通包裹 | 否 | 是 | `包裹（纪念品）` | `Souvenir Package` |

---

## 7. 挂件解析

对应文件：`enricher/itemProcessor.js` 的 `_getPendant` 和 `_resolvePendantItem` 方法。

挂件解析涉及 4 个 attribute `def_index`，以及 `keychain_val` 的值域判断。

### 7.1 涉及的 attribute def_index

以下均为 **CS2 固有魔法数字**（Valve 在 GC 协议中定义，不可配置）：

| def_index | 含义 | 解码方式 | 用途 |
|---|---|---|---|
| 306 | `template_id` | `_readUInt32LE`（4 字节小端 uint32） | 挂件实例模板 ID，用于名称后缀 `-{templateId}` |
| 299 | `keychain_val` | `_readUInt32LE` | 挂件类型/实例 ID。值 37 = 印花板，36 = 高光，其他 = 普通挂件 |
| 321 | `sticker_kit_id` | `_readUInt32LE` | 印花板对应的 sticker_kit ID |
| 314 | `highlight_index` | `_readUInt32LE` | 高光对应的 highlight reel index |

### 7.2 `value_bytes` 解码

`_readUInt32LE(attr)` 统一解码 attribute 的 `value_bytes`，支持两种格式：

```js
_readUInt32LE(attr) {
    const vb = attr && attr.value_bytes;
    if (!vb) return null;
    let raw;
    if (Buffer.isBuffer(vb)) {
        raw = vb;                           // Node Buffer
    } else if (vb.data && Array.isArray(vb.data)) {
        raw = Buffer.from(vb.data);         // protobuf { data: [...] }
    } else {
        return null;
    }
    if (raw.length < 4) return null;
    return raw.readUInt32LE(0);             // 4 字节小端无符号整数
}
```

不足 4 字节或无 `value_bytes` 返回 `null`。

### 7.3 `_getPendant(row)`：武器挂件名解析

用于给武器皮肤的结果对象填充 `pendant` 字段。

**早退条件**：如果物品没有 `paint_index`（非武器），且 attribute 中有 `def_index == 299` 或 `314`，直接返回 `null`。这是因为独立挂件物品（分支 6）的 `name` 已经是物品名，不需要重复填充 `pendant`。

**收集属性**后，如果 `templateId`、`keychainVal`、`highlightIndex` 全为 null，返回 `null`（无挂件）。

**按 `keychainVal` 分发**：

| `keychain_val` | 类型 | 查找逻辑 | 返回值 |
|---|---|---|---|
| 37 | 印花板 | `_stickerSlabIndex[String(stickerKitId)]` | `ss.name`（印花板中文名） |
| 36 | 高光 | `_highlightIndex[String(highlightIndex)]` | `hl.name`（高光中文名） |
| 其他 | 普通挂件 | `_keychainIndex[String(keychainVal)]` | `kc.name + '-' + templateId`（有 templateId 时）或 `kc.name` |

**Fallback**：

| 优先级 | 条件 | 返回值 |
|---|---|---|
| 1 | `templateId !== null`（以上都未命中） | `'挂件-' + templateId` |
| 2 | 都没匹配 | `'存在挂件'`（字面量） |

> Fallback 字符串 `'挂件-'` 和 `'存在挂件'` 是中文硬编码，不跟随语言设置（本项目已固定中英双语）。

### 7.4 `_resolvePendantItem(row)`：独立挂件物品解析

用于分支 6（`def_index == 1355`）。与 `_getPendant` 的属性收集逻辑相同，但返回完整的 entry 对象（含 `name`、`rarity` 等），而非拼接后的字符串。

| `keychain_val` | 类型 | 查找逻辑 | 查不到时的 fallback |
|---|---|---|---|
| 37 | 印花板 | `_stickerSlabIndex[stickerKitId]` | `{ name: 'sticker_slab-{id} 未找到' }` |
| 36 | 高光 | `_highlightIndex[highlightIndex]` | `{ name: 'highlight-{id} 未找到' }` |
| 其他 | 普通挂件 | `_keychainIndex[keychainVal]` | `{ name: 'keychain-{id} 未找到' }` |

`keychainVal` 为 null 时返回 `null`。

---

## 8. 磨损分段

对应文件：`enricher/itemProcessor.js` 的 `_getWearInfo` 方法。

### 8.1 阈值与名称

磨损分段是 **CS2 固有语义**，硬编码在代码中（照搬 Python L11-13）：

```js
const WEAR_THRESHOLDS = [0.07, 0.15, 0.38, 0.45, 1.0];
const WEAR_NAMES_CN  = ['崭新出厂', '略有磨损', '久经沙场', '破损不堪', '战痕累累'];
const WEAR_NAMES_EN  = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];
```

分段规则：找到第一个 `paintWear <= WEAR_THRESHOLDS[i]`，返回对应的名称。都大于则返回 `[null, null]`。

| 区间 | 中文名 | 英文名 |
|---|---|---|
| `paint_wear <= 0.07` | 崭新出厂 | Factory New |
| `0.07 < paint_wear <= 0.15` | 略有磨损 | Minimal Wear |
| `0.15 < paint_wear <= 0.38` | 久经沙场 | Field-Tested |
| `0.38 < paint_wear <= 0.45` | 破损不堪 | Well-Worn |
| `0.45 < paint_wear <= 1.0` | 战痕累累 | Battle-Scarred |
| `paint_wear > 1.0` 或 null | `null` | `null` |

### 8.2 名称追加规则

```
exterior_name = wearNameCn || ''

// hash_name 追加英文磨损后缀（仅 paint_wear 存在、英文名非空、hash_name 非空时）
if (paint_wear 存在 && extEn 非空 && result.hash_name 非空):
    result.hash_name = result.hash_name + ' (' + extEn + ')'

// market_name = 中文名 + 中文磨损后缀
if (result.name 非空):
    result.market_name = result.name + (extCn ? ' (' + extCn + ')' : '')
```

示例：

| 字段 | 示例值 |
|---|---|
| `name` | `AK-47 \| 红线` |
| `hash_name` | `AK-47 \| Redline (Field-Tested)` |
| `market_name` | `AK-47 \| 红线 (久经沙场)` |
| `exterior_name` | `久经沙场` |

### 8.3 `paint_wear_norm` 归一化磨损

仅当 `paint_wear` 存在且 `_skinIndex` 查到皮肤条目时计算：

```
wear_min = cnSkin.min_float
wear_max = cnSkin.max_float
paint_wear_norm = (paint_wear - wear_min) / (wear_max - wear_min)
```

要求 `wear_max !== wear_min`（避免除以零）。`min_float` / `max_float` 来自 CSGO-API 的皮肤条目，表示该涂装允许的磨损范围。

---

## 9. marks 外置注入机制

### 9.1 设计理念

旧版内置了三张硬编码 mark 映射表（`RARITY_NAME_TO_MARK` / `QUALITY_MAP` / `WEAR_MARKS`），新版完全外置：调用方通过 `init({marks})` 注入，key 全部用**中文名**。

这意味着 mark 的具体值由业务方决定，库本身不预设任何缩写方案。

### 9.2 配置结构

```js
csgo.init({
    marks: {
        rarity: {
            '消费级': 'XF',
            '工业级': 'GY',
            '军规级': 'JG',
            '受限级': 'SX',
            '保密级': 'BM',
            '隐秘级': 'YM'
        },
        quality: {
            '普通': 'PT',
            '★': 'STAR',
            'StatTrak™': 'ST',
            '★ StatTrak™': 'ST_STAR',
            '纪念品': 'SOUV'
        },
        exterior: {
            '崭新出厂': 'ZX',
            '略有磨损': 'LM',
            '久经沙场': 'JJ',
            '破损不堪': 'PS',
            '战痕累累': 'ZH'
        },
        itemset: {
            '棱彩武器箱': 'PRIN',
            '反冲武器箱': 'RECOIL'
        }
    }
});
```

### 9.3 查表 key

所有 4 个子 map 的 key 都是中文显示名，与 `processItem` 输出的对应字段完全一致：

| 子 map | key 来源字段 | 示例 key |
|---|---|---|
| `marks.rarity` | `result.rarity_name` | `'隐秘级'` |
| `marks.quality` | `result.quality_name`（推断值） | `'StatTrak™'` |
| `marks.exterior` | `result.exterior_name` | `'久经沙场'` |
| `marks.itemset` | `result.itemset_name` | `'棱彩武器箱'` |

### 9.4 mark 组装规则

```js
const parts = [qualityMark, rarityMark, exteriorMark, itemsetMark];
const allValid = parts.every(m => m !== null && m !== undefined && m !== '');
result.mark = allValid ? parts.join('_') : '';
```

- 顺序固定：`quality_rarity_exterior_itemset`
- 4 个都有效（非 null / 非 undefined / 非空字符串）才用 `_` 拼接
- 任何一个无效，`mark` 为空字符串 `''`
- 单个 mark 字段（如 `rarity_mark`）查表未命中时为 `null`

### 9.5 完整输出示例

```json
{
    "rarity_name": "隐秘级",
    "quality_name": "StatTrak™",
    "exterior_name": "久经沙场",
    "itemset_name": "棱彩武器箱",
    "rarity_mark": "YM",
    "quality_mark": "ST",
    "exterior_mark": "JJ",
    "itemset_mark": "PRIN",
    "mark": "ST_YM_JJ_PRIN"
}
```

---

## 10. init() 选项与事件

### 10.1 init() 选项

```js
GlobalOffensive.prototype.init = function(opts) { ... }
```

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `dataDir` | string | `./cs2-inventory-schema` | 本地数据存储目录（建议加入 `.gitignore`） |
| `checkIntervalHours` | number | `24` | 更新检查间隔（小时）。超过此间隔会查 canary SHA 决定是否下载 |
| `forceUpdate` | boolean | `false` | 强制重新下载全部 16 个文件，忽略缓存 |
| `marks` | object | `null` | 外置 mark 映射配置（见 [第 9 节](#9-marks-外置注入机制)）。不传则不生成 mark 字段 |
| `onDownloadProgress` | function | `null` | 整体下载进度回调，接收 `{completed, total, overallPercent}` |

> 每次调用 `init()` 会**替换**所有之前的选项（不是合并）。内部通过 `_enricherGeneration` 计数器防止并行调用互相覆盖。

### 10.2 init() 示例

```js
// 基本用法（使用默认选项）
csgo.init();

// 自定义配置
csgo.init({
    dataDir: './my-data',
    checkIntervalHours: 6,
    forceUpdate: true,
    marks: {
        rarity: { '隐秘级': 'YM', '保密级': 'BM' },
        quality: { '普通': 'PT', 'StatTrak™': 'ST' },
        exterior: { '久经沙场': 'JJ' },
        itemset: { '棱彩武器箱': 'PRIN' }
    },
    onDownloadProgress: (p) => console.log(`${p.overallPercent}%`)
});
```

### 10.3 事件

#### enricher 生命周期事件

| 事件 | 触发时机 | 回调参数 |
|---|---|---|
| `enricherReady` | enricher 数据加载完成，ItemProcessor 就绪 | 无 |
| `enricherError` | enricher 初始化失败 | `Error` 对象 |

#### 下载进度事件（由 DataLoader 转发）

| 事件 | 触发时机 | 回调参数 |
|---|---|---|
| `downloadStart` | 并行下载开始 | `{ files: [{key, label}], total }` |
| `fileProgress` | 单文件进度变化 | `{ key, label, phase, bytesDownloaded?, bytesTotal?, percent? }` |
| `downloadProgress` | 整体进度变化 | `{ completed, total, overallPercent }` |
| `fileError` | 单文件重试失败 | `{ key, label, error, attempt }` |
| `downloadDone` | 全部下载完成 | `{ results: [...], succeeded, failed }` |

> `downloadProgress` 事件在 DataLoader 内部名为 `progress`，`index.js` 转发时改名为 `downloadProgress` 以避免与其他 progress 事件混淆。

### 10.4 ready() 方法

```js
async function waitForReady() {
    await csgo.ready();
    // enricher 已就绪，所有物品已富化
}
```

如果 enricher 已经就绪，立即 resolve。否则等待 `enricherReady` 事件。

### 10.5 自动富化时机

enricher 在以下时机自动富化物品（无需手动调用）：

| 时机 | 行为 |
|---|---|
| GC 连接后（`connectedToGC`） | 如果 enricher 已就绪，批量富化整个 `csgo.inventory` |
| enricher 就绪后（`enricherReady`） | 如果 GC 已连接，批量富化整个 `csgo.inventory` |
| `itemAcquired` 事件 | 单品富化 |
| `itemChanged` 事件 | 对 `newItem` 单品富化 |

---

## 11. 已删除的功能（迁移注意）

如果你从旧版（items_game + 翻译表架构）升级，以下功能已不再支持：

### 11.1 删除的配置选项

| 删除的选项 | 替代方案 |
|---|---|
| `init({ defaultLanguage })` | 无替代。语言固定为中英双语，`name` 永远中文，`hash_name` 永远英文 |
| `init({ languages: [...] })` | 无替代。多语言机制已移除 |
| `name_{lang}` 系列字段 | 无替代。不再生成 `name_japanese` 等多语言变体 |

### 11.2 删除的数据源

| 删除的数据 | 替代数据 |
|---|---|
| `items_game.json`（来自 counter-strike-file-tracker） | CSGO-API 的 16 个预处理 JSON |
| `csgo_schinese.json`（翻译表） | 不再需要翻译表，CSGO-API 已内置中文名 |
| `csgo_english.json`（翻译表） | 同上 |
| `csgo_{lang}.json`（29 种语言翻译表） | 不再支持 |

### 11.3 删除的输出字段

| 删除的字段 | 替代字段 | 值域变化 |
|---|---|---|
| `rarity_name_local` | `rarity_name` | 从翻译名变为直接中文：旧 `"保密级"` → 新 `"保密级"`（值相同，但不再有 `_local` 后缀） |
| `quality_name_local` | `quality_name` | 从 `normal`/`strange` 变为推断中文：`"普通"`/`"★"`/`"StatTrak™"`/`"★ StatTrak™"`/`"纪念品"` |
| `item_set` | `itemset_name` | 从 raw key（`set_community_22`）变为中文箱子名（`棱彩武器箱`） |
| `item_set_local` | `itemset_name` | 合并为一个字段 |
| `wear_category` | `exterior_name` | 从 `wearcategory2` 变为中文（`久经沙场`） |
| `name_{lang}` | 无 | 多语言变体已移除 |
| `market_name_{lang}` | 无 | 多语言变体已移除 |
| `rarity_name_{lang}` | 无 | 多语言变体已移除 |
| `quality_name_{lang}` | 无 | 多语言变体已移除 |
| `item_set_{lang}` | 无 | 多语言变体已移除 |

### 11.4 `rarity_name` 值域变化（迁移重点）

旧版的 `rarity_name` 是 Valve 标识符，新版是中文显示名：

| 旧值（Valve 标识符） | 新值（中文显示名） |
|---|---|
| `common_weapon` | `消费级` |
| `uncommon_weapon` | `工业级` |
| `rare_weapon` | `军规级` |
| `mythical_weapon` | `受限级` |
| `legendary_weapon` | `保密级` |
| `ancient_weapon` | `隐秘级` |

> 如果你的代码中有 `item.rarity_name === 'ancient_weapon'` 这样的判断，需要改为 `item.rarity_name === '隐秘级'`。

### 11.5 `quality_name` 值域变化

| 旧值 | 新值（推断值） |
|---|---|
| `normal` | `普通` |
| `strange` | `StatTrak™` |
| `null`（quality == 3 的刀具） | `★` 或 `★ StatTrak™` |

新版根据 `name` 内容推断，不再查 GC `quality` 数值。

### 11.6 marks key 变化

旧版 marks 的 key 是 Valve 标识符：

```js
// 旧版（已删除）
marks: {
    rarity: { 'ancient_weapon': 'YM' },
    quality: { 'normal': 'PT', 'strange': 'ST' },
    exterior: { 'wearcategory0': 'ZX' },
    itemset: { 'set_community_3': 'PRIN' }
}
```

新版 marks 的 key 是中文名：

```js
// 新版
marks: {
    rarity: { '隐秘级': 'YM' },
    quality: { '普通': 'PT', 'StatTrak™': 'ST' },
    exterior: { '崭新出厂': 'ZX' },
    itemset: { '棱彩武器箱': 'PRIN' }
}
```

### 11.7 删除的内部机制

以下内部实现已完全移除（不影响公共 API，但自定义 fork 需注意）：

- `loadItemsGame()` / `extractSection()`: items_game 段落抽取
- `parseTranslationJson()` / `getTranslation()` / `getEnglishTranslation()`: 翻译表查表
- `loadTranslations()` / `loadEnglishTranslations()` / `setExtraLanguage()`: 多语言字典加载
- `_updateDefaultTranslation()`: 默认语言切换
- `getRarityName()` 的 fallback 映射 `{ 1: 'common_weapon', ... }`
- `getQualityName()` 的硬编码 `{ 4: 'normal', 9: 'strange' }`
- `getWearCategory()` 的 wear_blocks 段落查询
- `name_to_set_map` 派生索引
- `casket_icons` 预留字段
- 涂装名特殊覆盖映射 `{ "027": "27", "K.O.工厂": "K.O. 工厂" }`

### 11.8 新增字段

新版相比旧版新增了以下输出字段：

| 新增字段 | 说明 |
|---|---|
| `wear_min` | 涂装最小磨损值（来自 CSGO-API `skin.min_float`） |
| `wear_max` | 涂装最大磨损值（来自 CSGO-API `skin.max_float`） |
| `paint_wear_norm` | 归一化磨损 `(paint_wear - wear_min) / (wear_max - wear_min)` |
| `stickers` | 武器印花列表，每项含 `{slot, sticker_id, name, hash_name, wear}` |
| `itemset_name` | 中文箱子/收藏品名（替代旧版 `item_set` + `item_set_local`） |
| `item_storage_total` | `casket_contained_item_count` 的别名字段 |

---

## 附：数据流图

```
┌──────────────────────────────────────────────────────────────────┐
│  ByMykel/CSGO-API (GitHub raw + API)                              │
│  ├── public/api/{zh-CN|en}/{base}.json   (16 个预处理 JSON)       │
│  └── manifestIdUpdate.txt                  (depot manifest ID)    │
└────────────────────────┬─────────────────────────────────────────┘
                         │
            DataLoader.load()  (并行下载，并发 8，3 次重试)
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  本地缓存 ./{dataDir}/                                            │
│    ├── skins-zh-CN.json / skins-en.json                           │
│    ├── music_kits-zh-CN.json / music_kits-en.json                 │
│    ├── graffiti-zh-CN.json / graffiti-en.json                     │
│    ├── keychains-zh-CN.json / keychains-en.json                   │
│    ├── sticker_slabs-zh-CN.json / sticker_slabs-en.json           │
│    ├── highlights-zh-CN.json / highlights-en.json                 │
│    ├── stickers-zh-CN.json / stickers-en.json                     │
│    ├── collectibles-zh-CN.json / collectibles-en.json             │
│    └── cache.json  (canary SHA + downloadedAt + manifestId)       │
└────────────────────────┬─────────────────────────────────────────┘
                         │  DataLoader.load() 返回
                         │  { skinsZhCN, skinsEn, ..., manifestId }
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  ItemProcessor (7 个内存索引)                                     │
│    ├── _enById          (id → en_entry, 8 种英文 JSON 合并)       │
│    ├── _skinIndex       (Map: weapon_id\u0000paint_index → cn)    │
│    ├── _musicIndex      (def_index → cn)                          │
│    ├── _keychainIndex   (def_index → cn)                          │
│    ├── _stickerSlabIndex(def_index → cn)                          │
│    ├── _highlightIndex  (def_index → cn)                          │
│    ├── _stickerIndex    (def_index → cn)                          │
│    ├── _collectibleIndex(def_index → cn)                          │
│    └── _graffitiIndex   (组合 id → cn)                            │
└────────────────────────┬─────────────────────────────────────────┘
                         │  processItem(storageRow) per GC item
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  富化物品对象                                                     │
│    pass-through: appid/assetid/paint_wear/paint_index/...         │
│    解析: name/hash_name/market_name/exterior_name/rarity_name/    │
│          quality_name/itemset_name/pendant/recipe/stickers/       │
│          wear_min/wear_max/paint_wear_norm                        │
│    marks (可选): rarity_mark/quality_mark/exterior_mark/          │
│                  itemset_mark/mark                                │
│    诊断: msg                                                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 附：CS2 固有魔法数字汇总

以下是 Valve 在 GC 协议中定义的固定数值，不可配置，属于 CS2 游戏固有语义：

### 物品 def_index

| 值 | 含义 |
|---|---|
| 1201 | 储物柜（Storage Unit） |
| 1209 | 独立贴纸物品 |
| 1314 | 音乐盒物品（真正的 music def_index 在 attribute 166） |
| 1355 | 独立挂件/印花板/高光物品 |

### attribute def_index

| 值 | 含义 | 解码方式 |
|---|---|---|
| 80 | StatTrak 标记 | 仅判存在 |
| 140 | Souvenir 标记 | 仅判存在 |
| 166 | 音乐盒 def_index | `readUInt32LE` |
| 233 | 涂鸦颜色代号 | `readUInt32LE` |
| 299 | 挂件类型/实例 ID（keychain_val） | `readUInt32LE` |
| 306 | 挂件模板 ID（template_id） | `readUInt32LE` |
| 312 | 交易保护标记 | 仅判存在 |
| 314 | 高光索引（highlight_index） | `readUInt32LE` |
| 321 | 印花板贴纸 ID（sticker_kit_id） | `readUInt32LE` |

### keychain_val 值域

| 值 | 含义 |
|---|---|
| 37 | 印花板 |
| 36 | 高光 |
| 其他 | 普通挂件 |

### quality 数值

| 值 | 含义 | 影响 |
|---|---|---|
| 3 | 刀具/手套（★ 级） | 新版不再特殊处理（由 name 推断 quality_name） |
| 4 | 普通 | 无特殊处理 |
| 9 | StatTrak 隐含 | `recipe += 10` |

### 磨损阈值

`[0.07, 0.15, 0.38, 0.45, 1.0]`（CS2 固有，硬编码）

### 可配置参数

| 参数 | 配置方式 | 默认值 |
|---|---|---|
| `dataDir` | `init({ dataDir })` | `./cs2-inventory-schema` |
| `checkIntervalHours` | `init({ checkIntervalHours })` | `24` |
| `forceUpdate` | `init({ forceUpdate })` | `false` |
| `marks` | `init({ marks })` | `null` |
| `MAX_CONCURRENCY` | 代码常量 | `8` |
| `MAX_ATTEMPTS` | 代码常量 | `3` |
| `RETRY_DELAYS_MS` | 代码常量 | `[2000, 4000]` |
