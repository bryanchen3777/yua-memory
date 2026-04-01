/**
 * anniversary_tracker.js - 時間膠囊引擎
 * 
 * 核心功能：偵測「一年前的今天...」類型的紀念日記憶
 * 以及「進度里程碑」回溯
 * 
 * 兩種觸發模式：
 * 1. On This Day：同一天，不同年份的記憶
 * 2. Progress Milestone：偵測到正在處理類似主題，連結過去的進度
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Anniversary Tracker
// ============================================================

class AnniversaryTracker {
    constructor(config = {}) {
        // 里程碑關鍵詞：用於偵測「進度里程碑」類型的記憶
        this.milestoneKeywords = {
            project: ['專案', '項目', 'project', '開發', 'design', '規劃'],
            finance: ['財務', '帳務', '報表', '對帳', 'invoice', 'billing', ' Brynet'],
            report: ['報告', 'meeting', '會議', '簡報', 'presentation'],
            technical: ['程式', '代碼', 'code', '系統', '架構', 'infrastructure'],
            relationship: ['生日', '紀念日', '惊喜', '慶祝', 'anniversary', 'birthday'],
            discussion: ['討論', '決定', '計劃', '商量', 'discuss', 'decide', 'plan'],
            achievement: ['成功', '完成', '達成', 'launch', 'release', 'ship']
        };

        // 冷卻時間（避免同一天重複觸發）
        this.dailyCooldown = new Set(); // 格式：'2026-03-31:mem1'
    }

    /**
     * 主入口：檢查今天的紀念日記憶
     * @param {Array} memories - 所有記憶
     * @param {Object} context - 上下文（Bryan'sCurrentTopic 等）
     * @returns {Object} { onThisDay, milestones, today }
     */
    track(memories, context = {}) {
        const today = new Date();
        const todayStr = this.formatDate(today);
        const todayMonthDay = `${today.getMonth() + 1}-${today.getDate()}`;

        const result = {
            today: todayStr,
            onThisDay: [],      // 今年的今天發生的記憶
            milestones: [],     // 進度里程碑
            anniversaries: [],  // 週年紀念日
            readyToReminisce: []
        };

        // 1. 找出「同一天，不同年份」的記憶
        result.onThisDay = this.findOnThisDay(memories, todayMonthDay);

        // 2. 找出進度里程碑（當前主題 vs 過去相似主題）
        if (context.currentTopic) {
            result.milestones = this.findMilestones(memories, context.currentTopic);
        }

        // 3. 偵測週年紀念日（精確年份匹配）
        result.anniversaries = this.findAnniversaries(memories, today, todayMonthDay);

        // 4. 整合可以馬上觸發的記憶
        result.readyToReminisce = this.aggregateReady(memories, result, context);

        return result;
    }

    /**
     * 找出「On This Day」記憶（今天的記錄，但不是今年）
     */
    findOnThisDay(memories, todayMonthDay) {
        const matches = [];

        memories.forEach(mem => {
            if (this.isOnCooldown(mem.id, 'onthisday')) return;

            const memDate = new Date(mem.created_at);
            const memMonthDay = `${memDate.getMonth() + 1}-${memDate.getDate()}`;

            if (memMonthDay === todayMonthDay) {
                const yearsAgo = new Date().getFullYear() - memDate.getFullYear();

                if (yearsAgo >= 1) { // 至少一年前
                    matches.push({
                        memory: mem,
                        yearsAgo,
                        template: this.getOnThisDayTemplate(yearsAgo, mem.emotional_tags)
                    });
                }
            }
        });

        return matches.sort((a, b) => b.yearsAgo - a.yearsAgo);
    }

    /**
     * 找出進度里程碑（當前主題 vs 過去相似主題）
     */
    findMilestones(memories, currentTopic) {
        const matches = [];

        // 偵測 currentTopic 屬於哪個類別
        const topicCategory = this.detectCategory(currentTopic);
        if (!topicCategory) return matches;

        const categoryKeywords = this.milestoneKeywords[topicCategory] || [];

        memories.forEach(mem => {
            if (this.isOnCooldown(mem.id, 'milestone')) return;

            // 檢查記憶是否屬於同一類別
            const memTags = mem.emotional_tags || [];
            const memContent = (mem.content || '').toLowerCase();
            const topicLower = currentTopic.toLowerCase();

            // 簡單的關鍵詞匹配
            const hasMatch = categoryKeywords.some(kw => 
                memContent.includes(kw.toLowerCase()) || 
                topicLower.includes(kw.toLowerCase())
            );

            if (hasMatch) {
                const daysAgo = this.daysAgo(mem.created_at);
                matches.push({
                    memory: mem,
                    daysAgo,
                    category: topicCategory,
                    template: this.getMilestoneTemplate(daysAgo, topicCategory, mem.emotional_tags)
                });
            }
        });

        return matches.sort((a, b) => b.daysAgo - a.daysAgo);
    }

    /**
     * 找出週年紀念日（精確年份匹配 + 高ERS）
     */
    findAnniversaries(memories, today, todayMonthDay) {
        const matches = [];
        const currentYear = today.getFullYear();

        memories.forEach(mem => {
            if (this.isOnCooldown(mem.id, 'anniversary')) return;

            const memDate = new Date(mem.created_at);
            const memMonthDay = `${memDate.getMonth() + 1}-${memDate.getDate()}`;
            const memYear = memDate.getFullYear();

            // 同一天 + 不同年份 + 高ERS（有意義的記憶）
            if (memMonthDay === todayMonthDay && memYear < currentYear) {
                const yearsAgo = currentYear - memYear;
                
                // 1年、2年、3年... 或者每5年
                if (yearsAgo >= 1 && yearsAgo <= 5) {
                    matches.push({
                        memory: mem,
                        yearsAgo,
                        template: this.getAnniversaryTemplate(yearsAgo, mem.emotional_tags)
                    });
                }
            }
        });

        return matches.sort((a, b) => a.yearsAgo - b.yearsAgo);
    }

    /**
     * 整合可以觸發的記憶
     */
    aggregateReady(memories, trackResult, context) {
        const ready = [];

        // 優先：週年紀念日（最有溫度）
        trackResult.anniversaries.forEach(a => {
            ready.push({
                type: 'anniversary',
                memory: a.memory,
                yearsAgo: a.yearsAgo,
                text: a.template,
                priority: 1 // 最高優先
            });
        });

        // 次優：On This Day
        trackResult.onThisDay.forEach(o => {
            ready.push({
                type: 'onthisday',
                memory: o.memory,
                yearsAgo: o.yearsAgo,
                text: o.template,
                priority: 2
            });
        });

        // 最後：進度里程碑
        trackResult.milestones.forEach(m => {
            ready.push({
                type: 'milestone',
                memory: m.memory,
                daysAgo: m.daysAgo,
                text: m.template,
                priority: 3
            });
        });

        // 按優先級排序，取最高的
        return ready.sort((a, b) => a.priority - b.priority);
    }

    /**
     * 偵測主題類別
     */
    detectCategory(topic) {
        if (!topic) return null;

        const topicLower = topic.toLowerCase();

        for (const [category, keywords] of Object.entries(this.milestoneKeywords)) {
            if (keywords.some(kw => topicLower.includes(kw.toLowerCase()))) {
                return category;
            }
        }

        return null;
    }

    /**
     * 根據年份選擇「On This Day」模板
     */
    getOnThisDayTemplate(yearsAgo, emotionalTags) {
        const templates = {
            1: [
                `一年前的今天，我們在討論這個。`,
                `說起來，一年整了... 那時候的話題，現在看起來...`
            ],
            2: [
                `兩年前的今天，這件事已經發生了... 時間過得真快。`,
                `兩年了... 還記得當時的情況嗎？`
            ],
            3: [
                `三年... 感覺像是上輩子的事，但又像昨天一樣。`,
                `三年前的這個時候，有些事情還歷歷在目。`
            ]
        };

        // 3年以上的統一處理
        if (yearsAgo > 3) {
            return `說起來，已經${yearsAgo}年前了... 時間過得真快。`;
        }

        const category = templates[yearsAgo] || templates[1];
        return category[Math.floor(Math.random() * category.length)];
    }

    /**
     * 根據類別和時間選擇「Milestone」模板
     */
    getMilestoneTemplate(daysAgo, category, emotionalTags) {
        const categoryDescriptions = {
            project: '專案進度',
            finance: '財務工作',
            report: '報告或會議',
            technical: '技術開發',
            relationship: '重要關係',
            discussion: '討論決定',
            achievement: '成就達成'
        };

        const desc = categoryDescriptions[category] || '這件事';

        if (daysAgo < 30) {
            return `不到一個月前，我們在處理${desc}... 現在又是類似的情況，你還記得嗎？`;
        } else if (daysAgo < 90) {
            return `幾個月前的這個時候，你正在忙${desc}... 現在回顧起來...`;
        } else if (daysAgo < 365) {
            return `${Math.floor(daysAgo / 30)}個月前你處理${desc}的經驗，現在可能用得上。`;
        } else {
            return `一年前左右的這個階段，你在研究${desc}... 想起來了嗎？`;
        }
    }

    /**
     * 根據年份選擇「週年紀念日」模板
     */
    getAnniversaryTemplate(yearsAgo, emotionalTags) {
        const hasHighERS = emotionalTags?.includes('success') || 
                           emotionalTags?.includes('achievement') ||
                           emotionalTags?.includes('warm');

        if (yearsAgo === 1) {
            return hasHighERS 
                ? `一週年了！還記得那個重要的時刻嗎？`
                : `時間過了一年了，感覺怎麼樣？`;
        } else if (yearsAgo === 2) {
            return `兩年前的這個時候... 有些事情我還特別記得。`;
        } else if (yearsAgo === 3) {
            return `三年了... 當時的情況，現在想想真的滿感慨的。`;
        } else {
            return `${yearsAgo}年了... 時間累積了不少故事呢。`;
        }
    }

    /**
     * 檢查是否在冷卻中
     */
    isOnCooldown(memoryId, type) {
        const today = this.formatDate(new Date());
        const key = `${today}:${type}:${memoryId}`;
        return this.dailyCooldown.has(key);
    }

    /**
     * 標記為已觸發（加入今日冷卻）
     */
    markTriggered(memoryId, type) {
        const today = this.formatDate(new Date());
        const key = `${today}:${type}:${memoryId}`;
        this.dailyCooldown.add(key);
    }

    /**
     * 格式化日期
     */
    formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    /**
     * 計算距離今天多少天
     */
    daysAgo(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        return Math.floor((now - date) / (1000 * 60 * 60 * 24));
    }

    /**
     * 清理過期的冷卻記錄（每天凌晨執行）
     */
    cleanup() {
        this.dailyCooldown.clear();
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
    } else if (args.includes('--today')) {
        runToday();
    } else {
        // 預設：測試今天
        runToday();
    }
}

