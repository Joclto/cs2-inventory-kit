/**
 * @file itemProcessor.js
 * @description
 * CS2 物品数据富化模块（基于 ByMykel/CSGO-API 预处理 JSON）。
 *
 * 设计变更（相对旧版）：
 *   - 数据源：items_game.json + csgo_{lang}.json 翻译表 → CSGO-API 预处理 JSON
 *     （8 类物品 × 中英双语，共 16 个数组 + 可选 marks 配置）
 *   - 去掉多语言机制（defaultLanguage / extraLanguages / 29 种语言）—— 仅中 + 英
 *   - 去掉翻译表查表逻辑（loadTranslations / getTranslation / getEnglishTranslation 等）
 *   - 去掉 items_game 段落抽取（extractSection / getDefIndex / getPrefab / getPaintDetails 等）
 *   - 去掉内置 mark 映射表（RARITY_NAME_TO_MARK / QUALITY_MAP / WEAR_MARKS）——
 *     marks 完全外置注入（init({marks}) 时由调用方提供，key 用 Valve 标识符）
 *   - 磨损分段硬编码（CS2 固有语义，不查 CSGO-API）
 *   - 双轨字段：*_name（中文显示名）+ *_key（Valve 标识符，用于 marks 映射/查表）
 *     rarity_key / quality_key / exterior_key / itemset_key
 *   - quality 推断基于 attribute（80/81=ST, 140=Souvenir）+ quality int（3=★, 4=normal, 12=纪念品）
 *   - 新增 wear_min / wear_max / paint_wear_norm / stickers / item_storage_total
 *
 * 输出语义精确对齐 cs2_db_manager 的 InventoryParserService（Python 参考实现，
 * src/services/inventory_parser_service.py 的 process_item 方法 L362-609）。
 */

'use strict';

// ============================================================
// 常量（照搬 Python L11-13；磨损分段是 CS2 固有语义，硬编码）
// ============================================================

const WEAR_THRESHOLDS = [0.07, 0.15, 0.38, 0.45, 1.0];
const WEAR_NAMES_CN = ['崭新出厂', '略有磨损', '久经沙场', '破损不堪', '战痕累累'];
const WEAR_NAMES_EN = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];

// null 字节作为复合 key 的分隔符（weapon_id / paint_index 均为数字串，不会冲突）
const KEY_SEP = '\u0000';

/**
 * 将磨损值规范化为 20 位小数字符串（向下截断，不四舍五入）。
 * 对齐 Python Tools.normalize_float_wear 的 Decimal quantize ROUND_DOWN 行为。
 *
 * JS Number 是 IEEE 754 double（64位），String(number) 输出最短可标识字符串。
 * 截断到 20 位小数，不足补零，与 Python Decimal(str(wear)).quantize(20位, ROUND_DOWN) 一致。
 *
 * @param {number|null|undefined} wearVal
 * @returns {string|null} 20 位小数字符串，或 null（输入为空时）
 */
function normalizeFloatWear(wearVal) {
    if (wearVal === null || wearVal === undefined) return null;
    const s = String(wearVal);
    const dotIdx = s.indexOf('.');
    if (dotIdx === -1) {
        // 整数：补 .00000000000000000000
        return s + '.00000000000000000000';
    }
    const intPart = s.substring(0, dotIdx);
    let fracPart = s.substring(dotIdx + 1);
    if (fracPart.length >= 20) {
        // 截断到 20 位（向下截断，不四舍五入）
        fracPart = fracPart.substring(0, 20);
    } else {
        // 不足 20 位补零
        fracPart = fracPart + '0'.repeat(20 - fracPart.length);
    }
    return intPart + '.' + fracPart;
}

