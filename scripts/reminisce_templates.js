/**
 * reminisce_templates.js - 回味記憶模板引擎
 * 
 * 核心功能：根據記憶年齡、情感標籤、ERS分數，選擇最適合的懷舊語氣
 * 
 * Template 分類：
 * - warm_encourage: 溫馨鼓勵（首發實作）
 * - recent_intimacy: 近期親暱（<7天）
 * - reflective: 反思回顧（7-365天）
 * - nostalgic_treasure: 朦朧珍惜（>365天，含模糊化）
 * - flirty_playful: 綠茶味（待實作）
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Template Engine
// ============================================================

class ReminisceTemplateEngine {
    constructor(config = {}) {
        // 親密等級：1-5，影響模板選擇
        this.intimacyLevel = config.intimacyLevel || 3;
        
        // 冷卻機制：避免短時間內重複回味同一記憶
        this.lastReminisce = null;
        this.cooldownMs = config.cooldownMs || 30 * 60 * 1000; // 30分鐘
        
        // Fuzziness 閾值：>=2年的記憶啟用模糊化
        this.fuzzinessThresholdDays = 365 * 2; // 2年（>=730天）
    }

    /**
     * 主入口：生成回味語句
     * @param {Object} memory - 記憶物件
     * @param {Object} context - 上下文（Bryan's情緒、當前時間等）
     * @returns {Object} { text, template, confidence }
     */
    generate(memory, context = {}) {
        const memoryAge = this.calculateMemoryAge(memory.created_at);
        const emotionalTags = memory.emotional_tags || [];
        const ers = memory.emotional_resonance_score || 0.5;
        
        // 選擇模板類型
        const templateType = this.selectTemplateType(memoryAge, emotionalTags, ers, context);
        
        // 填充模板
        const text = this.fillTemplate(templateType, memory, {
            memoryAge,
            emotionalTags,
            ers,
            ...context
        });
        
        return {
            text,
            template: templateType,
            memoryAge,
            ers,
            fuzzy: memoryAge >= this.fuzzinessThresholdDays
        };
    }

    /**
     * 根據記憶屬性選擇模板類型
     */
    selectTemplateType(memoryAge, emotionalTags, ers, context) {
        const bryansMood = context.bryansMood || 'neutral';
        
        // 1. 如果 Bryan 情緒低落 → 溫馨鼓勵優先
        if (bryansMood === 'down' || bryansMood === 'tired') {
            return 'warm_encourage';
        }
        
        // 2. 近期記憶（<7天）→ 親暱回應
        if (memoryAge < 7) {
            return 'recent_intimacy';
        }
        
        // 3. 高 ERS（>0.8）正面情緒 → 溫馨鼓勵
        if (ers > 0.8 && emotionalTags.includes('success')) {
            return 'warm_encourage';
        }
        
        // 4. 一年以上的記憶 → 朦朧珍惜
        if (memoryAge > 365) {
            return 'nostalgic_treasure';
        }
        
        // 5. 預設：反思回顧
        return 'reflective';
    }

    /**
     * 填充模板
     */
    fillTemplate(templateType, memory, params) {
        const templates = this.getTemplates();
        const templateSet = templates[templateType];
        
        if (!templateSet || !templateSet.length) {
            return `記得那時候...`;
        }
        
        // 選擇親密等級對應的模板陣列
        const variantIndex = Math.min(this.intimacyLevel - 1, templateSet.length - 1);
        const templateArray = templateSet[variantIndex] || templateSet[0];
        
        // 從該等級中隨機選擇一個模板
        const template = templateArray[Math.floor(Math.random() * templateArray.length)];
        
        // 替換變量
        let text = template
            .replace('{content}', this.extractCore(memory.content, params))
            .replace('{specific}', this.extractSpecific(memory.content, params))
            .replace('{feeling}', this.extractFeeling(memory.emotional_tags));
        
        // 如果是模糊化模式，進一步處理
        if (params.fuzzy) {
            text = this.applyFuzziness(text, memory);
        }
        
        // 如果模板中有 {content}，進行提取和替換
        if (text.includes('{content}')) {
            text = text.replace('{content}', this.extractCore(memory.content, params));
        }
        
        return text;
    }

    /**
     * 提取核心內容（去除精確數據）
     */
    extractCore(content, params) {
        if (params.fuzzy) {
            // 模糊化：去除精確數字、日期
            return content
                .replace(/\d{4}[-/]\d{2}[-/]\d{2}/g, '那段時間')
                .replace(/\$[\d,]+/g, '一筆金額')
                .replace(/\d+%/g, '一些')
                .replace(/\d+(?:USD| NT |TWD|USD)/gi, '');
        }
        return content;
    }

    /**
     * 提取具體細節（用於非模糊模式）
     */
    extractSpecific(content, params) {
        // 盡量保留具體細節
        return content;
    }

    /**
     * 提取情感描述
     */
    extractFeeling(emotionalTags) {
        const tagDescriptions = {
            success: '真的很不容易',
            achievement: '成果很好',
            tired: '辛苦了',
            stressed: '承受很大壓力',
            happy: '很開心',
            grateful: '很感謝'
        };
        
        return emotionalTags
            .filter(tag => tagDescriptions[tag])
            .map(tag => tagDescriptions[tag])
            .join('、') || '很特別';
    }

    /**
     * 應用模糊化處理
     */
    applyFuzziness(text, memory) {
        // 加入朦朧感的修辭
        const fuzzyPrefixes = [
            '隱約記得',
            '想起來好像是',
            '印象中那時候'
        ];
        
        const prefix = fuzzyPrefixes[Math.floor(Math.random() * fuzzyPrefixes.length)];
        return `${prefix}，${text}`;
    }

    /**
     * 計算記憶年齡（天）
     */
    calculateMemoryAge(createdAt) {
        const created = new Date(createdAt);
        const now = new Date();
        return Math.floor((now - created) / (1000 * 60 * 60 * 24));
    }

    /**
     * 模板庫
     */
    getTemplates() {
        return {
            // ========================================
            // 溫馨鼓勵（首發實作）
            // ========================================
            warm_encourage: [
                // 等級1-2：基本鼓勵
                [
                    `說起來，之前你提到過「{content}」，{feeling}。`,
                    `那段時間的情況，{feeling}，成果真的很好。`,
                    `記得你當時花了不少心思在「{content}」上，{feeling}。`
                ],
                // 等級3：更親暱
                [
                    `想起來，之前你成功「{content}」的時候，我真的覺得你很厲害。`,
                    `你認真處理「{content}」的那段時間，{feeling}，成果說明了一切。`,
                    `說真的，你處理「{content}」的方式讓人印象深刻，{feeling}。`
                ],
                // 等級4-5：更深層次的鼓勵
                [
                    `親愛的，還記得你之前「{content}」的時候嗎？{feeling}，但你還是撐過來了，你真的很堅強。`,
                    `我最記得你那段時間處理「{content}」的樣子，{feeling}，但你做到了。這就是為什麼我相信你。`
                ]
            ],

            // ========================================
            // 近期親暱（<7天）
            // ========================================
            recent_intimacy: [
                // 等級1-2
                [
                    `前幾天我們聊到的「{content}」，你還記得嗎？`,
                    `說起來，前幾天才討論過這個...`,
                    `最近在談的事情，你還記得「{content}」這個部分吧？`
                ],
                // 等級3
                [
                    `親愛的，前幾天你說的「{content}」，我一直記得。`,
                    `你前幾天提到「{content}」的時候，我特別有印象。`
                ],
                // 等級4-5
                [
                    `哎，你前幾天才說過「{content}」的呀～我怎麼會忘記呢。`,
                    `你這個人啊，前幾天才講的事情就忘了？不過沒關係，我幫你記得。`
                ]
            ],

            // ========================================
            // 反思回顧（7-365天）
            // ========================================
            reflective: [
                // 等級1-2
                [
                    `記得那段時間，我們討論過「{content}」。`,
                    `回想起來，那時候我們針對「{content}」做了不少功課。`,
                    `說起來，那時候的「{content}」... 現在想想還滿有意思的。`
                ],
                // 等級3
                [
                    `還記得我們之前聊過「{content}」嗎？`,
                    `那段時間你對「{content}」的想法，{feeling}。`,
                    `想起來的話，那時候你對「{content}」的態度讓我印象滿深的。`
                ],
                // 等級4-5
                [
                    `親愛的，還記得那段時間你特別認真在研究「{content}」嗎？`,
                    `你之前對「{content}」那麼用心，{feeling}，現在回顧起來真的很值得。`
                ]
            ],

            // ========================================
            // 朦朧珍惜（>365天，含模糊化）
            // ========================================
            nostalgic_treasure: [
                // 等級1-2
                [
                    `說起來，那是滿久以前的事了...`,
                    `一段時間前的某次討論，我印象滿深的。`,
                    `還記得那時候的情況嗎？細節有點模糊了，但感覺還在。`
                ],
                // 等級3
                [
                    `親愛的，一年多前的某些時刻... 我偶爾會想起來。`,
                    `那時候的「{content}」... 想起來有種溫暖的感覺。`
                ],
                // 等級4-5
                [
                    `你知道嗎，有時候想起那時候的點點滴滴，我都會不自覺的微笑。`,
                    `那些日子... 雖然細節有點模糊了，但當時的感覺還是很清晰。`
                ]
            ],

            // ========================================
            // 綠茶味（待實作）
            // ========================================
            flirty_playful: [
                // 等級1-2
                [
                    `哎，你之前不是說過... 然後現在又這樣了。`,
                    `你這個人啊，讓我想起之前...`
                ],
                // 等級3
                [
                    `說起來，你這個人真的很有趣... 跟之前一模一樣。`,
                    `哎呦，你之前就是這樣的啊～`
                ],
                // 等級4-5
                [
                    `你喔～每次都這樣，明明之前還信誓旦旦說會記得...`,
                    `我看透你了啦～跟之前比較的話，這次...`
                ]
            ]
        };
    }
}

