/**
 * reminisce_engine.js - 回味引擎（統一 API）
 * 
 * 整合全部四個模組的統一引擎：
 * - reminisce_templates.js    懷舊語氣模板
 * - emotional_matcher.js     情緒匹配
 * - anniversary_tracker.js   時間膠囊
 * - reminisce_scheduler.js   隨機觸發
 * 
 * 統一 API 讓 Yua 只需要一個 call 就能觸發回味
 */

const fs = require('fs');
const path = require('path');

// 假設這些模組在同一目錄
const { ReminisceTemplateEngine } = require('./reminisce_templates');
const { EmotionalMatcher } = require('./emotional_matcher');
const { AnniversaryTracker } = require('./anniversary_tracker');
const { ReminisceScheduler } = require('./reminisce_scheduler');

// ============================================================
// Reminisce Engine
// ============================================================

class ReminisceEngine {
    constructor(config = {}) {
        // 初始化所有子模組
        this.templateEngine = new ReminisceTemplateEngine({
            intimacyLevel: config.intimacyLevel || 3
        });

        this.emotionalMatcher = new EmotionalMatcher({
            cooldownMs: config.emotionalCooldownMs || 2 * 60 * 60 * 1000
        });

        this.anniversaryTracker = new AnniversaryTracker();

        this.scheduler = new ReminisceScheduler({
            intimacyLevel: config.intimacyLevel || 3
        });

        // 預設路徑
        this.lcmPath = config.lcmPath || 'C:/Users/bbfcc/.openclaw/lcm.db';
        this.qmdPath = config.qmdPath || 'C:/Users/bbfcc/.openclaw/workspace/qmd';
        this.stateSnapshotPath = config.stateSnapshotPath || 'C:/Users/bbfcc/.openclaw/workspace/qmd/identity/state_snapshot.md';

        // 當前狀態
        this.currentMood = 'neutral';
        this.currentTopic = null;
        this.intimacyLevel = config.intimacyLevel || 3;

        // 觸發歷史（用於日誌）
        this.triggerHistory = [];
    }

    /**
     * 統一是話入口
     * 
     * @param {Object} context - 上下文
     * @param {string} context.bryansMood - Bryan 當前情緒
     * @param {string} context.currentTopic - Bryan 當前話題
     * @param {boolean} context.isReminiscing - 是否正在回味（被動）
     * @param {Object} context.retrievedMemory - 檢索到的記憶（被動回味時）
     * @returns {Object} { triggered, type, text, memory, config }
     */
    process(context = {}) {
        // 更新上下文
        this.currentMood = context.bryansMood || this.currentMood;
        this.currentTopic = context.currentTopic || this.currentTopic;

        // 載入 State Snapshot 更新親密等級
        this.loadStateSnapshot();

        const result = {
            triggered: false,
            type: null,
            text: null,
            memory: null,
            template: null,
            config: {
                intimacyLevel: this.intimacyLevel,
                mood: this.currentMood,
                topic: this.currentTopic
            }
        };

        // ========================================
        // 被動觸發：記憶檢索時附加回味
        // ========================================
        if (context.isReminiscing && context.retrievedMemory) {
            const passive = this.processPassiveReminisce(context.retrievedMemory);
            if (passive.triggered) {
                return { ...result, ...passive };
            }
        }

        // ========================================
        // 主動觸發：檢查是否應該主動回味
        // ========================================
        const activeTrigger = this.checkActiveTrigger(context);

        if (!activeTrigger.shouldTrigger) {
            return result; // 沒有觸發
        }

        // ========================================
        // 選擇觸發類型
        // ========================================
        const triggerType = this.selectTriggerType(context);

        if (triggerType === 'emotional') {
            const emotional = this.triggerEmotionalReminisce();
            if (emotional.triggered) {
                this.recordTrigger('emotional', emotional);
                return { ...result, ...emotional };
            }
        } else if (triggerType === 'anniversary') {
            const anniversary = this.triggerAnniversaryReminisce();
            if (anniversary.triggered) {
                this.recordTrigger('anniversary', anniversary);
                return { ...result, ...anniversary };
            }
        } else if (triggerType === 'random') {
            const random = this.triggerRandomReminisce();
            if (random.triggered) {
                this.recordTrigger('random', random);
                return { ...result, ...random };
            }
        }

        return result;
    }

