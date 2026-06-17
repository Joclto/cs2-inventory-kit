/**
 * ItemProcessor — CS2 物品数据富化模块
 *
 * 基于 node_service/itemProcessor.js 改造：
 * - 去掉 PG 依赖（loadItemSetMark）
 * - 去掉 VDF 解析（直接吃 JSON）
 * - 去掉业务 mark 系统（rarity_mark / quality_mark / exterior_mark / mark）
 * - 新增 Valve 原始标识符（rarity_name / quality_name / wear_category）
 * - 新增 msg 字段（解析失败时的诊断信息）
 * - 保留 recipe（业务计算的汰换索引）
 *
 * 设计原则：只做解析，不做业务约定。
 */

class ItemProcessor {
    constructor(data) {
        this.csgoItems = {};
        this.translation = {};
        this.englishTranslation = {};
        this.extraTranslations = {};

        this.loadItemsGame(data.itemsGame);
        this.loadTranslations(data.schinese);
        this.loadEnglishTranslations(data.english);
    }

    // ============================================================
    // 数据加载（直接吃 JSON，不做 VDF 解析）
    // ============================================================

    loadItemsGame(jsonData) {
        const item_sets = this.extractSection(jsonData, 'item_sets');
        const name_to_set_map = {};

        for (const [caseName, info] of Object.entries(item_sets)) {
            if (info.items) {
                for (const itemName of Object.keys(info.items)) {
                    name_to_set_map[itemName] = caseName;
                }
            }
        }

        this.csgoItems = {
            items: this.extractSection(jsonData, 'items'),
            paint_kits: this.extractSection(jsonData, 'paint_kits'),
            prefabs: this.extractSection(jsonData, 'prefabs'),
            sticker_kits: this.extractSection(jsonData, 'sticker_kits'),
            music_kits: this.extractSection(jsonData, 'music_definitions'),
            graffiti_tints: this.extractSection(jsonData, 'graffiti_tints'),
            keychain_definitions: this.extractSection(jsonData, 'keychain_definitions'),
            highlight_reels: this.extractSection(jsonData, 'highlight_reels'),
            item_sets: item_sets,
            name_to_set_map: name_to_set_map,
            casket_icons: jsonData?.items_game?.alternate_icons2?.casket_icons || {},
            rarities: this.extractSection(jsonData, 'rarities'),
            wear_blocks: this.extractSection(jsonData, 'wear_blocks'),
        };
    }

    loadTranslations(jsonData) {
        this.translation = this.parseTranslationJson(jsonData);
    }

    loadEnglishTranslations(jsonData) {
        this.englishTranslation = this.parseTranslationJson(jsonData);
    }

    parseTranslationJson(jsonData) {
        const finalDict = {};
        const tokens = jsonData?.lang?.Tokens || jsonData?.Tokens || jsonData || {};
        for (const [key, value] of Object.entries(tokens)) {
            if (typeof value === 'string') {
                finalDict[key.toLowerCase()] = value;
            }
        }
        return finalDict;
    }

    setExtraLanguage(lang, jsonData) {
        this.extraTranslations[lang] = this.parseTranslationJson(jsonData);
    }

    extractSection(jsonData, sectionName) {
        const returnDict = {};
        const section = jsonData?.items_game?.[sectionName];
        if (section) {
            for (const [key, value] of Object.entries(section)) {
                returnDict[key] = value;
            }
        }
        return returnDict;
    }

    // ============================================================
    // 主处理方法
    // ============================================================

    processItem(storageRow) {
        const result = {
            appid: 730,
            assetid: storageRow.id,
            paint_wear: storageRow.paint_wear,
            trade_protect: this.isTradeProtect(storageRow),
            custom_name: storageRow.custom_name,
            custom_desc: storageRow.custom_desc,
            paint_index: storageRow.paint_index,
            paint_seed: storageRow.paint_seed,
            account_id: storageRow.account_id,
            def_index: storageRow.def_index,
            quality: storageRow.quality,
            rarity: storageRow.rarity,
            item_origin: storageRow.origin,
            position: storageRow.position,
            casket_contained_item_count: storageRow.casket_contained_item_count,
            casket_id: storageRow.casket_id,
            tradable_after: storageRow.tradable_after
        };

        try {
            result.name = this.getItemName(storageRow);
            result.hash_name = this.getItemHashName(storageRow);
            result.item_set = this.getCaseName(storageRow);
            result.pendant = this.getPendant(storageRow);

            // 磨损相关
            if (storageRow.paint_wear !== undefined) {
                result.exterior_name = this.getPaintWearName(storageRow.paint_wear);
                result.market_name = result.name + ' (' + result.exterior_name + ')';
            }

            // Valve 原始标识符
            result.rarity_name = this.getRarityName(storageRow.rarity);
            result.quality_name = this.getQualityName(storageRow.quality);
            result.wear_category = storageRow.paint_wear !== undefined
                ? this.getWearCategory(storageRow.paint_wear) : null;

            // 刀具标记（★）
            if (storageRow.quality == 3) {
                result.name = '★ ' + result.name;
                result.hash_name = '★ ' + result.hash_name;
            }

            // 容器物品数量
            if (storageRow.casket_contained_item_count !== undefined) {
                result.item_storage_total = storageRow.casket_contained_item_count;
            }

            // recipe（业务计算的汰换索引）
            if (storageRow.rarity) {
                result.recipe = storageRow.rarity - 1;
                if (result.quality_name === 'strange') {
                    result.recipe += 10;
                }
            }

            // 多语言 name
            for (const [lang, translations] of Object.entries(this.extraTranslations)) {
                const extraName = this.getItemName(storageRow, translations);
                if (extraName) {
                    result['name_' + lang] = extraName;
                }
            }

        } catch (error) {
            result.msg = error.message;
        }

        return result;
    }