class ItemProcessor {
    /**
     * @param {object} data DataLoader.load() 的返回 + opts.marks
     * @param {Array}  data.skinsZhCN        CSGO-API zh-CN skins.json
     * @param {Array}  data.skinsEn          CSGO-API en skins.json
     * @param {Array}  data.musicKitsZhCN
     * @param {Array}  data.musicKitsEn
     * @param {Array}  data.graffitiZhCN
     * @param {Array}  data.graffitiEn
     * @param {Array}  data.keychainsZhCN
     * @param {Array}  data.keychainsEn
     * @param {Array}  data.stickerSlabsZhCN
     * @param {Array}  data.stickerSlabsEn
     * @param {Array}  data.highlightsZhCN
     * @param {Array}  data.highlightsEn
     * @param {Array}  data.stickersZhCN
     * @param {Array}  data.stickersEn
     * @param {Array}  data.collectiblesZhCN
     * @param {Array}  data.collectiblesEn
     * @param {object|null} [data.marks]     可选，外置 mark 映射（key 用 Valve 标识符）
     */
    constructor(data) {
        data = data || {};
        this.marks = data.marks || null;

        // 1. 统一英文索引：id → en_entry（所有 8 种物品类型的英文 JSON 合并）
        //    用于从中文 entry 的 id 查英文 name 作为 hash_name（照搬 Python L121-127）
        this._enById = {};
        const enSources = [
            data.skinsEn, data.musicKitsEn, data.graffitiEn, data.keychainsEn,
            data.stickerSlabsEn, data.highlightsEn, data.stickersEn, data.collectiblesEn
        ];
        for (const source of enSources) {
            if (Array.isArray(source)) {
                for (const item of source) {
                    if (item && item.id) {
                        this._enById[item.id] = item;
                    }
                }
            }
        }

        // 2. 中文皮肤索引：key = (weapon_id, paint_index) → cn_skin_entry
        //    weapon_id 和 paint_index 都转字符串（照搬 Python L130-135）
        this._skinIndex = new Map();
        if (Array.isArray(data.skinsZhCN)) {
            for (const s of data.skinsZhCN) {
                if (!s) continue;
                const w = s.weapon || {};
                const widRaw = w.weapon_id;
                const piRaw = s.paint_index;
                const wid = (widRaw !== undefined && widRaw !== null) ? String(widRaw) : '';
                const pi = (piRaw !== undefined && piRaw !== null) ? String(piRaw) : '';
                if (wid) {
                    this._skinIndex.set(wid + KEY_SEP + pi, s);
                }
            }
        }

        // 3. 其他中文索引（按 def_index 键控，def_index 转字符串）
        //    照搬 Python _build_def_index L156-163
        this._musicIndex = this._buildDefIndex(data.musicKitsZhCN);
        this._keychainIndex = this._buildDefIndex(data.keychainsZhCN);
        this._stickerSlabIndex = this._buildDefIndex(data.stickerSlabsZhCN);
        this._highlightIndex = this._buildDefIndex(data.highlightsZhCN);
        this._stickerIndex = this._buildDefIndex(data.stickersZhCN);
        this._collectibleIndex = this._buildDefIndex(data.collectiblesZhCN);

        // 4. 涂鸦索引：按组合 id（如 "graffiti-1654_3"）键控（照搬 Python L146-148）
        this._graffitiIndex = {};
        if (Array.isArray(data.graffitiZhCN)) {
            for (const g of data.graffitiZhCN) {
                if (g && g.id) {
                    this._graffitiIndex[g.id] = g;
                }
            }
        }
    }

    // ============================================================
    // 索引构建辅助
    // ============================================================

    /**
     * 按 def_index 键控构建索引（def_index 转字符串）。
     * 照搬 Python _build_def_index L156-163。
     */
    _buildDefIndex(items) {
        const idx = {};
        if (!Array.isArray(items)) return idx;
        for (const it of items) {
            if (!it || it.def_index === undefined || it.def_index === null) continue;
            idx[String(it.def_index)] = it;
        }
        return idx;
    }

    /**
     * 从中文 entry 的 id 查英文索引取 name 作为 hash_name。
     * 照搬 Python _get_en_name L165-170。
     */
    _getEnName(cnEntry) {
        if (!cnEntry) return '';
        const enEntry = this._enById[cnEntry.id || ''];
        return (enEntry && enEntry.name) || '';
    }

    // ============================================================
    // value_bytes 解码（支持 Buffer 和 {data:[...]} 两种格式）
    // ============================================================

    /**
     * 统一解码 attribute.value_bytes 为 uint32（小端）。
     * 在 _getPendant / _resolvePendantItem / _extractGraffitiColor /
     * 音乐盒 def_index=1314 解析中复用。
     * @param {object} attr attribute 条目
     * @returns {number|null} 4 字节小端 uint32，不足 4 字节或无 value_bytes 返回 null
     */
    _readUInt32LE(attr) {
        const vb = attr && attr.value_bytes;
        if (!vb) return null;
        let raw;
        if (Buffer.isBuffer(vb)) {
            raw = vb;
        } else if (vb.data && Array.isArray(vb.data)) {
            raw = Buffer.from(vb.data);
        } else {
            return null;
        }
        if (raw.length < 4) return null;
        return raw.readUInt32LE(0);
    }

