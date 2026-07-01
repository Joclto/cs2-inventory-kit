# Changelog

## [2.0.0](https://github.com/Joclto/cs2-inventory-kit/compare/v1.2.2...v2.0.0) (2026-07-01)


### ⚠ BREAKING CHANGES

* data source switched from items_game to CSGO-API; multi-language support removed (29 langs → zh-CN + en only); rarity_name/quality_name/exterior_name now Chinese; marks keys changed to Valve identifiers (*_key fields); added *_key fields, wear_min/wear_max/paint_wear_norm/stickers

### Features

* migrate to CSGO-API data source, remove multi-language support ([4afde29](https://github.com/Joclto/cs2-inventory-kit/commit/4afde29c6851b369d8278d7723f8e914a6f23e31))

## [1.2.2](https://github.com/Joclto/cs2-inventory-kit/compare/v1.2.1...v1.2.2) (2026-06-20)


### Bug Fixes

* harden wear name fallback and localized display null guards ([77480ed](https://github.com/Joclto/cs2-inventory-kit/commit/77480eda3e165443e8bf970681e57eefeac0749c))
