# cs2-inventory-kit

[![license](https://img.shields.io/github/license/Joclto/cs2-inventory-kit.svg)](https://github.com/Joclto/cs2-inventory-kit/blob/master/LICENSE)
[![fork](https://img.shields.io/badge/fork%20of-node--globaloffensive-blue.svg)](https://github.com/DoctorMcKay/node-globaloffensive)

**Inventory-focused CS2 Game Coordinator library with built-in item data enrichment.**

## Compatibility

This library is a **drop-in replacement** for [node-globaloffensive](https://github.com/DoctorMcKay/node-globaloffensive). All existing methods, events, and properties are fully supported with zero code changes.

**Complete API reference**: [node-globaloffensive README](https://github.com/DoctorMcKay/node-globaloffensive#readme)

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
| `name` | `"★ Karambit \| Fade"` | items_game + default language translation |
| `hash_name` | `"★ Karambit \| Fade (Factory New)"` | items_game + english translation (market standard) |
| `exterior_name` | `"Factory New"` | English wear name (derived from `paint_wear`) |
| `market_name` | `"★ Karambit \| Fade (Factory New)"` | `name` + `exterior_name` |
| `rarity_name` | `"mythical_weapon"` | Valve identifier (from items_game `rarities`) |
| `quality_name` | `"strange"` | Valve identifier (`normal` / `strange`) |
| `wear_category` | `"wearcategory0"` | Valve identifier (from items_game `wear_blocks`) |
| `recipe` | `0`-`4` / `10`-`14` | Trade-up recipe index (`rarity - 1`, +10 if StatTrak) |
| `item_set` | `"set_community_3"` | Original key from items_game `item_sets` |
| `pendant` | `"挂件-1234"` | Keychain name (follows `defaultLanguage`) |
| `trade_protect` | `false` | Whether item is gift-restricted (attribute `def_index=312`). Does NOT indicate Steam market tradability |
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

When `marks` is provided, items will have these additional fields:

| Field | Key source | Example |
|---|---|---|
| `rarity_mark` | `rarity_name` value | `"SX"` |
| `quality_mark` | `quality_name` value | `"ST"` |
| `exterior_mark` | `wear_category` value | `"JJ"` |
| `itemset_mark` | `item_set` value | `"PRIN"` |

If `marks` is not provided, these fields will not exist on item objects.

#### Multi-Language Support

The `name` field uses **Simplified Chinese** by default. `hash_name` and `exterior_name` are always English (market standard).

Change the default language for `name`:

```js
csgo.init({ defaultLanguage: 'english' });
// Now item.name uses English translations
// item.name = "★ Karambit | Fade" (English)
```

Add more languages for `name_{lang}` fields:

```js
csgo.init({
    defaultLanguage: 'french',         // item.name → French
    languages: ['japanese', 'tchinese'] // item.name_japanese, item.name_tchinese
});
```

Supported keywords (29 languages): `brazilian`, `bulgarian`, `czech`, `danish`, `dutch`, `english`, `finnish`, `french`, `german`, `greek`, `hungarian`, `italian`, `japanese`, `koreana`, `latam`, `norwegian`, `polish`, `portuguese`, `romanian`, `russian`, `schinese`, `schinese_pw`, `spanish`, `swedish`, `tchinese`, `thai`, `turkish`, `ukrainian`, `vietnamese`.

### Utility APIs

| API | Description |
|---|---|
| `await csgo.ready()` | Wait for enricher data to be loaded. Returns a Promise. |
| `csgo.init(opts)` | Configure enricher options (languages, marks, dataDir, etc.). Called automatically on construction with defaults; call this to customize. **Each call replaces all previous options** (not merged). |
| `csgo.manifestId` | CS2 manifest ID of the currently loaded schema data (read-only) |
| `csgo.on('enricherReady', fn)` | Emitted when enricher data is loaded. If inventory is already available, it will be batch-enriched at this point. If not, items will be enriched automatically when GC connects. |
| `csgo.on('enricherError', fn)` | Emitted if enricher fails to load data |

#### `init(opts)` Options

| Option | Type | Default | Description |
|---|---|---|---|
| `dataDir` | string | `./cs2-inventory-schema` | Custom data directory |
| `defaultLanguage` | string | `schinese` | Language for the `name` field. Auto-downloaded if not schinese/english |
| `languages` | string[] | `[]` | Additional languages for `name_{lang}` fields |
| `marks` | object | `null` | Custom mark mappings (see [Custom Marks](#custom-marks-optional)) |
| `checkIntervalHours` | number | `24` | Update check interval |
| `forceUpdate` | boolean | `false` | Force re-download all files |

### Data Source & Auto-Update

Item schema data is automatically downloaded from [ByMykel/counter-strike-file-tracker](https://github.com/ByMykel/counter-strike-file-tracker):

- **First use**: Downloads ~20MB (items_game + schinese + english JSON)
- **Each startup**: Checks GitHub API for SHA changes (~3KB). Downloads only if updated or if 24 hours have passed since last download.
- **Cache location**: `./cs2-inventory-schema/` (add to `.gitignore`)
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
    // Wait for enricher to finish downloading item data (~20MB on first run)
    await csgo.ready();

    // Now all items are enriched with name, hash_name, rarity_name, etc.
    console.log(`Inventory: ${csgo.inventory.length} items`);
    csgo.inventory.forEach(item => {
        console.log(`${item.name} (${item.exterior_name}) [${item.rarity_name}]`);
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

## License

MIT. See [LICENSE](./LICENSE).