    // ============================================================
    // 辅助判断（照搬 Python L183-244）
    // ============================================================

    /**
     * 阈值映射 paint_wear → [中文磨损名, 英文磨损名, wear_key]。
     * 基于 Python _get_wear_info L183-189 扩展，增加 wear_key（Valve 标识符）。
     * @returns {Array} [wearNameCn, wearNameEn, wearKey]，paintWear 为空时 [null, null, null]
     */
    _getWearInfo(paintWear) {
        if (paintWear === null || paintWear === undefined) return [null, null, null];
        for (let i = 0; i < WEAR_THRESHOLDS.length; i++) {
            if (paintWear <= WEAR_THRESHOLDS[i]) {
                return [WEAR_NAMES_CN[i], WEAR_NAMES_EN[i], 'wearcategory' + i];
            }
        }
        return [null, null, null];
    }

    /** attribute 含 def_index=312 → 交易保护。照搬 Python _is_trade_protect L191-195。 */
    _isTradeProtect(row) {
        const attrs = row.attribute || [];
        for (const a of attrs) {
            if (a && a.def_index === 312) return true;
        }
        return false;
    }

    /**
     * attribute 含 def_index=80 或 81 → StatTrak（80 和 81 总是一起出现）。
     * 基于 Python _is_stattrak L197-201 扩展，同时检查 81。
     */
    _isStatTrak(row) {
        const attrs = row.attribute || [];
        for (const a of attrs) {
            if (a && (a.def_index === 80 || a.def_index === 81)) return true;
        }
        return false;
    }

    /** attribute 含 def_index=140 → Souvenir。照搬 Python _is_souvenir L203-207。 */
    _isSouvenir(row) {
        const attrs = row.attribute || [];
        for (const a of attrs) {
            if (a && a.def_index === 140) return true;
        }
        return false;
    }

    /**
     * attribute 有 def_index=233 → 解码 value_bytes 得涂鸦颜色代号。
     * 照搬 Python _extract_graffiti_color L209-220。
     */
    _extractGraffitiColor(row) {
        const attrs = row.attribute || [];
        for (const a of attrs) {
            if (a && a.def_index === 233) {
                return this._readUInt32LE(a);
            }
        }
        return null;
    }

    /**
     * 基于 attribute + quality int 综合推断品质名和 Valve 标识符。
     * 替代旧版 _inferQualityName（基于 name 字符串匹配，不够可靠）。
     *
     * 判断优先级：
     *   1. StatTrak（attr 80/81）+ quality==3 → "★ StatTrak™" / "unusual_strange"
     *   2. StatTrak（attr 80/81）            → "StatTrak™"     / "strange"
     *   3. Souvenir（attr 140 或 quality==12）→ "纪念品"        / "tournament"
     *   4. quality==3                         → "★"             / "unusual"
     *   5. quality==4                         → "普通"           / "normal"
     *   6. 其他                               → "普通"           / null
     *
     * @returns {object} { name: string, key: string|null }
     */
    _inferQuality(row) {
        const isST = this._isStatTrak(row);
        const isSouv = this._isSouvenir(row) || row.quality === 12;
        const quality = row.quality;

        if (isST && quality === 3) return { name: '★ StatTrak™', key: 'unusual_strange' };
        if (isST) return { name: 'StatTrak™', key: 'strange' };
        if (isSouv) return { name: '纪念品', key: 'tournament' };
        if (quality === 3) return { name: '★', key: 'unusual' };
        if (quality === 4) return { name: '普通', key: 'normal' };
        return { name: '普通', key: null };
    }

    /**
     * 从 CSGO-API rarity 对象提取 Valve 标识符。
     * rarity.id = "rarity_ancient_weapon" → 去掉 "rarity_" 前缀 → "ancient_weapon"
     * @param {object} rarityObj CSGO-API entry 的 rarity 字段
     * @returns {string|null}
     */
    _extractRarityKey(rarityObj) {
        if (!rarityObj || !rarityObj.id) return null;
        const id = rarityObj.id;
        return id.startsWith('rarity_') ? id.slice(7) : id;
    }