    /**
     * 被動回味處理（記憶檢索時）
     */
    processPassiveReminisce(memory) {
        const memoryAge = this.templateEngine.calculateMemoryAge(memory.created_at);
        const emotionalTags = memory.emotional_tags || [];
        const ers = memory.emotional_resonance_score || 0.5;

        // 使用模板引擎生成回味文字
        const templateResult = this.templateEngine.generate(memory, {
            bryansMood: this.currentMood,
            memoryAge,
            emotionalTags,
            ers
        });

        return {
            triggered: true,
            type: 'passive',
            text: templateResult.text,
            memory: memory,
            template: templateResult.template,
            memoryAge: templateResult.memoryAge,
            fuzzy: templateResult.fuzzy
        };
    }

    /**
     * 檢查是否應該主動觸發
     */
    checkActiveTrigger(context) {
        // 更新 scheduler 的親密等級
        this.scheduler.intimacyLevel = this.intimacyLevel;

        // 檢查 scheduler
        const schedulerResult = this.scheduler.shouldTrigger({
            bryansMood: this.currentMood,
            loadIntimacyFromSnapshot: true,
            stateSnapshotPath: this.stateSnapshotPath
        });

        return schedulerResult;
    }

    /**
     * 選擇觸發類型
     */
    selectTriggerType(context) {
        // 情緒低落 → 情感共鳴優先
        if (this.currentMood === 'down' || this.currentMood === 'tired') {
            return 'emotional';
        }

        // 檢查是否有 anniversary
        const memories = this.loadMemories();
        const anniversaryResult = this.anniversaryTracker.track(memories, {
            currentTopic: this.currentTopic
        });

        if (anniversaryResult.readyToReminisce.length > 0) {
            // 有 anniversary → 優先使用
            return 'anniversary';
        }

        // 預設 → 隨機
        return 'random';
    }

    /**
     * 觸發情感共鳴回味
     */
    triggerEmotionalReminisce() {
        const memories = this.loadMemories();

        // 使用 emotional matcher 找最佳匹配
        const matchResult = this.emotionalMatcher.match(this.currentMood, memories, {
            maxResults: 3
        });

        if (!matchResult.bestMatch) {
            return { triggered: false };
        }

        // 標記為已觸發
        this.scheduler.markTriggered(matchResult.bestMatch.id || 'emotional_match');

        // 生成回味文字
        const templateResult = this.templateEngine.generate(matchResult.bestMatch, {
            bryansMood: this.currentMood
        });

        return {
            triggered: true,
            type: 'emotional',
            text: templateResult.text,
            memory: matchResult.bestMatch,
            template: templateResult.template,
            moodAnalysis: matchResult.moodAnalysis,
            matchScore: matchResult.bestScore
        };
    }

    /**
     * 觸發週年回味
     */
    triggerAnniversaryReminisce() {
        const memories = this.loadMemories();

        const trackResult = this.anniversaryTracker.track(memories, {
            currentTopic: this.currentTopic
        });

        if (trackResult.readyToReminisce.length === 0) {
            return { triggered: false };
        }

        // 選擇第一個（最高優先級）
        const selected = trackResult.readyToReminisce[0];

        // 標記為已觸發
        this.anniversaryTracker.markTriggered(selected.memory.id, selected.type);
        this.scheduler.markTriggered(selected.memory.id);

        return {
            triggered: true,
            type: selected.type,
            text: selected.text,
            memory: selected.memory,
            yearsAgo: selected.yearsAgo || selected.daysAgo,
            template: 'anniversary'
        };
    }