    // ============================================================
    // Valve 标识符解析（新增）
    // ============================================================

    getRarityName(rarity) {
        // 从 items_game.json 的 rarities 段落动态查
        // 格式：{ "rarity_mythical": { "value": "4" }, ... }
        if (this.csgoItems.rarities) {
            for (const [key, val] of Object.entries(this.csgoItems.rarities)) {
                if (val.value == rarity) {
                    return key.replace(/^rarity_/, '') + '_weapon';
                }
            }
        }
        // fallback 硬编码
        const map = {
            1: 'common_weapon', 2: 'uncommon_weapon', 3: 'rare_weapon',
            4: 'mythical_weapon', 5: 'legendary_weapon', 6: 'ancient_weapon'
        };
        return map[rarity] || null;
    }

    getQualityName(quality) {
        const map = { 4: 'normal', 9: 'strange' };
        return map[quality] || null;
    }

    getWearCategory(paintWear) {
        // 从 items_game.json 的 wear_blocks 段落动态读取区间
        if (this.csgoItems.wear_blocks) {
            const defaultBlocks = this.csgoItems.wear_blocks.wear_blocks_default
                || this.csgoItems.wear_blocks;
            for (const [key, block] of Object.entries(defaultBlocks)) {
                const min = parseFloat(block.min);
                const max = parseFloat(block.max);
                if (paintWear >= min && paintWear <= max) {
                    return 'wearcategory' + key;
                }
            }
        }
        // fallback 硬编码
        if (paintWear <= 0.07) return 'wearcategory0';
        if (paintWear <= 0.15) return 'wearcategory1';
        if (paintWear <= 0.38) return 'wearcategory2';
        if (paintWear <= 0.45) return 'wearcategory3';
        return 'wearcategory4';
    }

    // ============================================================
    // 名称解析（保留原版核心逻辑）
    // ============================================================

    getItemName(storageRow, customTranslation) {
        const defIndexResult = this.getDefIndex(storageRow.def_index);
        const trans = customTranslation || this.translation;
        const getTrans = (key) => {
            if (!key) return '';
            const formattedKey = key.replace('#', '').toLowerCase();
            const val = trans[formattedKey] || this.translation[formattedKey];
            return val ? val.replaceAll('"', '') : key;
        };

        // 音乐盒检查
        if (storageRow.music_index !== undefined) {
            const musicKit = this.getMusicKits(storageRow.music_index);
            return 'Music Kit | ' + getTrans(musicKit.loc_name);
        }

        // 获取基础名称
        let baseOne = '';
        if (defIndexResult?.item_name) {
            baseOne = getTrans(defIndexResult.item_name);
        } else if (defIndexResult?.prefab) {
            const prefabData = this.getPrefab(defIndexResult.prefab);
            baseOne = getTrans(prefabData.item_name);
        }

        // 获取皮肤名称
        let baseTwo = '';
        if (storageRow.stickers && !baseOne.includes('Coin')) {
            const firstSticker = Object.values(storageRow.stickers)[0];
            if (firstSticker?.slot == 0) {
                const stickerDetails = this.getStickerDetails(firstSticker.sticker_id);
                baseTwo = getTrans(stickerDetails.item_name);
            }
        }
        if (storageRow.paint_index !== undefined) {
            const paintDetails = this.getPaintDetails(storageRow.paint_index);
            baseTwo = getTrans(paintDetails.description_tag);
            baseTwo = { "027": "27", "K.O.工厂": "K.O. 工厂" }[baseTwo] || baseTwo;
        }

        if (this.isStatTrak(storageRow)) {
            baseOne = baseOne + '（StatTrak™）';
        }

        // 组合名称
        let finalName = baseOne;
        if (baseTwo) {
            finalName = baseOne + ' | ' + baseTwo;
        }

        // 纪念品检查
        if (storageRow.attribute) {
            for (const attr of Object.values(storageRow.attribute)) {
                if (attr.def_index == 140 && !finalName.includes('Souvenir')) {
                    finalName = 'Souvenir ' + finalName;
                }
            }
        }

        // 涂鸦检查
        if (storageRow.graffiti_tint !== undefined) {
            const graffitiName = this.getGraffitiKitName(storageRow.graffiti_tint);
            const formattedGraffiti = this.capitalizeWords(graffitiName.replaceAll('_', ' '));
            finalName = finalName + ' (' + formattedGraffiti.replace('Swat', 'SWAT') + ')';
        }

        return finalName || '';
    }

