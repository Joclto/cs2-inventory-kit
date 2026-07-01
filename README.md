<div align="center">

[![npm version](https://img.shields.io/npm/v/cs2-inventory-kit.svg)](https://npmjs.com/package/cs2-inventory-kit) [![npm downloads](https://img.shields.io/npm/dm/cs2-inventory-kit.svg)](https://npmjs.com/package/cs2-inventory-kit) [![Node.js Version](https://img.shields.io/node/v/cs2-inventory-kit.svg)](https://npmjs.com/package/cs2-inventory-kit) [![license](https://img.shields.io/github/license/Joclto/cs2-inventory-kit.svg)](https://github.com/Joclto/cs2-inventory-kit/blob/master/LICENSE) [![fork](https://img.shields.io/badge/fork%20of-node--globaloffensive-blue.svg)](https://github.com/DoctorMcKay/node-globaloffensive)

# cs2-inventory-kit

**Inventory-focused CS2 Game Coordinator library with built-in item data enrichment.**

[简体中文](./README.zh-CN.md) | English

</div>

## Relationship to node-globaloffensive

This library **extends and improves** [node-globaloffensive](https://github.com/DoctorMcKay/node-globaloffensive) — it is 100% backward compatible, so all existing methods, events, and properties continue to work with zero code changes, while adding built-in item data enrichment, keychain support, item enrichment via CSGO-API, and more.

**Complete API reference for the inherited API**: [node-globaloffensive README](https://github.com/DoctorMcKay/node-globaloffensive#readme)

To migrate, simply change your `require` statement:

```js
// Before
const GlobalOffensive = require('globaloffensive');

// After
const GlobalOffensive = require('cs2-inventory-kit');
```

That's it. Everything else works exactly the same.

> **Fork Notice**: Based on [node-globaloffensive](https://github.com/DoctorMcKay/node-globaloffensive) by Alexander Corn (MIT License).

---

## What's New

### Keychain Support

Methods and events for CS2 keychain (weapon charm) operations:

| API | Type | Description |
|---|---|---|
| `csgo.applyKeychain(itemId, keychainId[, keychainSlot])` | Method | Apply a keychain to a weapon (keychain item is consumed) |
| `csgo.removeKeychain(itemId)` | Method | Remove a keychain from a weapon (consumes one removal tool charge) |
| `csgo.keychainCharges` | Property (read-only) | Remaining keychain removal tool charges. `undefined` until GC pushes data |
| `csgo.on('keychainCharges', fn)` | Event | Emitted when charges change (on GC connect, after removal, etc.) |

### Item Data Enrichment (Automatic)

Item objects in `inventory`, `itemAcquired`, `itemChanged`, and `getCasketContents` are **automatically enriched** with human-readable data. No API call needed — it just works.

#### Enriched Fields

| Field | Example | Source |
|---|---|---|
| `name` | `"R8左轮手枪 \| 头骨粉碎者"` | CSGO-API zh-CN (Chinese display name) |
| `hash_name` | `"R8 Revolver \| Skull Crusher (Field-Tested)"` | CSGO-API en + English wear suffix (market standard) |
| `market_name` | `"R8左轮手枪 \| 头骨粉碎者 (久经沙场)"` | `name` + Chinese wear name |
| `exterior_name` | `"久经沙场"` | Chinese wear name (from paint_wear thresholds) |
| `exterior_key` | `"wearcategory2"` | Valve wear identifier. Used by `marks` |
| `rarity_name` | `"保密级"` | Chinese rarity name (from CSGO-API) |
| `rarity_key` | `"legendary_weapon"` | Valve rarity identifier (from CSGO-API rarity.id, prefix stripped). Used by `marks` |
| `quality_name` | `"普通"` | Inferred quality display name (普通 / ★ / StatTrak™ / ★ StatTrak™ / 纪念品) |
| `quality_key` | `"normal"` | Valve quality identifier (normal / strange / unusual / unusual_strange / tournament). Used by `marks` |
| `itemset_name` | `"棱彩武器箱"` | Chinese crate/collection name (crates priority, fallback collections) |
| `itemset_key` | `"set_community_22"` | Valve itemset identifier (from collection-set-xxx id). Used by `marks`. May be null for crate-only items |
| `recipe` | `4` | Trade-up recipe index (`rarity - 1`, +10 if StatTrak) |
| `pendant` | `null` | Keychain name (e.g. `"挂件-1234"`). `null` if none |
| `stickers` | `[]` | Structured sticker array (weapon skins only): `[{slot, sticker_id, name, hash_name, wear}]` |
| `wear_min` | `0.06` | Skin min_float (from CSGO-API). `null` for non-skin items |
| `wear_max` | `0.8` | Skin max_float (from CSGO-API). `null` for non-skin items |
| `paint_wear_norm` | `0.35` | Normalized wear: `(paint_wear - wear_min) / (wear_max - wear_min)`. `null` if wear_min == wear_max |
| `trade_protect` | `false` | Trade-protected (attribute def_index=312) |
| `item_storage_total` | `null` | Alias for casket_contained_item_count |
| `msg` | `null` | Enrichment status: `null` = success, string = warning/error |

#### Custom Marks (Optional)

Valve-native identifiers (e.g. `mythical_weapon`, `wearcategory0`) are precise but not always human-friendly. If you prefer short marks, pass custom mappings via `init()`:

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

When `marks` is provided, items will have these additional fields:

| Field | Key source | Example |
|---|---|---|
| `rarity_mark` | `rarity_key` value | `"SX"` |
| `quality_mark` | `quality_key` value | `"ST"` |
| `exterior_mark` | `exterior_key` value | `"JJ"` |
| `itemset_mark` | `itemset_key` value | `"PRIN"` |
| `mark` | Combined (all 4 required) | `"ST_BM_JJ_PRIN"` |

If `marks` is not provided, these fields will not exist on item objects.

When `marks` is provided, a combined `mark` field is **automatically generated** — it joins all 4 marks with `_` (only when all 4 are non-null):

```
mark = quality_mark + "_" + rarity_mark + "_" + exterior_mark + "_" + itemset_mark
```

Example: `"ST_SX_ZX_PRIN"`. If any of the 4 marks is null, `mark` will be an empty string `""`.

#### Bilingual Support

Item names use **Chinese** (`name`, `market_name`, `exterior_name`, `rarity_name`, etc.) from CSGO-API zh-CN data. `hash_name` is always English (market standard) from CSGO-API en data. Valve identifiers (`*_key` fields) are language-independent.

### Utility APIs

| API | Description |
|---|---|
| `await csgo.ready()` | Wait for enricher data to be loaded. Returns a Promise. |
| `csgo.init(opts)` | Configure enricher options (marks, dataDir, etc.). Called automatically on construction with defaults; call this to customize. **Each call replaces all previous options** (not merged). |
| `csgo.manifestId` | CS2 manifest ID of the currently loaded schema data (read-only) |
| `csgo.on('enricherReady', fn)` | Emitted when enricher data is loaded. If inventory is already available, it will be batch-enriched at this point. If not, items will be enriched automatically when GC connects. |
| `csgo.on('enricherError', fn)` | Emitted if enricher fails to load data |
| `csgo.on('downloadStart', fn)` | Emitted when CSGO-API data download begins. Payload: `{files, total}` |
| `csgo.on('fileProgress', fn)` | Per-file download progress. Payload: `{key, label, phase, bytesDownloaded?, bytesTotal?, percent?}` |
| `csgo.on('downloadProgress', fn)` | Overall download progress. Payload: `{completed, total, overallPercent}` |
| `csgo.on('fileError', fn)` | Single file download error (retryable). Payload: `{key, label, error, attempt}` |
| `csgo.on('downloadDone', fn)` | All downloads complete. Payload: `{results, succeeded, failed}` |

#### `init(opts)` Options

| Option | Type | Default | Description |
|---|---|---|---|
| `dataDir` | string | `./cs2-inventory-schema` | Custom data directory |
| `marks` | object | `null` | Custom mark mappings (see [Custom Marks](#custom-marks-optional)) |
| `checkIntervalHours` | number | `24` | Update check interval |
| `forceUpdate` | boolean | `false` | Force re-download all files |
| `onDownloadProgress` | function | `null` | Callback for overall download progress: `(info) => {}` where info is `{completed, total, overallPercent}` |

### Data Source & Auto-Update

Item data is automatically downloaded from [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) — a community-maintained structured JSON API:

- **16 files** (8 item types x zh-CN + en): skins, music_kits, graffiti, keychains, sticker_slabs, highlights, stickers, collectibles
- **Parallel download** with concurrency limit 8, 3 retries per file
- **First use**: Downloads ~5MB
- **Each startup**: Checks canary file SHA via GitHub API. Downloads only if updated or if 24 hours have passed.
- **Cache location**: `./cs2-inventory-schema/` (add to `.gitignore`)
- **Progress events**: `csgo.on('downloadProgress', fn)` or `init({ onDownloadProgress: fn })`
- **Force update**: `csgo.init({ forceUpdate: true })`

---

## Install

```bash
$ npm install cs2-inventory-kit
```

## Quick Start

```js
const SteamUser = require('steam-user');
const GlobalOffensive = require('cs2-inventory-kit');

let user = new SteamUser();
let csgo = new GlobalOffensive(user);

csgo.on('connectedToGC', async () => {
    // Wait for enricher to finish downloading item data (~5MB on first run)
    await csgo.ready();

    // Now all items are enriched with name, hash_name, rarity_name, etc.
    console.log(`Inventory: ${csgo.inventory.length} items`);
    csgo.inventory.forEach(item => {
        console.log(`${item.name} (${item.exterior_name}) [${item.rarity_key}]`);
    });
});

// Keychain charges
csgo.on('keychainCharges', (charges) => {
    console.log(`Keychain removal tool charges: ${charges}`);
});

user.logOn({ refreshToken: 'your-refresh-token' });
user.on('loggedOn', () => {
    user.gamesPlayed([730]);
});
```

## Contributing

Found a bug or have a feature idea? [Open an issue](https://github.com/Joclto/cs2-inventory-kit/issues).

Want to ask a question or start an open-ended discussion? Use [GitHub Discussions](https://github.com/Joclto/cs2-inventory-kit/discussions).

Pull requests are welcome. For non-trivial changes, please open an issue first to discuss what you'd like to change.

---

## License

MIT. See [LICENSE](./LICENSE).