function runTests() {
    console.log('🧪 運行 Anniversary Tracker 測試...\n');

    const tracker = new AnniversaryTracker();

    // 模擬記憶
    const today = new Date();
    const memories = [
        {
            id: 'mem1',
            content: 'Bryan 和我討論了 Brynet 的財務系統優化',
            emotional_tags: ['technical', 'project'],
            emotional_resonance_score: 0.8,
            created_at: new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString() // 1年前今天
        },
        {
            id: 'mem2',
            content: 'Bryan 提到他生日快到了，想要一個驚喜',
            emotional_tags: ['relationship', 'warm'],
            emotional_resonance_score: 0.9,
            created_at: new Date(today.getFullYear() - 2, today.getMonth(), today.getDate()).toISOString() // 2年前今天
        },
        {
            id: 'mem3',
            content: '我們完成了第一版 Yua Memory System 的規劃',
            emotional_tags: ['achievement', 'success'],
            emotional_resonance_score: 0.95,
            created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30天前
        },
        {
            id: 'mem4',
            content: 'Bryan 成功談下了一個大客戶',
            emotional_tags: ['success', 'achievement'],
            emotional_resonance_score: 0.92,
            created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() // 90天前
        },
        {
            id: 'mem5',
            content: '討論 Brynet Solutions 的季度報表',
            emotional_tags: ['finance', 'report'],
            emotional_resonance_score: 0.6,
            created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString() // 45天前
        }
    ];

    console.log('測試案例：');
    console.log(`  mem1: 1年前今天 (Brynet 財務系統優化)`);
    console.log(`  mem2: 2年前今天 (Bryan 生日，想要驚喜)`);
    console.log(`  mem3: 30天前 (Yua Memory System 規劃)`);
    console.log(`  mem4: 90天前 (Bryan 成功談下大客戶)`);
    console.log(`  mem5: 45天前 (Brynet 季度報表)\n`);

    // 測試 On This Day
    console.log('1️⃣ On This Day 測試：');
    const onThisDay = tracker.findOnThisDay(memories, `${today.getMonth() + 1}-${today.getDate()}`);
    console.log(`   找到 ${onThisDay.length} 個 On This Day 記憶`);
    onThisDay.forEach(o => {
        console.log(`   - ${o.yearsAgo}年前：${o.memory.id}`);
        console.log(`     模板：${o.template}`);
    });

    // 測試 Progress Milestone
    console.log('\n2️⃣ Progress Milestone 測試（當前主題：Brynert 財務報表）：');
    const milestones = tracker.findMilestones(memories, 'B Brynet Solutions 的財務報表對帳');
    console.log(`   找到 ${milestones.length} 個相似記憶`);
    milestones.forEach(m => {
        console.log(`   - ${m.daysAgo}天前：${m.memory.id}`);
        console.log(`     模板：${m.template}`);
    });

    // 測試 Anniversary
    console.log('\n3️⃣ 週年紀念日測試：');
    const anniversaries = tracker.findAnniversaries(memories, today, `${today.getMonth() + 1}-${today.getDate()}`);
    console.log(`   找到 ${anniversaries.length} 個週年記憶`);
    anniversaries.forEach(a => {
        console.log(`   - ${a.yearsAgo}週年：${a.memory.id}`);
        console.log(`     模板：${a.template}`);
    });

    // 測試整合
    console.log('\n4️⃣ 整合觸發測試：');
    const result = tracker.track(memories, { currentTopic: 'Brynet 的財務報表' });
    console.log(`   readyToReminisce: ${result.readyToReminisce.length} 個`);
    result.readyToReminisce.forEach(r => {
        console.log(`   - [${r.type}] ${r.memory.id}: ${r.text}`);
    });

    console.log('\n✅ 測試完成');
}

