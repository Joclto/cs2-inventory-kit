<div align="center">

[![npm version](https://img.shields.io/npm/v/cs2-inventory-kit.svg)](https://npmjs.com/package/cs2-inventory-kit) [![npm downloads](https://img.shields.io/npm/dm/cs2-inventory-kit.svg)](https://npmjs.com/package/cs2-inventory-kit) [![Node.js Version](https://img.shields.io/node/v/cs2-inventory-kit.svg)](https://npmjs.com/package/cs2-inventory-kit) [![license](https://img.shields.io/github/license/Joclto/cs2-inventory-kit.svg)](https://github.com/Joclto/cs2-inventory-kit/blob/master/LICENSE) [![fork](https://img.shields.io/badge/fork%20of-node--globaloffensive-blue.svg)](https://github.com/DoctorMcKay/node-globaloffensive)

# cs2-inventory-kit

**专注于库存的 CS2 Game Coordinator 库，内置物品数据增强。**

English | [简体中文](./README.md)

</div>

## 与 node-globaloffensive 的关系

本库在 [node-globaloffensive](https://github.com/DoctorMcKay/node-globaloffensive) 的基础上**延伸与改进** —— 100% 向后兼容，所有现有的方法、事件和属性无需任何代码改动即可照常使用，同时新增了内置物品数据增强、钥匙链支持、多语言名称等功能。

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

### 钥匙链（Keychain）支持

用于 CS2 钥匙链（武器挂件）操作的方法与事件：

| API | 类型 | 说明 |
|---|---|---|
| `csgo.applyKeychain(itemId, keychainId[, keychainSlot])` | 方法 | 给武器应用一个钥匙链（消耗该钥匙链物品） |
| `csgo.removeKeychain(itemId)` | 方法 | 从武器移除钥匙链（消耗一次移除工具次数） |
| `csgo.keychainCharges` | 属性（只读） | 剩余的钥匙链移除工具次数。在 GC 推送数据之前为 `undefined` |
| `csgo.on('keychainCharges', fn)` | 事件 | 在次数变化时触发（GC 连接、移除操作后等） |

### 物品数据增强（自动）

`inventory`、`itemAcquired`、`itemChanged` 以及 `getCasketContents` 中的物品对象会**自动**被增强为人类可读的数据。无需任何 API 调用 —— 开箱即用。

#### 增强字段

| 字段 | 示例 | 来源 |
|---|---|---|
| `name` | `"★ Karambit \| Fade"` | items_game + 默认语言翻译 |
| `hash_name` | `"★ Karambit \| Fade (Factory New)"` | items_game + 英文翻译（市场标准） |
| `exterior_name` | `"Factory New"` | 英文磨损名称（由 `paint_wear` 推导）。始终为英文，用于向后兼容和市场标准 |
| `market_name` | `"★ Karambit \| Fade (Factory New)"` | `name` + `exterior_name`（英文磨损） |
| `exterior_name_local` | `"崭新出厂"` | 本地化磨损名称，跟随 `defaultLanguage`。翻译不可用时省略 |
| `market_name_local` | `"★ Karambit \| Fade (崭新出厂)"` | `name` + `exterior_name_local`。仅当 `exterior_name_local` 存在时才有 |
| `rarity_name` | `"mythical_weapon"` | Valve 标识符（来自 items_game 的 `rarities`） |
| `quality_name` | `"strange"` | Valve 标识符（`normal` / `strange`） |
| `wear_category` | `"wearcategory0"` | Valve 标识符（来自 items_game 的 `wear_blocks`） |
| `recipe` | `0`-`4` / `10`-`14` | 炼金配方索引（`rarity - 1`，StatTrak 则 +10） |
| `item_set` | `"set_community_3"` | items_game `item_sets` 的原始 key |
| `pendant` | `"挂件-1234"` | 钥匙链名称（跟随 `defaultLanguage`） |
| `trade_protect` | `false` | 物品是否受礼物赠送限制（属性 `def_index=312`）。**并不**表示 Steam 市场可交易性 |
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
            'strange': 'ST'
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
| `rarity_mark` | `rarity_name` 的值 | `"SX"` |
| `quality_mark` | `quality_name` 的值 | `"ST"` |
| `exterior_mark` | `wear_category` 的值 | `"JJ"` |
| `itemset_mark` | `item_set` 的值 | `"PRIN"` |
| `mark` | 组合（需 4 项齐全） | `"ST_SX_JJ_PRIN"` |

如果未传入 `marks`，这些字段将不会出现在物品对象上。

当传入 `marks` 时，会**自动生成**组合字段 `mark` —— 它将上述 4 个标记用 `_` 连接（仅当 4 个都不为 null 时）：

```
mark = quality_mark + "_" + rarity_mark + "_" + exterior_mark + "_" + itemset_mark
```

示例：`"ST_SX_ZX_PRIN"`。如果 4 个标记中任一为 null，则 `mark` 为空字符串 `""`。

#### 多语言支持

`name` 字段默认使用**简体中文**。`hash_name` 和 `exterior_name` 始终为英文（市场标准）。

修改 `name` 的默认语言：

```js
csgo.init({ defaultLanguage: 'english' });
// 现在 item.name 使用英文翻译
// item.name = "★ Karambit | Fade"（英文）
```

为 `name_{lang}` 字段添加更多语言。每个额外语言还会同时生成本地化的磨损字段 `exterior_name_{lang}` 和 `market_name_{lang}`（当物品有磨损且对应翻译存在时）：

```js
csgo.init({
    defaultLanguage: 'french',         // item.name / exterior_name_local / market_name_local → 法语
    languages: ['japanese', 'tchinese'] // item.name_japanese、item.exterior_name_japanese、item.market_name_japanese ……（tchinese 同理）
});
```

支持的关键字（29 种语言）：`brazilian`、`bulgarian`、`czech`、`danish`、`dutch`、`english`、`finnish`、`french`、`german`、`greek`、`hungarian`、`italian`、`japanese`、`koreana`、`latam`、`norwegian`、`polish`、`portuguese`、`romanian`、`russian`、`schinese`、`schinese_pw`、`spanish`、`swedish`、`tchinese`、`thai`、`turkish`、`ukrainian`、`vietnamese`。

### 工具 API

| API | 说明 |
|---|---|
| `await csgo.ready()` | 等待增强器数据加载完成。返回一个 Promise。 |
| `csgo.init(opts)` | 配置增强器选项（语言、标记、dataDir 等）。构造时会自动以默认值调用一次；如需自定义请再调用。**每次调用会替换之前所有选项**（不会合并）。 |
| `csgo.manifestId` | 当前已加载 schema 数据对应的 CS2 manifest ID（只读） |
| `csgo.on('enricherReady', fn)` | 增强器数据加载完成时触发。如果此时库存已经存在，会一次性批量增强；否则会在 GC 连接后自动增强。 |
| `csgo.on('enricherError', fn)` | 增强器数据加载失败时触发 |

#### `init(opts)` 选项

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `dataDir` | string | `./cs2-inventory-schema` | 自定义数据目录 |
| `defaultLanguage` | string | `schinese` | `name` 字段使用的语言。若非 schinese/english 则会自动下载 |
| `languages` | string[] | `[]` | 额外语言，用于生成 `name_{lang}` 字段 |
| `marks` | object | `null` | 自定义标记映射（见 [自定义标记](#自定义标记可选)） |
| `checkIntervalHours` | number | `24` | 更新检查间隔 |
| `forceUpdate` | boolean | `false` | 强制重新下载所有文件 |

### 数据来源与自动更新

物品 schema 数据会自动从 [ByMykel/counter-strike-file-tracker](https://github.com/ByMykel/counter-strike-file-tracker) 下载：

- **首次使用**：下载约 20MB（items_game + schinese + english 的 JSON）
- **每次启动**：通过 GitHub API 检查 SHA 是否变化（约 3KB）。仅在已更新或距上次下载超过 24 小时时才下载。
- **缓存位置**：`./cs2-inventory-schema/`（请加入 `.gitignore`）
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
    // 等待增强器下载物品数据完成（首次约 20MB）
    await csgo.ready();

    // 现在所有物品都已增强：name、hash_name、rarity_name 等
    console.log(`库存：${csgo.inventory.length} 件物品`);
    csgo.inventory.forEach(item => {
        console.log(`${item.name} (${item.exterior_name}) [${item.rarity_name}]`);
    });
});

// 钥匙链移除次数
csgo.on('keychainCharges', (charges) => {
    console.log(`钥匙链移除工具剩余次数：${charges}`);
});

user.logOn({ refreshToken: 'your-refresh-token' });
user.on('loggedOn', () => {
    user.gamesPlayed([730]);
});
```

## 许可证

MIT。详见 [LICENSE](./LICENSE)。
