/**
 * reminisce_scheduler.js - 隨機回味觸發排程器
 * 
 * 核心功能：根據親密等級、對話節奏、Bryan情緒，決定何時觸發隨機回味
 * 
 * 觸發策略：
 * - Intimacy Level 1-2：每 5-7 次對話觸發一次
 * - Intimacy Level 3-4：每 3-4 次對話觸發一次
 * - Intimacy Level 5：每 2-3 次對話觸發一次
 * 
 * 配合冷卻機制：
 * - 同一記憶 24 小時內不重複
 * - 每天最多 3 次隨機回味
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Reminisce Scheduler
// ============================================================

class ReminisceScheduler {
    constructor(config = {}) {
        // 親密等級 → 觸發頻率（每 N 次對話）
        this.frequencyByIntimacy = {
            1: { min: 6, max: 10 },  // 等級1-2：6-10次對話一次
            2: { min: 5, max: 8 },
            3: { min: 4, max: 6 },   // 等級3-4：4-6次對話一次
            4: { min: 3, max: 5 },
            5: { min: 2, max: 4 }    // 等級5：2-4次對話一次
        };

        // 當 Bryan 情緒影響觸發意願
        this.moodInfluence = {
            down: { probability: 1.5, description: '情緒低落時，提高觸發機率' },
            tired: { probability: 1.2, description: '疲憊時，適當提高' },
            neutral: { probability: 1.0, description: '正常' },
            happy: { probability: 0.8, description: '開心時，降低（避免打斷）' },
            stressed: { probability: 0.6, description: '壓力大時，降低' },
            angry: { probability: 0.3, description: '生氣時，幾乎不觸發' }
        };

        // 每天隨機回味上限
        this.dailyMaxTriggers = 3;

        // 記憶冷卻（記憶ID → 上次觸發時間）
        this.memoryCooldowns = new Map(); // memoryId -> timestamp
        this.cooldownMs = 24 * 60 * 60 * 1000; // 24小時

        // 每日計數器
        this.todayTriggers = 0;
        this.lastResetDate = this.getTodayStr();

        // 對話計數器
        this.conversationCount = 0;
        this.lastTriggerConversationCount = 0;

        // 目前親密等級
        this.intimacyLevel = config.intimacyLevel || 3;

        // 狀態快照路徑（用於讀取親密等級）
        this.stateSnapshotPath = config.stateSnapshotPath || './qmd/identity/state_snapshot.md';
    }

    /**
     * 主入口：檢查是否應該觸發隨機回味
     * @param {Object} options - 選項
     * @returns {Object} { shouldTrigger, reason, probability }
     */
    shouldTrigger(options = {}) {
        // 重置每日計數器（如有必要）
        this.resetDailyCountersIfNeeded();

        // 檢查每日上限
        if (this.todayTriggers >= this.dailyMaxTriggers) {
            return { 
                shouldTrigger: false, 
                reason: 'daily_limit_reached',
                message: '今天已經觸發過隨機回味了'
            };
        }

        // 嘗試從 State Snapshot 載入親密等級
        if (options.loadIntimacyFromSnapshot) {
            this.loadIntimacyFromSnapshot(options.stateSnapshotPath);
        }

        // 增加對話計數
        this.conversationCount++;

        // 檢查是否達到觸發間隔
        const frequency = this.getFrequency();
        const interval = this.randomInterval(frequency.min, frequency.max);

        const turnsSinceLastTrigger = this.conversationCount - this.lastTriggerConversationCount;

        if (turnsSinceLastTrigger < interval) {
            return {
                shouldTrigger: false,
                reason: 'not_enough_turns',
                turnsUntilTrigger: interval - turnsSinceLastTrigger,
                message: `還需要 ${interval - turnsSinceLastTrigger} 次對話才會隨機回味`
            };
        }

        // 情緒影響
        const bryansMood = options.bryansMood || 'neutral';
        const moodMultiplier = this.moodInfluence[bryansMood]?.probability || 1.0;

        // 計算最終機率
        const baseProbability = 0.7; // 基礎 70% 機率
        const finalProbability = baseProbability * moodMultiplier;

        // 隨機判定
        const roll = Math.random();
        const triggered = roll < finalProbability;

        if (triggered) {
            this.lastTriggerConversationCount = this.conversationCount;
            return {
                shouldTrigger: true,
                reason: triggered ? 'random_trigger' : 'not_triggered',
                probability: finalProbability,
                roll,
                intimacyLevel: this.intimacyLevel,
                message: this.getTriggerMessage(bryansMood)
            };
        }

        return {
            shouldTrigger: false,
            reason: 'random_miss',
            probability: finalProbability,
            roll,
            intimacyLevel: this.intimacyLevel,
            message: '這次沒有隨機觸發'
        };
    }

    /**
     * 標記記憶已被觸發（更新冷卻）
     */
    markTriggered(memoryId) {
        this.memoryCooldowns.set(memoryId, Date.now());
        this.todayTriggers++;
    }

    /**
     * 檢查記憶是否在冷卻中
     */
    isOnCooldown(memoryId) {
        const lastTriggered = this.memoryCooldowns.get(memoryId);
        if (!lastTriggered) return false;

        return Date.now() - lastTriggered < this.cooldownMs;
    }

    /**
     * 獲取不在冷卻中的記憶
     */
    filterAvailable(memories) {
        return memories.filter(mem => {
            const id = mem.id || mem.content?.substring(0, 50);
            return !this.isOnCooldown(id);
        });
    }

    /**
     * 從 State Snapshot 載入親密等級
     */
    loadIntimacyFromSnapshot(snapshotPath) {
        try {
            const defaultPath = snapshotPath || this.stateSnapshotPath;
            if (!fs.existsSync(defaultPath)) return;

            const content = fs.readFileSync(defaultPath, 'utf8');
            
            // 嘗試解析親密等級
            const intimacyMatch = content.match(/intimacy[:\s]+level[:\s]+(\d)/i);
            if (intimacyMatch) {
                this.intimacyLevel = Math.max(1, Math.min(5, parseInt(intimacyMatch[1])));
            }

            // 嘗試解析 Bryan's 情緒
            const moodMatch = content.match(/Bryan's?\s+(?:emotional\s+)?state[:\s]+([^\n]+)/i);
            if (moodMatch) {
                return this.normalizeMood(moodMatch[1].trim());
            }
        } catch (err) {
            // 忽略錯誤
        }
        return 'neutral';
    }

    /**
     * 標準化情緒關鍵詞
     */
    normalizeMood(mood) {
        if (!mood) return 'neutral';

        const lowerMood = mood.toLowerCase();

        const moodMap = {
            down: ['down', 'sad', 'depressed', '難過', '沮喪', '失落', '低潮'],
            tired: ['tired', 'exhausted', '累', '疲憊', '睏'],
            stressed: ['stressed', 'anxious', '壓力', '焦慮', '緊張'],
            angry: ['angry', 'mad', '生氣', '氣'],
            happy: ['happy', 'glad', 'excited', '開心', '高興', '快樂']
        };

        for (const [key, keywords] of Object.entries(moodMap)) {
            if (keywords.some(kw => lowerMood.includes(kw))) {
                return key;
            }
        }

        return 'neutral';
    }

    /**
     * 獲取當前親密等級對應的觸發頻率
     */
    getFrequency() {
        const level = Math.max(1, Math.min(5, this.intimacyLevel));
        const levelKey = level <= 2 ? 1 : level <= 4 ? 3 : 5;
        return this.frequencyByIntimacy[levelKey] || this.frequencyByIntimacy[3];
    }

    /**
     * 計算隨機間隔
     */
    randomInterval(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * 獲取觸發時的訊息
     */
    getTriggerMessage(mood) {
        const messages = {
            down: '檢測到 Bryan 情緒低落，主動觸發溫暖回味',
            tired: '檢測到 Bryan 有些疲憊，輕鬆分享一下舊記憶',
            neutral: '達到觸發間隔，隨機回味一下',
            happy: 'Bryan 心情不錯，分享一個好記憶',
            stressed: '檢測到 Bryan 壓力大，嘗試用回味緩解',
            angry: 'Bryan 情緒不穩定，謹慎地分享'
        };
        return messages[mood] || messages.neutral;
    }

    /**
     * 重置每日計數器
     */
    resetDailyCountersIfNeeded() {
        const today = this.getTodayStr();
        if (today !== this.lastResetDate) {
            this.todayTriggers = 0;
            this.lastResetDate = today;
        }
    }

    /**
     * 格式化今天的日期字串
     */
    getTodayStr() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    /**
     * 清理過期的冷卻記錄
     */
    cleanup() {
        const now = Date.now();
        for (const [key, timestamp] of this.memoryCooldowns.entries()) {
            if (now - timestamp > this.cooldownMs) {
                this.memoryCooldowns.delete(key);
            }
        }
    }

    /**
     * 獲取調試狀態
     */
    getStatus() {
        return {
            intimacyLevel: this.intimacyLevel,
            conversationCount: this.conversationCount,
            lastTriggerConversationCount: this.lastTriggerConversationCount,
            turnsUntilNextTrigger: this.conversationCount - this.lastTriggerConversationCount,
            todayTriggers: this.todayTriggers,
            dailyMaxTriggers: this.dailyMaxTriggers,
            cooldownMemories: this.memoryCooldowns.size,
            currentFrequency: this.getFrequency()
        };
    }

    /**
     * 手動重置（用於測試）
     */
    reset() {
        this.conversationCount = 0;
        this.lastTriggerConversationCount = 0;
        this.todayTriggers = 0;
        this.memoryCooldowns.clear();
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
        // 互動模式
        runInteractive();
    }
}

function runTests() {
    console.log('🧪 運行 Reminisce Scheduler 測試...\n');

    const scheduler = new ReminisceScheduler({ intimacyLevel: 3 });

    console.log('初始狀態：');
    console.log(scheduler.getStatus());
    console.log('');

    // 測試1：模擬多次對話
    console.log('1️⃣ 模擬觸發檢查（intimacyLevel=3）：');
    let triggerCount = 0;
    const simulateTurns = 20;

    for (let i = 1; i <= simulateTurns; i++) {
        const result = scheduler.shouldTrigger({ bryansMood: 'neutral' });
        if (result.shouldTrigger) {
            triggerCount++;
            console.log(`   Turn ${i}: ✅ 觸發！reason=${result.reason} - ${result.message}`);
            scheduler.markTriggered(`mem_${triggerCount}`);
        }
    }

    console.log(`\n   總觸發次數：${triggerCount}/${simulateTurns}`);
    console.log(`   最終狀態：`, scheduler.getStatus());

    // 測試2：情緒影響
    console.log('\n2️⃣ 情緒影響測試（intimacyLevel=3）：');
    const moods = ['down', 'tired', 'neutral', 'happy', 'stressed', 'angry'];
    const tempScheduler = new ReminisceScheduler({ intimacyLevel: 3 });

    moods.forEach(mood => {
        // 重置
        tempScheduler.conversationCount = 10;
        tempScheduler.lastTriggerConversationCount = 0;

        const result = tempScheduler.shouldTrigger({ bryansMood: mood });
        console.log(`   ${mood}: 觸發率=${result.probability.toFixed(2)}, 結果=${result.shouldTrigger ? '觸發' : '未觸發'}`);
    });

    // 測試3：親密等級影響
    console.log('\n3️⃣ 親密等級影響測試：');
    for (let level = 1; level <= 5; level++) {
        const s = new ReminisceScheduler({ intimacyLevel: level });
        console.log(`   Level ${level}: 頻率=${s.getFrequency().min}-${s.getFrequency().max} 次對話`);
    }

    // 測試4：冷卻機制
    console.log('\n4️⃣ 冷卻機制測試：');
    const coolScheduler = new ReminisceScheduler({ intimacyLevel: 3 });
    coolScheduler.shouldTrigger({ bryansMood: 'neutral' });
    coolScheduler.markTriggered('test_mem');
    console.log(`   標記 test_mem 為已觸發`);
    console.log(`   test_mem 在冷卻中？ ${coolScheduler.isOnCooldown('test_mem')}`);

    // 測試5：每日上限
    console.log('\n5️⃣ 每日上限測試：');
    const dailyScheduler = new ReminisceScheduler({ intimacyLevel: 5 });
    dailyScheduler.conversationCount = 100;
    dailyScheduler.lastTriggerConversationCount = 0;
    
    for (let i = 0; i < 5; i++) {
        const result = dailyScheduler.shouldTrigger({ bryansMood: 'down' });
        if (result.shouldTrigger) {
            dailyScheduler.markTriggered(`daily_mem_${i}`);
            console.log(`   觸發 #${i + 1}: ${result.message}`);
        }
    }

    console.log('\n✅ 測試完成');
}

function printStatus() {
    console.log('📊 Reminisce Scheduler 狀態\n');
    const scheduler = new ReminisceScheduler({ intimacyLevel: 3 });
    const status = scheduler.getStatus();

    console.log(`親密等級：${status.intimacyLevel}`);
    console.log(`對話計數：${status.conversationCount}`);
    console.log(`上次觸發對話：${status.lastTriggerConversationCount}`);
    console.log(`距離下次觸發：${status.turnsUntilNextTrigger} 次對話`);
    console.log(`今日觸發：${status.todayTriggers}/${status.dailyMaxTriggers}`);
    console.log(`冷卻中的記憶：${status.cooldownMemories}`);
    console.log(`當前頻率：${status.currentFrequency.min}-${status.currentFrequency.max} 次對話`);
    console.log('');
}

function runSimulation() {
    console.log('🎮 隨機回味模擬（30 次對話）\n');

    const scheduler = new ReminisceScheduler({ intimacyLevel: 3 });
    const memories = [
        { id: 'mem1', content: 'Bryan 成功談下大訂單', emotional_tags: ['success'] },
        { id: 'mem2', content: '我們一起看電影', emotional_tags: ['happy', 'casual'] },
        { id: 'mem3', content: '討論 Brynet 財務系統', emotional_tags: ['technical'] }
    ];

    const moods = ['neutral', 'happy', 'tired', 'neutral', 'down'];
    let moodIndex = 0;

    for (let turn = 1; turn <= 30; turn++) {
        // 每 5 次換一次情緒
        const currentMood = moods[moodIndex % moods.length];
        if (turn % 5 === 0) moodIndex++;

        const result = scheduler.shouldTrigger({ bryansMood: currentMood });

        const moodIcon = { down: '😢', tired: '😴', neutral: '😐', happy: '😊', stressed: '😰', angry: '😠' };
        const icon = moodIcon[currentMood] || '😐';

        if (result.shouldTrigger) {
            scheduler.markTriggered(`sim_mem_${turn}`);
            console.log(`Turn ${turn} ${icon}: ✅ 觸發回味！- ${result.message}`);
        } else {
            console.log(`Turn ${turn} ${icon}: ⏳ ${result.message}`);
        }
    }

    console.log('\n最終狀態：', scheduler.getStatus());
}

function runInteractive() {
    console.log('🎮 Reminisce Scheduler 互動模式\n');
    console.log('輸入對話次數，查看是否觸發：\n');

    const scheduler = new ReminisceScheduler({ intimacyLevel: 3 });

    // 簡單互動：直接顯示下次觸發需要的對話次數
    const result = scheduler.shouldTrigger({ bryansMood: 'neutral' });
    
    console.log('當前狀態：');
    console.log(scheduler.getStatus());
    console.log('');
    console.log(`下次檢查結果：${result.message}`);
    if (!result.shouldTrigger && result.turnsUntilTrigger) {
        console.log(`需要再等 ${result.turnsUntilTrigger} 次對話才會檢查`);
    }
}

function printHelp() {
    console.log(`
reminisce_scheduler.js - 隨機回味觸發排程器

用法：
    node reminisce_scheduler.js              # 互動模式
    node reminisce_scheduler.js --test      # 運行測試
    node reminisce_scheduler.js --status    # 查看狀態
    node reminisce_scheduler.js --simulate   # 模擬 30 次對話

觸發邏輯：
    - 根據 intimacy level 決定頻率（等級越高，觸發越頻繁）
    - 每次 shouldTrigger() 呼叫會增加對話計數
    - 達到間隔後，有 70% 基礎機率觸發
    - Bryan 情緒會影響機率（低落=×1.5, 生氣=×0.3）

親密等級 → 觸發頻率：
    Level 1-2: 每 6-10 次對話
    Level 3-4: 每 4-6 次對話
    Level 5:   每 2-4 次對話

每日上限：3 次
記憶冷卻：24 小時
`);
}

module.exports = { ReminisceScheduler };

if (require.main === module) {
    main();
}