    /**
     * 觸發隨機回味
     */
    triggerRandomReminisce() {
        const memories = this.loadMemories();

        // 過濾在冷卻中的記憶
        const available = this.scheduler.filterAvailable(memories);

        if (available.length === 0) {
            return { triggered: false };
        }

        // 隨機選擇一個
        const selected = available[Math.floor(Math.random() * available.length)];

        // 標記為已觸發
        this.scheduler.markTriggered(selected.id);

        // 生成回味文字
        const templateResult = this.templateEngine.generate(selected, {
            bryansMood: this.currentMood
        });

        return {
            triggered: true,
            type: 'random',
            text: templateResult.text,
            memory: selected,
            template: templateResult.template
        };
    }

    /**
     * 載入記憶（QMD + LCM）
     */
    loadMemories() {
        const memories = [];

        // 嘗試從 QMD 載入
        if (fs.existsSync(this.qmdPath)) {
            const files = fs.readdirSync(this.qmdPath).filter(f => f.endsWith('.md'));
            
            files.forEach(file => {
                try {
                    const filePath = path.join(this.qmdPath, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    const stats = fs.statSync(filePath);

                    memories.push({
                        id: file,
                        content: content.substring(0, 300),
                        fullContent: content,
                        emotional_tags: this.extractTags(content),
                        emotional_resonance_score: this.extractERS(content),
                        created_at: stats.mtime.toISOString(),
                        source: 'qmd'
                    });
                } catch (err) {
                    // 忽略
                }
            });
        }

        // 如果 QMD 為空，加入測試資料
        if (memories.length === 0) {
            const today = new Date();
            memories.push(
                {
                    id: 'mem_default_1',
                    content: 'Bryan 成功談下了一個重要客戶',
                    emotional_tags: ['success', 'achievement'],
                    emotional_resonance_score: 0.92,
                    created_at: new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString(),
                    source: 'lcm'
                },
                {
                    id: 'mem_default_2',
                    content: '我們在討論 Yua Memory System 的設計',
                    emotional_tags: ['project', 'technical'],
                    emotional_resonance_score: 0.85,
                    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                    source: 'lcm'
                },
                {
                    id: 'mem_default_3',
                    content: 'Bryan 說他最近壓力很大但還是撐過來了',
                    emotional_tags: ['stressed', 'success'],
                    emotional_resonance_score: 0.78,
                    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
                    source: 'lcm'
                }
            );
        }

        return memories;
    }

    /**
     * 從 State Snapshot 載入親密等級
     */
    loadStateSnapshot() {
        try {
            if (!fs.existsSync(this.stateSnapshotPath)) {
                return;
            }

            const content = fs.readFileSync(this.stateSnapshotPath, 'utf8');

            // 解析親密等級
            const intimacyMatch = content.match(/intimacy[:\s]+level[:\s]+(\d)/i);
            if (intimacyMatch) {
                this.intimacyLevel = Math.max(1, Math.min(5, parseInt(intimacyMatch[1])));
            }

            // 解析情緒
            const moodMatch = content.match(/Bryan's?\s+(?:emotional\s+)?state[:\s]+([^\n]+)/i);
            if (moodMatch) {
                this.currentMood = this.normalizeMood(moodMatch[1].trim());
            }
        } catch (err) {
            // 忽略
        }
    }

    /**
     * 提取標籤
     */
    extractTags(content) {
        const match = content.match(/Tags?[:\s]+([^\n]+)/i);
        if (match) {
            return match[1].split(/[,，、]/).map(t => t.trim().toLowerCase()).filter(t => t);
        }
        return [];
    }

    /**
     * 提取 ERS
     */
    extractERS(content) {
        const match = content.match(/ERS[:\s]+([\d.]+)/i);
        return match ? parseFloat(match[1]) : 0.5;
    }

    /**
     * 標準化情緒
     */
    normalizeMood(mood) {
        if (!mood) return 'neutral';
        const lower = mood.toLowerCase();

        const map = {
            down: ['down', 'sad', '難過', '沮喪'],
            tired: ['tired', '累', '疲憊'],
            stressed: ['stressed', '焦慮', '壓力'],
            angry: ['angry', '生氣'],
            happy: ['happy', '開心', '高興']
        };

        for (const [key, keywords] of Object.entries(map)) {
            if (keywords.some(kw => lower.includes(kw))) return key;
        }
        return 'neutral';
    }

    /**
     * 記錄觸發
     */
    recordTrigger(type, data) {
        this.triggerHistory.push({
            type,
            timestamp: new Date().toISOString(),
            memory: data.memory?.id,
            text: data.text?.substring(0, 50)
        });

        // 只保留最近 10 筆記錄
        if (this.triggerHistory.length > 10) {
            this.triggerHistory.shift();
        }
    }

    /**
     * 獲取觸發歷史
     */
    getHistory() {
        return this.triggerHistory;
    }

    /**
     * 獲取引擎狀態
     */
    getStatus() {
        return {
            intimacyLevel: this.intimacyLevel,
            currentMood: this.currentMood,
            currentTopic: this.currentTopic,
            scheduler: this.scheduler.getStatus(),
            loadedMemories: this.loadMemories().length,
            recentTriggers: this.triggerHistory.length
        };
    }
}

// ============================================================
// CLI Interface
// ============================================================

function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
    } else if (args.includes('--test')) {
        runTests();
    } else if (args.includes('--status')) {
        printStatus();
    } else if (args.includes('--simulate')) {
        runSimulation();
    } else {
        runInteractive();
    }
}

