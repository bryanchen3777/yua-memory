/**
 * emotional_matcher.js - 情緒匹配引擎
 * 
 * 核心功能：對比 Bryan's 當前情緒 vs 記憶的 emotional_tags，
 * 找出最適合触发「回味」的情感共鳴記憶
 * 
 * 匹配邏輯：
 * - Bryan 情緒低落 → 尋找「成功/被肯定/温暖」記憶
 * - Bryan 生氣 → 尋找「冷靜/理性討論」記憶
 * - Bryan 疲憊 → 尋找「轻松/休閒/有趣」記憶
 * - Bryan 焦慮 → 尋找「問題解決/被支持」記憶
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Emotional Matcher Engine
// ============================================================

class EmotionalMatcher {
    constructor(config = {}) {
        // 情緒關鍵詞表
        this.moodKeywords = {
            down: ['難過', '傷心', '失落', '沮喪', '低潮', '不開心', '鬱悶', 'depressed', 'down', 'sad'],
            tired: ['累', '疲憊', '睏', '想睡', '精神不好', '好累', 'tired', 'exhausted', 'fatigue'],
            stressed: ['壓力', '焦慮', '緊張', '不安', '著急', '慌', 'stressed', 'anxious', 'worried'],
            angry: ['生氣', '氣', '不爽', '憤怒', '火大', '惱火', 'angry', 'mad', 'frustrated'],
            happy: ['開心', '高興', '快樂', '興奮', '期待', '滿足', 'happy', 'excited', 'glad'],
            neutral: ['一般', '普通', '正常', '還好', 'neutral', 'okay', 'fine']
        };

        // 情緒 → 目標標籤映射
        // 當 Bryan 處於某情緒時，我們想找什麼類型的記憶
        this.moodToTargetTags = {
            down: ['success', 'achievement', 'warm', 'grateful', 'praise'],
            tired: ['relaxed', 'funny', 'casual', 'playful', 'rest'],
            stressed: ['solution', 'calm', 'rational', 'supported', 'problem_solved'],
            angry: ['calm', 'rational', 'apology', 'reconciliation', 'understanding'],
            happy: ['celebration', 'shared_joy', 'gratitude', 'positive'],
            neutral: ['general', 'informative', 'casual']
        };

        // 情緒 → 反向標籤（避免觸發）
        // 當 Bryan 憤怒時，不要給他更多刺激
        this.moodToAvoidTags = {
            down: ['failure', 'criticism', 'rejection'],
            tired: ['stress', 'urgent', 'complex', 'difficult'],
            stressed: ['failure', 'rejection', 'conflict'],
            angry: ['confrontation', 'criticism', 'failure'],
            happy: [],  // 啥都不避
            neutral: []
        };

        // 冷卻追蹤
        this.recentlyMatched = []; // { memoryId, matchedAt, mood }
        this.cooldownMs = config.cooldownMs || 2 * 60 * 60 * 1000; // 2小時內不重複
    }

    /**
     * 主入口：根據 Bryan 當前情緒，從記憶列表中找出最佳匹配
     * @param {string} bryansMood - Bryan 的當前情緒
     * @param {Array} memories - 記憶列表（每個需要有 emotional_tags 和 content）
     * @param {Object} options - 額外選項
     * @returns {Object} { bestMatch, allMatches, moodAnalysis }
     */
    match(bryansMood, memories, options = {}) {
        const maxResults = options.maxResults || 5;
        const minScore = options.minScore || 0.3;

        // 標準化情緒
        const normalizedMood = this.normalizeMood(bryansMood);

        // 計算每個記憶的分數
        const scored = memories.map(mem => {
            const score = this.calculateMatchScore(mem, normalizedMood);
            return { memory: mem, score };
        });

        // 按分數排序
        scored.sort((a, b) => b.score - a.score);

        // 過濾低分記憶
        const filtered = scored.filter(s => s.score >= minScore);

        // 移除冷卻中的記憶
        const available = filtered.filter(s => !this.isOnCooldown(s.memory));

        // 選擇最佳
        const bestMatch = available[0] || null;
        const allMatches = available.slice(0, maxResults);

        // 更新冷卻
        if (bestMatch) {
            this.markAsMatched(bestMatch.memory, normalizedMood);
        }

        return {
            bestMatch: bestMatch ? bestMatch.memory : null,
            bestScore: bestMatch ? bestMatch.score : 0,
            allMatches: allMatches.map(m => ({ memory: m.memory, score: m.score })),
            moodAnalysis: this.analyzeMood(normalizedMood),
            targetTags: this.moodToTargetTags[normalizedMood] || [],
            avoidedTags: this.moodToAvoidTags[normalizedMood] || []
        };
    }

    /**
     * 計算單一記憶與當前情緒的匹配分數
     */
    calculateMatchScore(memory, targetMood) {
        const memTags = memory.emotional_tags || [];
        const targetTags = this.moodToTargetTags[targetMood] || [];
        const avoidTags = this.moodToAvoidTags[targetMood] || [];

        let score = 0;

        // 1. 正面標籤加成
        targetTags.forEach(tag => {
            if (memTags.includes(tag)) {
                score += 0.3;
            }
        });

        // 2. 負面標籤扣分
        avoidTags.forEach(tag => {
            if (memTags.includes(tag)) {
                score -= 0.4;
            }
        });

        // 3. ERS 分數加成（情感濃度高的優先）
        if (memory.emotional_resonance_score) {
            score += memory.emotional_resonance_score * 0.2;
        }

        // 4. 時間衰減：新記憶比舊記憶更有價值
        const memoryAge = this.calculateMemoryAge(memory.created_at);
        if (memoryAge < 30) {
            score += 0.15; // 一個月內的記憶加分
        } else if (memoryAge > 365) {
            score -= 0.1; // 一年前的記憶略降
        }

        // 5. 正向成果加成（success, achievement, praise）
        if (memTags.includes('success') || memTags.includes('achievement')) {
            score += 0.2;
        }

        // 6. 被 Bryan 直接稱讚過的記憶加分
        if (memTags.includes('praise') || memTags.includes('grateful')) {
            score += 0.15;
        }

        return Math.max(0, Math.min(1, score)); // 夾緊到 0-1
    }

    /**
     * 標準化情緒關鍵詞
     */
    normalizeMood(mood) {
        if (!mood) return 'neutral';

        const lowerMood = mood.toLowerCase();
        const lowerMoodZh = mood;

        for (const [moodKey, keywords] of Object.entries(this.moodKeywords)) {
            for (const kw of keywords) {
                if (lowerMood.includes(kw) || lowerMoodZh.includes(kw)) {
                    return moodKey;
                }
            }
        }

        return 'neutral';
    }

    /**
     * 從 State Snapshot 提取 Bryan 的情緒
     */
    extractMoodFromState(stateSnapshot) {
        if (!stateSnapshot) return 'neutral';

        // 尝试從 State Snapshot 提取情緒
        const emotionalState = stateSnapshot.bryansEmotionalState || 
                               stateSnapshot.emotional_state ||
                               stateSnapshot.mood;

        if (!emotionalState) return 'neutral';

        // 如果是數值型（如 1-10），轉換為分類
        if (typeof emotionalState === 'number') {
            if (emotionalState <= 2) return 'down';
            if (emotionalState <= 4) return 'tired';
            if (emotionalState <= 6) return 'neutral';
            if (emotionalState <= 8) return 'happy';
            return 'excited';
        }

        return this.normalizeMood(String(emotionalState));
    }

    /**
     * 分析情緒狀態
     */
    analyzeMood(mood) {
        const descriptions = {
            down: 'Bryan 似乎情緒有點低落，這時候他需要被肯定和鼓勵。',
            tired: 'Bryan 看起來有點累，適合輕鬆的話題或讓他休息。',
            stressed: 'Bryan 壓力有點大，需要支持和實用的建議。',
            angry: 'Bryan 生氣了，要小心處理，避免更多刺激。',
            happy: 'Bryan 心情不錯！這是分享好消息的好時機。',
            neutral: 'Bryan 情緒平穩，可以正常交流。'
        };

        return {
            mood,
            description: descriptions[mood] || 'Bryan 情緒穩定。',
            shouldReminisce: mood === 'down' || mood === 'tired' || mood === 'stressed',
            reminisceType: mood === 'down' ? 'warm_encourage' : 
                          mood === 'tired' ? 'relaxing_comfort' :
                          mood === 'stressed' ? 'calm_support' : 'neutral_recall'
        };
    }

    /**
     * 檢查記憶是否在冷卻中
     */
    isOnCooldown(memory) {
        const memoryId = memory.id || memory.content?.substring(0, 50);
        const found = this.recentlyMatched.find(m => m.memoryId === memoryId);
        
        if (!found) return false;

        const elapsed = Date.now() - found.matchedAt;
        return elapsed < this.cooldownMs;
    }

    /**
     * 標記為已匹配
     */
    markAsMatched(memory, mood) {
        const memoryId = memory.id || memory.content?.substring(0, 50);
        
        // 移除舊記錄
        this.recentlyMatched = this.recentlyMatched.filter(
            m => Date.now() - m.matchedAt < this.cooldownMs
        );

        this.recentlyMatched.push({
            memoryId,
            matchedAt: Date.now(),
            mood
        });
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
     * 載入 QMD 檔案並提取情感標籤
     */
    loadQMDFiles(qmdDir) {
        const memories = [];

        if (!fs.existsSync(qmdDir)) {
            console.warn(`QMD 目錄不存在：${qmdDir}`);
            return memories;
        }

        const files = fs.readdirSync(qmdDir).filter(f => f.endsWith('.md'));

        files.forEach(file => {
            const filePath = path.join(qmdDir, file);
            const content = fs.readFileSync(filePath, 'utf8');

            // 嘗試解析 frontmatter 或標題
            const emotionalTags = this.extractTagsFromContent(content);
            const ersMatch = content.match(/ERS[:\s]+([\d.]+)/i);
            const ers = ersMatch ? parseFloat(ersMatch[1]) : 0.5;

            memories.push({
                id: file,
                content: content.substring(0, 200), // 預覽
                fullContent: content,
                emotional_tags: emotionalTags,
                emotional_resonance_score: ers,
                created_at: this.extractDateFromContent(content) || new Date().toISOString(),
                source: 'qmd'
            });
        });

        return memories;
    }

    /**
     * 從內容中提取標籤
     */
    extractTagsFromContent(content) {
        const tags = [];
        
        // 嘗試找標籤行
        const tagLineMatch = content.match(/Tags?[:\s]+([^\n]+)/i);
        if (tagLineMatch) {
            const tagStr = tagLineMatch[1];
            const foundTags = tagStr.split(/[,，、]/).map(t => t.trim().toLowerCase());
            tags.push(...foundTags.filter(t => t.length > 0 && t.length < 30));
        }

        // 嘗試找關鍵情緒詞
        const emotionWords = {
            warm: ['溫暖', '貼心', '關心', '體貼'],
            success: ['成功', '達成', '完成', '順利'],
            achievement: ['成就', '成就解鎖', '厲害', '讚'],
            tired: ['累', '疲憊', '辛苦'],
            stressed: ['壓力', '焦慮', '緊張'],
            happy: ['開心', '快樂', '高興', '棒'],
            playful: ['有趣', '好玩', '好笑']
        };

        for (const [tag, keywords] of Object.entries(emotionWords)) {
            if (keywords.some(kw => content.includes(kw))) {
                if (!tags.includes(tag)) tags.push(tag);
            }
        }

        return tags;
    }

    /**
     * 從內容提取日期
     */
    extractDateFromContent(content) {
        // 找 YYYY-MM-DD 格式
        const dateMatch = content.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
            return new Date(dateMatch[1]).toISOString();
        }
        return null;
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
    } else if (args.includes('--match') || args.includes('-m')) {
        const mood = args[1] || 'down';
        const qmdDir = args[2] || './qmd';
        runMatch(mood, qmdDir);
    } else {
        // 互動模式
        const mood = args[0];
        if (!mood) {
            console.error('請提供情緒關鍵詞');
            printHelp();
            process.exit(1);
        }
        runMatch(mood, './qmd');
    }
}