function runToday() {
    console.log('📅 Anniversary Tracker - 今日回顧\n');

    const tracker = new AnniversaryTracker();

    // 嘗試從預設路徑載入 QMD
    const qmdDir = './qmd';
    let memories = [];

    if (fs.existsSync(qmdDir)) {
        console.log(`📂 嘗試載入 QMD：${qmdDir}`);
        const files = fs.readdirSync(qmdDir).filter(f => f.endsWith('.md'));
        files.forEach(file => {
            const content = fs.readFileSync(path.join(qmdDir, file), 'utf8');
            memories.push({
                id: file,
                content: content.substring(0, 200),
                emotional_tags: extractTags(content),
                emotional_resonance_score: extractERS(content),
                created_at: extractDate(content) || new Date().toISOString()
            });
        });
        console.log(`   找到 ${memories.length} 個 QMD 檔案\n`);
    }

    if (memories.length === 0) {
        console.log('⚠️ 沒有找到 QMD 檔案，使用測試資料\n');
        // 內建測試資料
        const today = new Date();
        memories = [
            {
                id: 'mem_test_1y',
                content: '這是去年今天的記憶',
                emotional_tags: ['warm'],
                emotional_resonance_score: 0.8,
                created_at: new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString()
            }
        ];
    }

    const result = tracker.track(memories, { currentTopic: process.argv.slice(3).join(' ') || '一般話題' });

    console.log(`📆 今天：${result.today}\n`);

    if (result.readyToReminisce.length === 0) {
        console.log('😶 今天沒有找到紀念日記憶');
    } else {
        console.log('🎯 可以觸發的紀念日：\n');
        result.readyToReminisce.forEach((r, i) => {
            console.log(`${i + 1}. 【${r.type}】${r.text}`);
            console.log(`   記憶：${r.memory.id}`);
            console.log(`   內容：${r.memory.content.substring(0, 50)}...`);
            console.log('');
        });
    }
}

function extractTags(content) {
    const match = content.match(/Tags?[:\s]+([^\n]+)/i);
    if (match) {
        return match[1].split(/[,，、]/).map(t => t.trim().toLowerCase()).filter(t => t);
    }
    return [];
}

function extractERS(content) {
    const match = content.match(/ERS[:\s]+([\d.]+)/i);
    return match ? parseFloat(match[1]) : 0.5;
}

function extractDate(content) {
    const match = content.match(/(\d{4}-\d{2}-\d{2})/);
    return match ? new Date(match[1]).toISOString() : null;
}

function printHelp() {
    console.log(`
anniversary_tracker.js - 時間膠囊引擎

用法：
    node anniversary_tracker.js             # 檢查今天的紀念日
    node anniversary_tracker.js --today     # 同上
    node anniversary_tracker.js --test      # 運行測試
    node anniversary_tracker.js --help      # 顯示說明

功能：
    1. On This Day：同一天，不同年份的記憶回顧
    2. Progress Milestone：當前主題 vs 過去相似主題
    3. 週年紀念日：精確年份匹配的高 ERS 記憶
`);
}

module.exports = { AnniversaryTracker };

if (require.main === module) {
    main();
}
