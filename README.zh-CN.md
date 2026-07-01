<div align="center">

[![npm version](https://img.shields.io/npm/v/cs2-inventory-kit.svg)](https://npmjs.com/package/cs2-inventory-kit) [![npm downloads](https://img.shields.io/npm/dm/cs2-inventory-kit.svg)](https://npmjs.com/package/cs2-inventory-kit) [![Node.js Version](https://img.shields.io/node/v/cs2-inventory-kit.svg)](https://npmjs.com/package/cs2-inventory-kit) [![license](https://img.shields.io/github/license/Joclto/cs2-inventory-kit.svg)](https://github.com/Joclto/cs2-inventory-kit/blob/master/LICENSE) [![fork](https://img.shields.io/badge/fork%20of-node--globaloffensive-blue.svg)](https://github.com/DoctorMcKay/node-globaloffensive)

# cs2-inventory-kit

**专注于库存的 CS2 Game Coordinator 库，内置物品数据增强。**

English | [简体中文](./README.md)

</div>

## 与 node-globaloffensive 的关系

本库在 [node-globaloffensive](https://github.com/DoctorMcKay/node-globaloffensive) 的基础上**延伸与改进** —— 100% 向后兼容，所有现有的方法、事件和属性无需任何代码改动即可照常使用，同时新增了内置物品数据增强、挂件支持、基于 CSGO-API 的物品增强等功能。

**继承 API 的完整参考**：[node-globaloffensive README](https://github.com/DoctorMcKay/node-globaloffensive#readme)

迁移时只需修改 `require` 语句：

```js
// 之前
const GlobalOffensive = require('globaloffensive');

// 之后
const GlobalOffensive = require('cs2-inventory-kit');
```

仅此而已，其余一切完全相同。

> **Fork 说明**：基于 Alexander Corn 的 [node-globaloffensive](https://github.com/DoctorMcKay/node-globaloffensive)（MIT 许可证）。

---

## 新特性

### 挂件（Keychain）支持

用于 CS2 挂件操作的方法与事件：

| API | 类型 | 说明 |
|---|---|---|
| `csgo.applyKeychain(itemId, keychainId[, keychainSlot])` | 方法 | 给武器应用一个挂件（消耗该挂件物品） |
| `csgo.removeKeychain(itemId)` | 方法 | 从武器移除挂件（消耗一次移除工具次数） |
| `csgo.keychainCharges` | 属性（只读） | 剩余的挂件移除工具次数。在 GC 推送数据之前为 `undefined` |
| `csgo.on('keychainCharges', fn)` | 事件 | 在次数变化时触发（GC 连接、移除操作后等） |

### 物品数据增强（自动）

`inventory`、`itemAcquired`、`itemChanged` 以及 `getCasketContents` 中的物品对象会**自动**被增强为人类可读的数据。无需任何 API 调用 —— 开箱即用。

#### 增强字段

| 字段 | 示例 | 来源 |
|---|---|---|
| `name` | `"R8左轮手枪 \| 头骨粉碎者"` | CSGO-API 中文数据（中文显示名） |
| `hash_name` | `"R8 Revolver \| Skull Crusher (Field-Tested)"` | CSGO-API 英文数据 + 英文磨损后缀（市场标准） |
| `market_name` | `"R8左轮手枪 \| 头骨粉碎者 (久经沙场)"` | `name` + 中文磨损名 |
| `exterior_name` | `"久经沙场"` | 中文磨损名（由 paint_wear 阈值映射） |
| `exterior_key` | `"wearcategory2"` | Valve 磨损标识符。marks 依赖 |
| `rarity_name` | `"保密级"` | 中文稀有度名（来自 CSGO-API） |
| `rarity_key` | `"legendary_weapon"` | Valve 稀有度标识符（CSGO-API rarity.id 去前缀）。marks 依赖 |
| `quality_name` | `"普通"` | 推断的品质显示名（普通 / ★ / StatTrak™ / ★ StatTrak™ / 纪念品） |
| `quality_key` | `"normal"` | Valve 品质标识符（normal / strange / unusual / unusual_strange / tournament）。marks 依赖 |
| `itemset_name` | `"棱彩武器箱"` | 中文武器箱/收藏品名（优先武器箱，回退收藏品） |
| `itemset_key` | `"set_community_22"` | Valve 物品集标识符（从 collection-set-xxx 转换）。marks 依赖。仅有武器箱的物品可能为 null |
| `recipe` | `4` | 炼金配方索引（`rarity - 1`，StatTrak 再 +10） |
| `pendant` | `null` | 挂件名称（如 `"挂件-1234"`）。无挂件时为 `null` |
| `stickers` | `[]` | 结构化印花数组（仅武器皮肤）：`[{slot, sticker_id, name, hash_name, wear}]` |
| `wear_min` | `0.06` | 皮肤最低磨损（CSGO-API min_float）。非皮肤物品为 `null` |
| `wear_max` | `0.8` | 皮肤最高磨损（CSGO-API max_float）。非皮肤物品为 `null` |
| `paint_wear_norm` | `0.35` | 归一化磨损：`(paint_wear - wear_min) / (wear_max - wear_min)`。wear_min 等于 wear_max 时为 `null` |
| `trade_protect` | `false` | 是否处于交易保护状态（属性 def_index=312） |
| `item_storage_total` | `null` | casket_contained_item_count 的别名 |
| `msg` | `null` | 增强状态：`null` = 成功，字符串 = 警告/错误 |

#### 自定义标记（可选）

Valve 原生标识符（如 `mythical_weapon`、`wearcategory0`）虽然精确，但并不总是对人类友好。如果你更希望使用简短的标记，可以通过 `init()` 传入自定义映射：

```js
csgo.init({
    marks: {
        rarity: {
            'common_weapon': 'XF',
            'uncommon_weapon': 'GY',
            'rare_weapon': 'JG',
            'mythical_weapon': 'SX',
            'legendary_weapon': 'BM',
            'ancient_weapon': 'YM'
        },
        quality: {
            'normal': 'PT',
            'strange': 'ST',
            'unusual': 'ST',
            'unusual_strange': 'ST',
            'tournament': 'ZN'
        },
        exterior: {
            'wearcategory0': 'ZX',
            'wearcategory1': 'LM',
            'wearcategory2': 'JJ',
            'wearcategory3': 'PS',
            'wearcategory4': 'ZH'
        },
        itemset: { 'set_community_3': 'PRIN' }
    }
});
```

当传入 `marks` 时，物品对象会额外拥有以下字段：

| 字段 | 取值依据 | 示例 |
|---|---|---|
| `rarity_mark` | `rarity_key` 的值 | `"BM"` |
| `quality_mark` | `quality_key` 的值 | `"ST"` |
| `exterior_mark` | `exterior_key` 的值 | `"JJ"` |
| `itemset_mark` | `itemset_key` 的值 | `"PRIN"` |
| `mark` | 组合（需 4 项齐全） | `"ST_BM_JJ_PRIN"` |

如果未传入 `marks`，这些字段将不会出现在物品对象上。

当传入 `marks` 时，会**自动生成**组合字段 `mark`，它将上述 4 个标记用 `_` 连接（仅当 4 个都不为 null 时）：

```
mark = quality_mark + "_" + rarity_mark + "_" + exterior_mark + "_" + itemset_mark
```

示例：`"ST_BM_JJ_PRIN"`。如果 4 个标记中任一为 null，则 `mark` 为空字符串 `""`。

#### 双语支持

物品名称使用**中文**（`name`、`market_name`、`exterior_name`、`rarity_name` 等），来自 CSGO-API 中文数据。`hash_name` 始终为英文（市场标准），来自 CSGO-API 英文数据。Valve 标识符（`*_key` 字段）与语言无关。

### 工具 API

| API | 说明 |
|---|---|
| `await csgo.ready()` | 等待增强器数据加载完成。返回一个 Promise。 |
| `csgo.init(opts)` | 配置增强器选项（标记、dataDir 等）。构造时会自动以默认值调用一次；如需自定义请再调用。**每次调用会替换之前所有选项**（不会合并）。 |
| `csgo.manifestId` | 当前已加载 schema 数据对应的 CS2 manifest ID（只读） |
| `csgo.on('enricherReady', fn)` | 增强器数据加载完成时触发。如果此时库存已经存在，会一次性批量增强；否则会在 GC 连接后自动增强。 |
| `csgo.on('enricherError', fn)` | 增强器数据加载失败时触发 |
| `csgo.on('downloadStart', fn)` | CSGO-API 数据下载开始时触发。参数：`{files, total}` |
| `csgo.on('fileProgress', fn)` | 单个文件下载进度。参数：`{key, label, phase, bytesDownloaded?, bytesTotal?, percent?}` |
| `csgo.on('downloadProgress', fn)` | 整体下载进度。参数：`{completed, total, overallPercent}` |
| `csgo.on('fileError', fn)` | 单个文件下载失败（可重试）。参数：`{key, label, error, attempt}` |
| `csgo.on('downloadDone', fn)` | 全部下载完成。参数：`{results, succeeded, failed}` |

#### `init(opts)` 选项

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `dataDir` | string | `./cs2-inventory-schema` | 自定义数据目录 |
| `marks` | object | `null` | 自定义标记映射（见 [自定义标记](#自定义标记可选)） |
| `checkIntervalHours` | number | `24` | 更新检查间隔 |
| `forceUpdate` | boolean | `false` | 强制重新下载所有文件 |
| `onDownloadProgress` | function | `null` | 整体下载进度回调：`(info) => {}`，info 为 `{completed, total, overallPercent}` |

### 数据来源与自动更新

物品数据自动从 [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) 下载（社区维护的结构化 JSON API）：

- **16 个文件**（8 种物品类型 x 中文 + 英文）：skins、music_kits、graffiti、keychains、sticker_slabs、highlights、stickers、collectibles
- **并行下载**，并发上限 8，每个文件 3 次重试
- **首次使用**：下载约 5MB
- **每次启动**：通过 GitHub API 检查哨兵文件 SHA。仅在数据更新或距上次下载超过 24 小时时才重新下载。
- **缓存位置**：`./cs2-inventory-schema/`（请加入 `.gitignore`）
- **进度事件**：`csgo.on('downloadProgress', fn)` 或 `init({ onDownloadProgress: fn })`
- **强制更新**：`csgo.init({ forceUpdate: true })`

---

## 安装

```bash
$ npm install cs2-inventory-kit
```

## 快速开始

```js
const SteamUser = require('steam-user');
const GlobalOffensive = require('cs2-inventory-kit');

let user = new SteamUser();
let csgo = new GlobalOffensive(user);

csgo.on('connectedToGC', async () => {
    // 等待增强器下载物品数据完成（首次约 5MB）
    await csgo.ready();

    // 现在所有物品都已增强：name、hash_name、rarity_name 等
    console.log(`库存：${csgo.inventory.length} 件物品`);
    csgo.inventory.forEach(item => {
        console.log(`${item.name} (${item.exterior_name}) [${item.rarity_key}]`);
    });
});

// 挂件移除次数
csgo.on('keychainCharges', (charges) => {
    console.log(`挂件移除工具剩余次数：${charges}`);
});

user.logOn({ refreshToken: 'your-refresh-token' });
user.on('loggedOn', () => {
    user.gamesPlayed([730]);
});
```

## 参与贡献

发现 Bug 或有功能建议？欢迎[提交 Issue](https://github.com/Joclto/cs2-inventory-kit/issues)。

想提问或发起开放式讨论？欢迎到 [GitHub Discussions](https://github.com/Joclto/cs2-inventory-kit/discussions)。

欢迎提交 Pull Request。较大改动建议先开 Issue 讨论一下方向。

---

## 许可证

MIT。详见 [LICENSE](./LICENSE)。