function runTests() {
    console.log('🧪 運行 Emotional Matcher 測試...\n');

    const matcher = new EmotionalMatcher();

    // 測試案例
    const testMemories = [
        {
            id: 'mem1',
            content: 'Bryan成功談下了那筆重要的訂單',
            emotional_tags: ['success', 'achievement'],
            emotional_resonance_score: 0.92,
            created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 'mem2',
            content: 'Bryan 抱怨工作壓力太大',
            emotional_tags: ['stressed', 'tired'],
            emotional_resonance_score: 0.7,
            created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 'mem3',
            content: '我們一起看了一部有趣的電影，笑得很開心',
            emotional_tags: ['happy', 'playful', 'casual'],
            emotional_resonance_score: 0.85,
            created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 'mem4',
            content: 'Bryan 感謝我幫他記得重要的事情',
            emotional_tags: ['grateful', 'warm', 'praise'],
            emotional_resonance_score: 0.88,
            created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 'mem5',
            content: '討論了一個複雜的技術問題',
            emotional_tags: ['technical', 'complex'],
            emotional_resonance_score: 0.5,
            created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
        }
    ];

    const testMoods = ['down', 'tired', 'stressed', 'happy'];

    testMoods.forEach(mood => {
        console.log(`\n測試情緒：${mood}`);
        console.log('---');

        const result = matcher.match(mood, testMemories);
        
        console.log(` moodAnalysis: ${result.moodAnalysis.description}`);
        console.log(` 應該回味：${result.moodAnalysis.shouldReminisce}`);
        console.log(` 最佳匹配：${result.bestMatch?.id} (分數：${result.bestScore.toFixed(2)})`);
        
        if (result.bestMatch) {
            console.log(` 記憶內容：${result.bestMatch.content}`);
            console.log(` 標籤：${result.bestMatch.emotional_tags.join(', ')}`);
        }
    });

    // 測試冷卻機制
    console.log('\n\n測試冷卻機制：');
    matcher.markAsMatched(testMemories[0], 'down');
    console.log(` 第一次匹配 mem1`);
    console.log(` isOnCooldown: ${matcher.isOnCooldown(testMemories[0])}`);
    console.log(` 立即再匹配: ${matcher.isOnCooldown(testMemories[0])}`);
    
    console.log('\n✅ 測試完成');
}

