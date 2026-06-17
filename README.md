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
| `recipe` | `4` or `14` | Trade-up recipe index (`rarity - 1`, +10 if StatTrak) |
| `item_set` | `"set_community_3"` | Original key from items_game `item_sets` |
| `pendant` | `"挂件-1234"` | Keychain name from `keychain_definitions` |
| `trade_protect` | `false` | Whether item has attribute `def_index=312` |
| `item_storage_total` | `62` | Same as `casket_contained_item_count` |
| `msg` | `null` | Enrichment status: `null` = success, string = warning/error |

> **Design principle**: Only Valve-native identifiers are used (e.g. `mythical_weapon`, not custom abbreviations like `SX`). Application-specific mappings should be done in your own code.

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
| `csgo.init(opts)` | Re-initialize enricher with custom options (see below) |
| `csgo.manifestId` | CS2 manifest ID of the currently loaded schema data (read-only) |
| `csgo.on('enricherReady', fn)` | Emitted when enricher data is loaded and inventory is enriched |
| `csgo.on('enricherError', fn)` | Emitted if enricher fails to load data |

#### `init(opts)` Options

| Option | Type | Default | Description |
|---|---|---|---|
| `dataDir` | string | `./cs2-inventory-schema` | Custom data directory |
| `defaultLanguage` | string | `schinese` | Language for the `name` field. Auto-downloaded if not schinese/english |
| `languages` | string[] | `[]` | Additional languages for `name_{lang}` fields |
| `checkIntervalHours` | number | `24` | Update check interval |
| `forceUpdate` | boolean | `false` | Force re-download all files |

### Data Source & Auto-Update

Item schema data is automatically downloaded from [ByMykel/counter-strike-file-tracker](https://github.com/ByMykel/counter-strike-file-tracker):

- **First use**: Downloads ~20MB (items_game + schinese + english JSON)
- **Each startup**: Checks GitHub API for SHA changes (~3KB). Downloads only if updated or if 24 hours have passed since last download.
- **Cache location**: `./cs2-inventory-schema/` (add to `.gitignore`)
- **Force update**: `npx cs2-inventory-kit-fetch --force`

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

// Enricher is automatic — items will have name, hash_name, rarity_name, etc.
csgo.on('connectedToGC', () => {
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