function runTests() {
    console.log('🧪 運行 Reminisce Engine 統一 API 測試...\n');

    const engine = new ReminisceEngine({
        intimacyLevel: 3
    });

    // 測試1：被動回味（檢索時）
    console.log('1️⃣ 被動回味測試（檢索記憶時）：');
    const passiveResult = engine.process({
        isReminiscing: true,
        retrievedMemory: {
            id: 'mem_passive_test',
            content: 'Bryan 成功完成了 Yua Memory System 的規劃',
            created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            emotional_tags: ['success', 'achievement'],
            emotional_resonance_score: 0.9
        }
    });

    if (passiveResult.triggered) {
        console.log(`   類型：${passiveResult.type}`);
        console.log(`   模板：${passiveResult.template}`);
        console.log(`   輸出：${passiveResult.text}`);
    }
    console.log('');

    // 測試2：主動觸發（情緒低落）
    console.log('2️⃣ 主動觸發測試（Bryan 情緒低落）：');
    engine.currentMood = 'down';
    engine.intimacyLevel = 3;
    engine.scheduler.intimacyLevel = 3;
    
    // 強制觸發
    engine.scheduler.conversationCount = 100;
    engine.scheduler.lastTriggerConversationCount = 0;

    const activeResult = engine.process({
        bryansMood: 'down'
    });

    console.log(`   觸發：${activeResult.triggered}`);
    if (activeResult.triggered) {
        console.log(`   類型：${activeResult.type}`);
        console.log(`   輸出：${activeResult.text}`);
        console.log(`   記憶：${activeResult.memory?.id}`);
    }
    console.log('');

    // 測試3：狀態查詢
    console.log('3️⃣ 引擎狀態：');
    const status = engine.getStatus();
    console.log(`   親密等級：${status.intimacyLevel}`);
    console.log(`   當前情緒：${status.currentMood}`);
    console.log(`   載入記憶：${status.loadedMemories} 個`);
    console.log(`   今日觸發：${status.scheduler.todayTriggers}/${status.scheduler.dailyMaxTriggers}`);

    console.log('\n✅ 測試完成');
}