function runMatch(mood, qmdDir) {
    const matcher = new EmotionalMatcher();

    console.log(`\n🔍 情緒匹配分析：${mood}`);
    console.log('='.repeat(50));

    // 嘗試載入 QMD
    console.log(`\n📂 載入 QMD 檔案：${qmdDir}`);
    const memories = matcher.loadQMDFiles(qmdDir);
    console.log(`   找到 ${memories.length} 個 QMD 檔案`);

    if (memories.length === 0) {
        console.log('\n⚠️ 沒有找到 QMD 檔案，使用測試資料進行演示');
        // 使用測試資料
        const testMemories = [
            {
                id: 'mem1',
                content: 'Bryan成功談下了那筆重要的訂單，客戶非常滿意',
                emotional_tags: ['success', 'achievement', 'praise'],
                emotional_resonance_score: 0.92,
                created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
            },
            {
                id: 'mem2',
                content: 'Bryan 說這段時間壓力很大，但還是撐過來了',
                emotional_tags: ['stressed', 'success'],
                emotional_resonance_score: 0.8,
                created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
            }
        ];
        memories.push(...testMemories);
    }

    const result = matcher.match(mood, memories, { maxResults: 3 });

    console.log(`\n📊 情緒分析：`);
    console.log(`   ${result.moodAnalysis.description}`);
    console.log(`   建議回味類型：${result.moodAnalysis.reminisceType}`);

    if (result.bestMatch) {
        console.log(`\n✅ 最佳匹配記憶：`);
        console.log(`   ID：${result.bestMatch.id}`);
        console.log(`   內容：${result.bestMatch.content}`);
        console.log(`   標籤：${result.bestMatch.emotional_tags.join(', ')}`);
        console.log(`   ERS：${result.bestMatch.emotional_resonance_score}`);
        console.log(`   匹配分數：${result.bestScore.toFixed(2)}`);
    }

    console.log(`\n📋 所有匹配（分數 >= 0.3）：`);
    result.allMatches.forEach((m, i) => {
        console.log(`   ${i + 1}. [${m.score.toFixed(2)}] ${m.memory.id}`);
    });

    console.log('');
}

function printHelp() {
    console.log(`
emotional_matcher.js - 情緒匹配引擎

用法：
    node emotional_matcher.js <情緒關鍵詞> [qmd目錄]
    node emotional_matcher.js --test        運行測試
    node emotional_matcher.js --help        顯示說明

情緒關鍵詞範例：
    down, tired, stressed, angry, happy, neutral

範例：
    node emotional_matcher.js down           # Bryan 情緒低落
    node emotional_matcher.js tired ./qmd    # Bryan 累了，從 ./qmd 載入記憶

輸出：
    最佳匹配記憶 + 分數 + 情緒分析
`);
}

module.exports = { EmotionalMatcher };

if (require.main === module) {
    main();
}