    getItemHashName(storageRow) {
        const defIndexResult = this.getDefIndex(storageRow.def_index);

        // 音乐盒检查
        if (storageRow.music_index !== undefined) {
            const musicKit = this.getMusicKits(storageRow.music_index);
            return 'Music Kit | ' + this.getEnglishTranslation(musicKit.loc_name);
        }

        // 获取基础名称
        let baseOne = '';
        if (defIndexResult?.item_name) {
            baseOne = this.getEnglishTranslation(defIndexResult.item_name);
        } else if (defIndexResult?.prefab) {
            const prefabData = this.getPrefab(defIndexResult.prefab);
            baseOne = this.getEnglishTranslation(prefabData.item_name);
        }

        // 获取皮肤名称
        let baseTwo = '';
        if (storageRow.stickers && !baseOne.includes('Coin')) {
            const firstSticker = Object.values(storageRow.stickers)[0];
            if (firstSticker?.slot == 0) {
                const stickerDetails = this.getStickerDetails(firstSticker.sticker_id);
                baseTwo = this.getEnglishTranslation(stickerDetails.item_name);
            }
        }
        if (storageRow.paint_index !== undefined) {
            const paintDetails = this.getPaintDetails(storageRow.paint_index);
            baseTwo = this.getEnglishTranslation(paintDetails.description_tag);
            baseTwo = { "027": "27" }[baseTwo] || baseTwo;
        }

        // 组合名称
        let finalName = baseOne;
        if (baseTwo) {
            finalName = baseOne + ' | ' + baseTwo;
        }

        // StatTrak 处理 - 英文版本放在前面
        if (this.isStatTrak(storageRow)) {
            finalName = 'StatTrak™ ' + finalName;
        }

        // 纪念品检查
        if (storageRow.attribute) {
            for (const attr of Object.values(storageRow.attribute)) {
                if (attr.def_index == 140 && !finalName.includes('Souvenir')) {
                    finalName = 'Souvenir ' + finalName;
                }
            }
        }

        // 涂鸦检查
        if (storageRow.graffiti_tint !== undefined) {
            const graffitiName = this.getGraffitiKitName(storageRow.graffiti_tint);
            const formattedGraffiti = this.capitalizeWords(graffitiName.replaceAll('_', ' '));
            finalName = finalName + ' (' + formattedGraffiti.replace('Swat', 'SWAT') + ')';
        }

        return finalName || '';
    }

    getCaseName(storageRow) {
        const defIndexResult = this.getDefIndex(storageRow.def_index);
        const paintDetails = this.getPaintDetails(storageRow.paint_index);
        return this.csgoItems.name_to_set_map?.['[' + paintDetails.name + ']' + defIndexResult.name] || null;
    }

    // ============================================================
    // 辅助方法（保留原版）
    // ============================================================

    getDefIndex(defIndex) {
        return this.csgoItems.items?.[defIndex] || {};
    }

    getTranslation(key) {
        if (!key) return '';
        const formattedKey = key.replace('#', '').toLowerCase();
        return this.translation[formattedKey]?.replaceAll('"', '') || key;
    }

    getEnglishTranslation(key) {
        if (!key) return '';
        const formattedKey = key.replace('#', '').toLowerCase();
        return this.englishTranslation[formattedKey]?.replaceAll('"', '') || key;
    }

    getPrefab(prefab) {
        return this.csgoItems.prefabs?.[prefab] || {};
    }

    getPaintDetails(paintIndex) {
        return this.csgoItems.paint_kits?.[paintIndex] || {};
    }

    getMusicKits(musicIndex) {
        return this.csgoItems.music_kits?.[musicIndex] || {};
    }

    getStickerDetails(stickerId) {
        return this.csgoItems.sticker_kits?.[stickerId] || {};
    }

    getGraffitiKitName(graffitiId) {
        for (const [key, value] of Object.entries(this.csgoItems.graffiti_tints || {})) {
            if (value.id == graffitiId) {
                return key;
            }
        }
        return '';
    }