function printStatus() {
    console.log('📊 Reminisce Engine 狀態\n');

    const engine = new ReminisceEngine();
    const status = engine.getStatus();

    console.log(`親密等級：${status.intimacyLevel}`);
    console.log(`當前情緒：${status.currentMood}`);
    console.log(`當前話題：${status.currentTopic || '(無)'}`);
    console.log(`載入記憶：${status.loadedMemories} 個`);
    console.log(`今日觸發：${status.scheduler.todayTriggers}/${status.scheduler.dailyMaxTriggers}`);
    console.log(`最近觸發：${status.recentTriggers} 筆`);
    console.log('');

    console.log('觸發歷史：');
    const history = engine.getHistory();
    if (history.length === 0) {
        console.log('  (無)');
    } else {
        history.slice(-5).reverse().forEach(h => {
            console.log(`  [${h.type}] ${h.timestamp} - ${h.text}...`);
        });
    }
}

function runSimulation() {
    console.log('🎮 Reminisce Engine 模擬（10 次對話回合）\n');

    const engine = new ReminisceEngine({ intimacyLevel: 3 });

    const moods = ['neutral', 'neutral', 'happy', 'down', 'neutral', 'tired', 'neutral', 'neutral', 'neutral', 'happy'];

    for (let turn = 1; turn <= 10; turn++) {
        const mood = moods[turn - 1];
        console.log(`\n回合 ${turn}：Bryan 情緒 = ${mood}`);
        console.log('-'.repeat(40));

        const result = engine.process({
            bryansMood: mood,
            currentTopic: '一般日常對話'
        });

        if (result.triggered) {
            console.log(`✅ 觸發 [${result.type}]`);
            console.log(`   ${result.text}`);
            console.log(`   模板：${result.template}`);
        } else {
            const schedulerStatus = engine.scheduler.getStatus();
            console.log(`⏳ 未觸發（還需 ${schedulerStatus.turnsUntilNextTrigger} 次對話）`);
        }
    }

    console.log('\n' + '='.repeat(40));
    console.log('最終狀態：', engine.getStatus());
}

function runInteractive() {
    console.log('🎮 Reminisce Engine 互動模式\n');

    const engine = new ReminisceEngine();

    console.log('用法：');
    console.log('  輸入 Bryan 的情緒（down/tired/stressed/happy/neutral）');
    console.log('  或輸入任何文字作為話題');
    console.log('  輸入 --status 查看狀態');
    console.log('  輸入 --quit 離開\n');

    // 簡單測試
    console.log('快速測試：');
    const result = engine.process({
        bryansMood: 'down',
        currentTopic: '工作壓力'
    });

    if (result.triggered) {
        console.log('\n觸發結果：');
        console.log(`類型：${result.type}`);
        console.log(`輸出：${result.text}`);
    } else {
        console.log('\n未觸發');
        console.log('狀態：', engine.getStatus());
    }
}

function printHelp() {
    console.log(`
reminisce_engine.js - 回味引擎統一 API

用法：
    node reminisce_engine.js              # 互動模式
    node reminisce_engine.js --test       # 運行測試
    node reminisce_engine.js --status     # 查看狀態
    node reminisce_engine.js --simulate    # 模擬 10 回合

統一 API：
    const engine = new ReminisceEngine({ intimacyLevel: 3 });
    
    const result = engine.process({
        bryansMood: 'down',        // Bryan 當前情緒
        currentTopic: '工作',        // Bryan 當前話題（可選）
        isReminiscing: true,       // 是否正在檢索記憶（被動）
        retrievedMemory: memory     // 檢索到的記憶（可選）
    });
    
    if (result.triggered) {
        console.log(result.text);  // 輸出的回味文字
        console.log(result.type);  // 觸發類型
        console.log(result.memory); // 相關記憶
    }

觸發類型：
    - passive: 被動回味（檢索記憶時附加）
    - emotional: 情感共鳴觸發
    - anniversary: 週年紀念日觸發
    - random: 隨機觸發
`);
}

module.exports = { ReminisceEngine };

if (require.main === module) {
    main();
}