    /**
     * 从 skin entry 的 collections + crates 中提取 itemset Valve 标识符。
     * 找第一个 id 以 "collection-" 开头的，转换：
     *   "collection-set-community-22" → "set_community_22"（去 "collection-" 前缀，"-" 替换为 "_"）
     *
     * 背景：CSGO-API 中 itemset 分为武器箱（crate-xxx）和地图箱（collection-set-xxx），
     * 只有 collection- 开头的 id 能转成 set_xxx 格式。
     *
     * @param {object} skin CSGO-API skin entry
     * @returns {string|null}
     */
    _getItemsetKey(skin) {
        if (!skin) return null;
        const sources = [].concat(skin.collections || [], skin.crates || []);
        for (const s of sources) {
            if (!s || !s.id) continue;
            if (s.id.startsWith('collection-')) {
                return s.id.slice('collection-'.length).replace(/-/g, '_');
            }
        }
        return null;
    }

    // ============================================================
    // 挂件解析（照搬 Python _get_pendant L246-306 / _resolve_pendant_item L308-356）
    // ============================================================

    /**
     * 武器上的挂件解析。照搬 Python _get_pendant L246-306。
     *
     * attribute def_index 含义：
     *   306 → template_id（挂件实例模板 id）
     *   299 → keychain_val（挂件类型/实例 id；37=印花板，36=高光，其他=普通挂件）
     *   321 → sticker_kit_id（印花板对应的 sticker_kit）
     *   314 → highlight_index（高光对应的 highlight reel index）
     *
     * @returns {string|null} 挂件名（如 "印花 | 武术家-1234"）或 null
     */
    _getPendant(row) {
        // 独立挂件/印花板/高光物品(非武器)的 pendant 不重复(name 已是物品名)
        if (row.paint_index === null || row.paint_index === undefined) {
            const attrs0 = row.attribute || [];
            for (const a of attrs0) {
                if (a && (a.def_index === 299 || a.def_index === 314)) return null;
            }
        }

        const attrs = row.attribute || [];
        let templateId = null;
        let keychainVal = null;
        let stickerKitId = null;
        let highlightIndex = null;

        for (const a of attrs) {
            if (!a) continue;
            const di = a.def_index;
            const val = this._readUInt32LE(a);
            if (val === null) continue;
            if (di === 306) {
                templateId = val;
            } else if (di === 299) {
                keychainVal = val;
            } else if (di === 321) {
                stickerKitId = val;
            } else if (di === 314) {
                highlightIndex = val;
            }
        }

        if (templateId === null && keychainVal === null && highlightIndex === null) {
            return null;
        }

        // 按 attr[299] 的值判断类型
        if (keychainVal !== null) {
            if (keychainVal === 37) {
                // 印花板
                if (stickerKitId !== null) {
                    const ss = this._stickerSlabIndex[String(stickerKitId)];
                    if (ss) return ss.name || '';
                }
            } else if (keychainVal === 36) {
                // 高光
                if (highlightIndex !== null) {
                    const hl = this._highlightIndex[String(highlightIndex)];
                    if (hl) return hl.name || '';
                }
            } else {
                // 普通挂件
                const kc = this._keychainIndex[String(keychainVal)];
                if (kc) {
                    const name = kc.name || '';
                    if (templateId !== null) {
                        return name + '-' + templateId;
                    }
                    return name;
                }
            }
        }

        if (templateId !== null) {
            return '挂件-' + templateId;
        }
        return '存在挂件';
    }

    /**
     * 独立挂件/印花板/高光物品解析（def_index=1355 分支用）。
     * 照搬 Python _resolve_pendant_item L308-356。
     * @returns {object|null} entry dict（含 name/rarity）或 null
     */
    _resolvePendantItem(row) {
        const attrs = row.attribute || [];
        let keychainVal = null;
        let stickerKitId = null;
        let highlightIndex = null;

        for (const a of attrs) {
            if (!a) continue;
            const di = a.def_index;
            const val = this._readUInt32LE(a);
            if (val === null) continue;
            if (di === 299) {
                keychainVal = val;
            } else if (di === 321) {
                stickerKitId = val;
            } else if (di === 314) {
                highlightIndex = val;
            }
        }

        if (keychainVal === null) return null;

        if (keychainVal === 37) {
            // 印花板
            if (stickerKitId !== null) {
                const ss = this._stickerSlabIndex[String(stickerKitId)];
                if (ss) return ss;
                return { name: 'sticker_slab-' + stickerKitId + ' 未找到', market_hash_name: '', rarity: {} };
            }
        } else if (keychainVal === 36) {
            // 高光
            if (highlightIndex !== null) {
                const hl = this._highlightIndex[String(highlightIndex)];
                if (hl) return hl;
                return { name: 'highlight-' + highlightIndex + ' 未找到', market_hash_name: '', rarity: {} };
            }
        } else {
            // 普通挂件
            const kc = this._keychainIndex[String(keychainVal)];
            if (kc) return kc;
            return { name: 'keychain-' + keychainVal + ' 未找到', market_hash_name: '', rarity: {} };
        }
        return null;
    }