    getPaintWearName(paintWear) {
        const skinWearValues = [0.07, 0.15, 0.38, 0.45, 1];
        const skinWearNames = ['崭新出厂', '略有磨损', '久经沙场', '战痕累累', '破损不堪'];
        for (let i = 0; i < skinWearValues.length; i++) {
            if (paintWear <= skinWearValues[i]) {
                return skinWearNames[i];
            }
        }
        return null;
    }

    getPaintWearNameEnglish(paintWear) {
        const skinWearValues = [0.07, 0.15, 0.38, 0.45, 1];
        const skinWearNames = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];
        for (let i = 0; i < skinWearValues.length; i++) {
            if (paintWear <= skinWearValues[i]) {
                return skinWearNames[i];
            }
        }
        return null;
    }

    isStatTrak(storageRow) {
        if (storageRow.attribute) {
            for (const attr of Object.values(storageRow.attribute)) {
                if (attr.def_index == 80) {
                    return true;
                }
            }
        }
        return false;
    }

    getPendant(storageRow) {
        if (!storageRow.attribute || !Array.isArray(storageRow.attribute)) {
            return null;
        }

        let templateId = null;
        let keychainNameId = null;
        let stickerKitId = null;
        let isStickerPanel = false;
        let highlightIndex = null;

        for (const attr of storageRow.attribute) {
            if (!attr || typeof attr !== 'object' || !attr.def_index) {
                continue;
            }

            let bytes = null;
            if (attr.value_bytes) {
                if (Buffer.isBuffer(attr.value_bytes)) {
                    bytes = Array.from(attr.value_bytes);
                } else if (attr.value_bytes.data && Array.isArray(attr.value_bytes.data)) {
                    bytes = attr.value_bytes.data;
                }
            }

            if (attr.def_index == 306) {
                if (bytes && bytes.length >= 4) {
                    templateId = Buffer.from(bytes).readUInt32LE(0);
                }
            } else if (attr.def_index == 299) {
                if (bytes && bytes.length >= 4) {
                    keychainNameId = Buffer.from(bytes).readUInt32LE(0);
                    if (bytes[0] === 37) {
                        isStickerPanel = true;
                    }
                }
            } else if (attr.def_index == 321) {
                if (bytes && bytes.length >= 4) {
                    stickerKitId = Buffer.from(bytes).readUInt32LE(0);
                }
            } else if (attr.def_index == 314) {
                if (bytes && bytes.length >= 4) {
                    highlightIndex = Buffer.from(bytes).readUInt32LE(0);
                }
            }
        }

        if (templateId === null && keychainNameId === null && highlightIndex === null) {
            return null;
        }

        let keychainName = '';
        if (keychainNameId !== null && this.csgoItems && this.csgoItems.keychain_definitions) {
            const keychainDef = this.csgoItems.keychain_definitions[keychainNameId.toString()];
            if (keychainDef && keychainDef.loc_name) {
                keychainName = this.getTranslation(keychainDef.loc_name);
            }
        }

        if (isStickerPanel && stickerKitId !== null) {
            const stickerDetails = this.getStickerDetails(stickerKitId);
            const stickerNameCN = stickerDetails?.item_name ? this.getTranslation(stickerDetails.item_name) : '';
            if (stickerNameCN) {
                return '印花板 | ' + stickerNameCN;
            }
        }

        if (highlightIndex !== null) {
            const highlightDef = this.csgoItems.highlight_reels?.[highlightIndex.toString()];
            const highlightIdStr = highlightDef?.id || '';
            const reelCN = highlightIdStr ? this.getTranslation('#HighlightReel_' + highlightIdStr) : '';
            const descCN = highlightIdStr ? this.getTranslation('#HighlightDesc_' + highlightIdStr) : '';
            const combined = [reelCN, descCN].filter(Boolean).join(' | ');
            if (combined) {
                const prefix = keychainName || '高光时刻';
                return prefix + ' | ' + combined;
            }
        }

        if (keychainName && templateId !== null) {
            return keychainName + '-' + templateId;
        } else if (keychainName) {
            return keychainName;
        } else if (templateId !== null) {
            return '挂件-' + templateId;
        }
        return '存在挂件';
    }

    isTradeProtect(storageRow) {
        if (storageRow.attribute) {
            for (const attr of Object.values(storageRow.attribute)) {
                if (attr.def_index == 312) {
                    return true;
                }
            }
        }
        return false;
    }

    getEquippedStatus(storageRow) {
        let CT = false;
        let T = false;
        if (storageRow.equipped_state) {
            for (const state of Object.values(storageRow.equipped_state)) {
                if (state?.new_class == 2) T = true;
                if (state?.new_class == 3) CT = true;
            }
        }
        return [CT, T];
    }

    capitalizeWords(string) {
        return string.replace(/(?:^|\s)\S/g, function (a) {
            return a.toUpperCase();
        });
    }
}

module.exports = { ItemProcessor };