// ============================================================
// CLI Interface
// ============================================================

function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--test')) {
        // 測試模式：運行內建測試
        runTests();
    } else if (args.includes('--help')) {
        printHelp();
    } else {
        // 互動模式：讀取記憶並生成回味
        const memoryPath = args[0];
        if (!memoryPath) {
            console.error('請提供記憶檔案路徑');
            printHelp();
            process.exit(1);
        }
        runInteractive(memoryPath);
    }
}

function runTests() {
    console.log('🧪 運行 Reminisce Template Engine 測試...\n');
    
    const engine = new ReminisceTemplateEngine({ intimacyLevel: 3 });
    
    const testCases = [
        {
            name: '溫馨鼓勵 - 成功記憶 + Bryan情緒低落',
            memory: {
                content: 'Bryan成功談下了那筆重要的訂單',
                created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30天前
                emotional_tags: ['success', 'achievement'],
                emotional_resonance_score: 0.92
            },
            context: { bryansMood: 'down' }
        },
        {
            name: '朦朧珍惜 - 兩年前的記憶',
            memory: {
                content: '2024年3月15日，Bryan在會議上做了一個重要報告',
                created_at: new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString(), // 2年前
                emotional_tags: ['achievement'],
                emotional_resonance_score: 0.85
            },
            context: {}
        },
        {
            name: '近期親暱 - 一週內的記憶',
            memory: {
                content: 'Bryan提到他這週特別忙',
                created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3天前
                emotional_tags: ['tired'],
                emotional_resonance_score: 0.6
            },
            context: {}
        }
    ];
    
    testCases.forEach(tc => {
        console.log(`測試：${tc.name}`);
        console.log(`記憶內容：${tc.memory.content}`);
        console.log(`記憶年齡：${engine.calculateMemoryAge(tc.memory.created_at)} 天`);
        console.log(`ERS：${tc.memory.emotional_resonance_score}`);
        const result = engine.generate(tc.memory, tc.context);
        console.log(`模板：${result.template}`);
        console.log(`模糊化：${result.fuzzy}`);
        console.log(`輸出：${result.text}`);
        console.log('---');
    });
    
    console.log('\n✅ 測試完成');
}

function printHelp() {
    console.log(`
reminisce_templates.js - 回味記憶模板引擎

用法：
    node reminisce_templates.js <memory_file>    互動模式
    node reminisce_templates.js --test          運行測試
    node reminisce_templates.js --help           顯示說明

環境變量：
    INTIMACY_LEVEL=1-5    設定親密等級（預設：3）
    COOLDOWN_MS=1800000   設定冷卻時間（預設：30分鐘）
`);
}

function runInteractive(memoryPath) {
    try {
        const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
        const intimacyLevel = parseInt(process.env.INTIMACY_LEVEL || '3');
        
        const engine = new ReminisceTemplateEngine({ intimacyLevel });
        const result = engine.generate(memory, {});
        
        console.log(result.text);
    } catch (err) {
        console.error(`錯誤：${err.message}`);
        process.exit(1);
    }
}

module.exports = { ReminisceTemplateEngine };

if (require.main === module) {
    main();
}