    // ============================================================
    // 主处理（照搬 Python process_item L362-609）
    // ============================================================

    /**
     * 解析单个 storageRow（GC 协议层原始物品）为富化结果对象。
     *
     * 物品类型分支（按优先级）：
     *   1. def_index == 1201            → 储物柜
     *   2. musicindex != null           → 音乐盒 B
     *   3. attribute 含 def_index=233   → 涂鸦（组合 id 查 _graffitiIndex）
     *   4. def_index == 1209            → 独立贴纸
     *   5. def_index == 1314            → 音乐盒物品（attr[166] 提取 music def_index）
     *   6. def_index == 1355            → 独立挂件/印花板/高光
     *   7. else                         → 普通武器皮肤（fallback: collectibles）
     *
     * @param {object} storageRow GC 原始物品
     * @returns {object} 富化结果（字段名和语义对齐 Python ParsedItem）
     */
    processItem(storageRow) {
        storageRow = storageRow || {};

        // 1. 清除可能混入的旧输出字段（保留 GC 原始字段）
        //    照搬 Python L364-370（防止 storageRow 被重复富化时残留旧字段）
        const staleKeys = [
            'name', 'hash_name', 'market_name', 'item_set',
            'itemset_mark', 'itemset_name', 'itemset_key', 'pendant',
            'exterior_name', 'exterior_mark', 'exterior_key',
            'exterior_mark_norm', 'exterior_key_norm',
            'rarity_name', 'rarity_mark', 'rarity_key',
            'quality_name', 'quality_mark', 'quality_key',
            'wear_category', 'rarity_name_local',
            'quality_name_local', 'recipe', 'mark', 'mark_norm', 'hash_wear_seed_key', 'msg'
        ];
        for (const k of staleKeys) {
            delete storageRow[k];
        }

        // 2. 初始化结果对象（pass-through + 解析字段的默认值）
        const casketCount = storageRow.casket_contained_item_count;
        const result = {
            // pass-through
            appid: 730,
            assetid: storageRow.id ?? null,
            paint_wear: storageRow.paint_wear ?? null,
            paint_index: storageRow.paint_index ?? null,
            paint_seed: storageRow.paint_seed ?? null,
            def_index: storageRow.def_index ?? null,
            quality: storageRow.quality ?? null,
            rarity: storageRow.rarity ?? null,
            item_origin: storageRow.origin ?? null, // 注意：输入 origin → 输出 item_origin
            position: storageRow.position ?? null,
            account_id: storageRow.account_id ?? null,
            custom_name: storageRow.custom_name ?? null,
            custom_desc: storageRow.custom_desc ?? null,
            casket_id: storageRow.casket_id ?? null,
            casket_contained_item_count: casketCount ?? null,
            tradable_after: storageRow.tradable_after ?? null,
            item_storage_total: casketCount ?? null, // 新增，别名
            // 解析字段（默认值统一为 null）
            trade_protect: false,
            name: null,
            hash_name: null,
            market_name: null,
            exterior_name: null,
            exterior_key: null,
            exterior_mark_norm: null,
            exterior_key_norm: null,
            rarity_name: null,
            rarity_key: null,
            quality_name: null,
            quality_key: null,
            itemset_name: null,
            itemset_key: null,
            pendant: null,
            recipe: null,
            stickers: [],
            wear_min: null,
            wear_max: null,
            paint_wear_norm: null,
            hash_wear_seed_key: null,
            msg: null
        };

        try {
            // 3. trade_protect（始终计算，照搬 Python L378）
            result.trade_protect = this._isTradeProtect(storageRow);

            const defIndex = storageRow.def_index;
            const paintIndex = storageRow.paint_index;
            const quality = storageRow.quality;
            const rarity = storageRow.rarity;
            const paintWear = storageRow.paint_wear;

            // ===== 4. 物品类型分支 =====

            const musicindex = storageRow.musicindex;
            // 涂鸦颜色仅在没有 musicindex 时提取（照搬 Python L406）
            const graffitiColor = (musicindex === undefined || musicindex === null)
                ? this._extractGraffitiColor(storageRow)
                : null;

            if (defIndex === 1201) {
                // 储物柜
                result.name = '库存存储组件';
                result.hash_name = 'Storage Unit';

            } else if (musicindex !== undefined && musicindex !== null) {
                // B. 音乐盒
                const mk = this._musicIndex[String(musicindex)];
                if (mk) {
                    result.name = mk.name || '';
                    result.hash_name = this._getEnName(mk);
                    const rar = mk.rarity || {};
                    result.rarity_name = rar.name || '';
                    result.rarity_key = this._extractRarityKey(rar);
                }

            } else if (graffitiColor !== null && graffitiColor !== undefined) {
                // C. 涂鸦
                const stickersList = storageRow.stickers || [];
                if (stickersList.length > 0) {
                    const stickerId = stickersList[0].sticker_id;
                    if (stickerId !== undefined && stickerId !== null) {
                        const gid = 'graffiti-' + stickerId + '_' + graffitiColor;
                        const g = this._graffitiIndex[gid];
                        if (g) {
                            result.name = g.name || '';
                            result.hash_name = this._getEnName(g);
                            const rar = g.rarity || {};
                            result.rarity_name = rar.name || '';
                            result.rarity_key = this._extractRarityKey(rar);
                        }
                    }
                }

            } else if (defIndex === 1209) {
                // 单个印花物品
                const stickersList = storageRow.stickers || [];
                if (stickersList.length > 0) {
                    const first = stickersList[0];
                    if (first && first.sticker_id !== undefined && first.sticker_id !== null) {
                        const entry = this._stickerIndex[String(first.sticker_id)];
                        if (entry) {
                            result.name = entry.name || '';
                            result.hash_name = this._getEnName(entry);
                            const rar = entry.rarity || {};
                            result.rarity_name = rar.name || '';
                            result.rarity_key = this._extractRarityKey(rar);
                        }
                    }
                }

            } else if (defIndex === 1314) {
                // 音乐盒物品(attr[166] = music def_index)
                let musicDi = null;
                const attrs = storageRow.attribute || [];
                for (const a of attrs) {
                    if (a && a.def_index === 166) {
                        musicDi = this._readUInt32LE(a);
                        break;
                    }
                }
                if (musicDi !== null) {
                    const mk = this._musicIndex[String(musicDi)];
                    if (mk) {
                        result.name = '音乐盒 | ' + (mk.name || '');
                        result.hash_name = 'Music Kit | ' + this._getEnName(mk);
                        const rar = mk.rarity || {};
                        result.rarity_name = rar.name || '';
                        result.rarity_key = this._extractRarityKey(rar);
                    }
                }

            } else if (defIndex === 1355) {
                // 单独挂件物品(keychain/印花板/高光)
                const pendantEntry = this._resolvePendantItem(storageRow);
                if (pendantEntry) {
                    result.name = pendantEntry.name || '';
                    result.hash_name = this._getEnName(pendantEntry);
                    const rar = pendantEntry.rarity || {};
                    result.rarity_name = rar.name || '';
                    result.rarity_key = this._extractRarityKey(rar);
                }

            } else {
                // A. 普通武器皮肤
                const piStr = (paintIndex !== undefined && paintIndex !== null) ? String(paintIndex) : '';
                const diStr = (defIndex !== undefined && defIndex !== null) ? String(defIndex) : '';
                const cnSkin = this._skinIndex.get(diStr + KEY_SEP + piStr);

                if (cnSkin) {
                    let cnName = cnSkin.name || '';
                    let enName = this._getEnName(cnSkin);

                    // StatTrak(attribute 80)——照搬 Python L494-508
                    if (this._isStatTrak(storageRow)) {
                        // 中文:含（★）→（★ StatTrak™）;否则武器名后插入（StatTrak™）
                        if (cnName.indexOf('（★）') !== -1) {
                            cnName = cnName.replace('（★）', '（★ StatTrak™）');
                        } else if (cnName.indexOf(' | ') !== -1) {
                            // 仅在第一个 " | " 处切分（等价 Python split(" | ", 1)）
                            const sepIdx = cnName.indexOf(' | ');
                            cnName = cnName.substring(0, sepIdx) + '（StatTrak™） | ' + cnName.substring(sepIdx + 3);
                        } else {
                            cnName = cnName + '（StatTrak™）';
                        }
                        // 英文:★ 开头→★ StatTrak™;否则前缀 StatTrak™
                        if (enName.startsWith('★ ')) {
                            enName = '★ StatTrak™ ' + enName.slice(2);
                        } else {
                            enName = 'StatTrak™ ' + enName;
                        }
                    }

                    // Souvenir(attribute 140)——照搬 Python L510-521
                    if (this._isSouvenir(storageRow)) {
                        // 中文:武器名后追加（纪念品）
                        if (cnName.indexOf('纪念品') === -1) {
                            if (cnName.indexOf(' | ') !== -1) {
                                const sepIdx = cnName.indexOf(' | ');
                                cnName = cnName.substring(0, sepIdx) + '（纪念品） | ' + cnName.substring(sepIdx + 3);
                            } else {
                                cnName = cnName + '（纪念品）';
                            }
                        }
                        // 英文:Souvenir 前缀
                        if (enName.indexOf('Souvenir') === -1) {
                            enName = 'Souvenir ' + enName;
                        }
                    }

                    result.name = cnName;
                    result.hash_name = enName;

                    // rarity(从 skin 条目)
                    const skinRar = cnSkin.rarity || {};
                    result.rarity_name = skinRar.name || '';
                    result.rarity_key = this._extractRarityKey(skinRar);

                    // wear_min/wear_max/norm（仅 paint_wear 存在时，照搬 Python L531-538）
                    if (paintWear !== undefined && paintWear !== null) {
                        result.wear_min = (cnSkin.min_float !== undefined && cnSkin.min_float !== null)
                            ? cnSkin.min_float : null;
                        result.wear_max = (cnSkin.max_float !== undefined && cnSkin.max_float !== null)
                            ? cnSkin.max_float : null;
                        const wMin = result.wear_min;
                        const wMax = result.wear_max;
                        if (wMin !== null && wMax !== null && wMax !== wMin) {
                            result.paint_wear_norm = (paintWear - wMin) / (wMax - wMin);
                        }
                    }

                    // itemset_name(crates 优先,空则 fallback collections)——照搬 Python L540-547
                    const crates = cnSkin.crates || [];
                    if (crates.length > 0) {
                        result.itemset_name = crates[0].name || '';
                    } else {
                        const colls = cnSkin.collections || [];
                        if (colls.length > 0) {
                            result.itemset_name = colls[0].name || '';
                        }
                    }
                    // itemset_key(始终从 collection- 开头的 id 提取，不管 name 来源)
                    result.itemset_key = this._getItemsetKey(cnSkin);

                    // 印花(仅武器皮肤)——照搬 Python L552-566
                    const rawStickers = storageRow.stickers || [];
                    const outStickers = [];
                    for (const st of rawStickers) {
                        if (!st) continue;
                        const sid = st.sticker_id;
                        if (sid === undefined || sid === null) continue;
                        const entry = this._stickerIndex[String(sid)];
                        outStickers.push({
                            slot: st.slot,
                            sticker_id: sid,
                            name: (entry || {}).name || '',
                            hash_name: entry ? this._getEnName(entry) : '',
                            wear: st.wear
                        });
                    }
                    result.stickers = outStickers;

                } else {
                    // fallback: 按 def_index 查 collectibles——照搬 Python L567-577
                    if (defIndex !== undefined && defIndex !== null) {
                        const pendantEntry = this._collectibleIndex[String(defIndex)];
                        if (pendantEntry) {
                            result.name = pendantEntry.name || '';
                            result.hash_name = this._getEnName(pendantEntry);
                            const rar = pendantEntry.rarity || {};
                            result.rarity_name = rar.name || '';
                            result.rarity_key = this._extractRarityKey(rar);
                        }
                    }
                }
            }

            // ===== 5. 磨损后缀（照搬 Python L579-588）=====
            const wearInfo = this._getWearInfo(paintWear);
            const extCn = wearInfo[0];
            const extEn = wearInfo[1];
            const extKey = wearInfo[2];

            result.exterior_name = extCn || null;
            result.exterior_key = extKey;

            // 基于归一化磨损的 exterior_key_norm（用于 mark_norm）
            if (result.paint_wear_norm !== null) {
                const normInfo = this._getWearInfo(result.paint_wear_norm);
                result.exterior_key_norm = normInfo[2];
            }

            // hash_name 追加 " (英文磨损名)"
            if (paintWear !== undefined && paintWear !== null && extEn && result.hash_name) {
                result.hash_name = result.hash_name + ' (' + extEn + ')';
            }

            // market_name = name + " (中文磨损名)"
            if (result.name) {
                result.market_name = result.name + (extCn ? ' (' + extCn + ')' : null);
            }

            // hash_wear_seed_key：组合匹配键（hash_name|paint_wear_20位|paint_seed）
            // 此时 hash_name 已含磨损后缀（如 "AK-47 | Redline (Field-Tested)"）
            {
                const wearStr = normalizeFloatWear(result.paint_wear);
                const hn = result.hash_name;
                const ps = result.paint_seed;
                if (hn && wearStr !== null && ps !== null) {
                    result.hash_wear_seed_key = hn + '|' + wearStr + '|' + ps;
                } else {
                    const assetid = result.assetid;
                    result.hash_wear_seed_key = (assetid !== null && assetid !== undefined) ? String(assetid) : '';
                }
            }

            // ===== 6. quality_name + quality_key（基于 attribute + quality int 综合推断）=====
            const qInfo = this._inferQuality(storageRow);
            result.quality_name = qInfo.name;
            result.quality_key = qInfo.key;

            // ===== 7. recipe——照搬 Python L596-599（ST 判断用 quality==9）=====
            if (rarity) {
                let recipe = rarity - 1;
                // quality==9 等价 Python 的 quality_mark=="ST"（QUALITY_MAP[9]=="ST"）
                if (quality === 9) {
                    recipe += 10;
                }
                result.recipe = recipe;
            }

            // ===== 8. marks（仅 data.marks 存在时输出；key 用 Valve 标识符 *_key）=====
            if (this.marks) {
                let rarityMark = null;
                let qualityMark = null;
                let exteriorMark = null;
                let itemsetMark = null;

                if (this.marks.rarity && result.rarity_key) {
                    const v = this.marks.rarity[result.rarity_key];
                    rarityMark = (v !== undefined && v !== null) ? v : null;
                }
                if (this.marks.quality && result.quality_key) {
                    const v = this.marks.quality[result.quality_key];
                    qualityMark = (v !== undefined && v !== null) ? v : null;
                }
                if (this.marks.exterior && result.exterior_key) {
                    const v = this.marks.exterior[result.exterior_key];
                    exteriorMark = (v !== undefined && v !== null) ? v : null;
                }
                if (this.marks.itemset && result.itemset_key) {
                    const v = this.marks.itemset[result.itemset_key];
                    itemsetMark = (v !== undefined && v !== null) ? v : null;
                }

                result.rarity_mark = rarityMark;
                result.quality_mark = qualityMark;
                result.exterior_mark = exteriorMark;
                result.itemset_mark = itemsetMark;

                // 组合 mark（4 个都有效才拼接）
                const parts = [qualityMark, rarityMark, exteriorMark, itemsetMark];
                const allValid = parts.every(function (m) {
                    return m !== null && m !== undefined && m !== '';
                });
                result.mark = allValid ? parts.join('_') : null;

                // 基于 paint_wear_norm 的 exterior_mark_norm + mark_norm
                if (result.exterior_key_norm !== null) {
                    let exteriorMarkNorm = null;
                    if (this.marks.exterior && result.exterior_key_norm) {
                        const v = this.marks.exterior[result.exterior_key_norm];
                        exteriorMarkNorm = (v !== undefined && v !== null) ? v : null;
                    }
                    result.exterior_mark_norm = exteriorMarkNorm;

                    const normParts = [qualityMark, rarityMark, exteriorMarkNorm, itemsetMark];
                    const normAllValid = normParts.every(function (m) {
                        return m !== null && m !== undefined && m !== '';
                    });
                    result.mark_norm = normAllValid ? normParts.join('_') : null;
                }
            }

            // ===== 9. pendant（照搬 Python L607，对所有物品类型调用）=====
            result.pendant = this._getPendant(storageRow);

        } catch (error) {
            result.msg = (error && error.message) ? error.message : String(error);
        }

        return result;
    }
}

module.exports = { ItemProcessor };
