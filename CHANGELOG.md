# Changelog

## [2.1.1](https://github.com/Joclto/cs2-inventory-kit/compare/v2.1.0...v2.1.1) (2026-07-01)


### Bug Fixes

* market_name concatenating null when item has no paint_wear ([af49c81](https://github.com/Joclto/cs2-inventory-kit/commit/af49c810c8ca152144de3cf069c6fed7ce091f5d))

## [2.1.0](https://github.com/Joclto/cs2-inventory-kit/compare/v2.0.2...v2.1.0) (2026-07-01)


### Features

* add exterior_mark_norm, mark_norm, and hash_wear_seed_key fields ([d1bf6ae](https://github.com/Joclto/cs2-inventory-kit/commit/d1bf6ae1e282b1fe58aa50292cde43ce84afebc2))

## [2.0.2](https://github.com/Joclto/cs2-inventory-kit/compare/v2.0.1...v2.0.2) (2026-07-01)


### Bug Fixes

* add missing var self declaration in constructor setImmediate ([755d99e](https://github.com/Joclto/cs2-inventory-kit/commit/755d99e86a43f55295425411db83b34dac3c0870))

## [2.0.1](https://github.com/Joclto/cs2-inventory-kit/compare/v2.0.0...v2.0.1) (2026-07-01)


### Bug Fixes

* defer enricher init to next tick so download events are catchable ([9a6ceaf](https://github.com/Joclto/cs2-inventory-kit/commit/9a6ceafeea236e17c49791b5e9c32096f3ac1517))

## [2.0.0](https://github.com/Joclto/cs2-inventory-kit/compare/v1.2.2...v2.0.0) (2026-07-01)


### ⚠ BREAKING CHANGES

* data source switched from items_game to CSGO-API; multi-language support removed (29 langs → zh-CN + en only); rarity_name/quality_name/exterior_name now Chinese; marks keys changed to Valve identifiers (*_key fields); added *_key fields, wear_min/wear_max/paint_wear_norm/stickers

### Features

* migrate to CSGO-API data source, remove multi-language support ([4afde29](https://github.com/Joclto/cs2-inventory-kit/commit/4afde29c6851b369d8278d7723f8e914a6f23e31))

## [1.2.2](https://github.com/Joclto/cs2-inventory-kit/compare/v1.2.1...v1.2.2) (2026-06-20)


### Bug Fixes

* harden wear name fallback and localized display null guards ([77480ed](https://github.com/Joclto/cs2-inventory-kit/commit/77480eda3e165443e8bf970681e57eefeac0749c))
