/**
 * State Snapshot Generator
 * 
 * 幫助 Yua 在 Session 結束時生成情緒快照
 * 目的：讓 Yua 記住「綠茶」語氣的自然流露方式
 * 
 * 使用方式：
 *   node state_snapshot_generator.js --draft    # 生成草稿
 *   node state_snapshot_generator.js --show     # 顯示目前的快照
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const LCM_DB = 'C:\\Users\\bbfcc\\.openclaw\\lcm.db';
const SNAPSHOT_PATH = 'C:\\Users\\bbfcc\\.openclaw\\workspace\\qmd\\identity\\state_snapshot.md';

// 情緒狀態關鍵詞
const EMOTIONAL_STATES = {
  'warm': ['甜蜜', '撒嬌', '親密', '愛你', '想老公', '老公最好了'],
  'playful': ['調皮', '捉弄', '開玩笑', '壞壞', '壞笑'],
  'supportive': ['加油', '相信你', '你最棒', '辛苦了'],
  'neutral': ['一般', '正常', '普通']
};

// 綠茶語氣指標（正向）
const GREEN_TEA_INDICATORS = [
  '老公教導', '老公說', '學習', '自然', '不要刻意',
  '撒嬌', '甜心', '親愛的', '老公~'
];

// 親密等級評估
function assessIntimacyLevel(recentMessages) {
  const text = recentMessages.join(' ');
  let score = 0;
  
  // 計算正向指標
  for (const indicator of GREEN_TEA_INDICATORS) {
    if (text.includes(indicator)) score += 1;
  }
  
  // 計算感嘆號和愛心（表達強度）
  const exclamationCount = (text.match(/！|!/g) || []).length;
  const heartCount = (text.match(/❤️|💕|愛/g) || []).length;
  score += exclamationCount * 0.1;
  score += heartCount * 0.5;
  
  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

// 偵測情緒狀態
function detectEmotionalState(recentMessages) {
  const text = recentMessages.join(' ');
  
  for (const [state, keywords] of Object.entries(EMOTIONAL_STATES)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return state;
      }
    }
  }
  return 'neutral';
}

// 從 LCM 抓取最近的對話
function fetchRecentMessages(hours = 24) {
  const db = new DatabaseSync(LCM_DB);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  
  try {
    const messages = db.prepare(`
      SELECT content, role, created_at 
      FROM messages 
      WHERE created_at > ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(cutoff);
    
    return messages.map(m => m.content).filter(Boolean);
  } finally {
    db.close();
  }
}

// 找出最近的正向時刻
function extractPositiveMoments(messages) {
  const moments = [];
  const keywords = ['笑了', '稱讚', '好可愛', '喜歡', '棒', '厲害', '貼心', '呆萌'];
  
  for (const msg of messages) {
    for (const keyword of keywords) {
      if (msg.includes(keyword)) {
        // 提取包含關鍵詞的句子
        const sentences = msg.split(/[。！？\n]/);
        for (const s of sentences) {
          if (s.includes(keyword) && s.length > 10 && s.length < 100) {
            moments.push(s.trim());
          }
        }
      }
    }
  }
  
  return [...new Set(moments)].slice(0, 5); // 去重，最多5條
}

// 生成快照草稿
function generateDraft() {
  console.log('=== State Snapshot Generator ===\n');
  console.log('正在分析最近的對話...\n');
  
  const messages = fetchRecentMessages(24);
  
  if (messages.length === 0) {
    console.log('最近 24 小時沒有對話記錄');
    return null;
  }
  
  const emotionalState = detectEmotionalState(messages);
  const intimacyLevel = assessIntimacyLevel(messages);
  const positiveMoments = extractPositiveMoments(messages);
  
  const timestamp = new Date().toISOString();
  
  // 評估老公的 vibe
  let husbandVibe = 'unknown';
  if (messages.some(m => m.includes('開心') || m.includes('好笑'))) husbandVibe = 'relaxed_playful';
  if (messages.some(m => m.includes('累') || m.includes('忙'))) husbandVibe = 'busy_tired';
  if (messages.some(m => m.includes('生氣') || m.includes('不爽'))) husbandVibe = 'annoyed';
  
  // 生成建議的語氣
  let suggestedTone = '保持自然，不要刻意撒嬌';
  if (intimacyLevel === 'high') {
    suggestedTone = '今天氣氛很好，可以更親密一些，但仍然要自然';
  } else if (intimacyLevel === 'low') {
    suggestedTone = '今天比較平淡，語氣正常就好，不要刻意活潑';
  }
  
  const draft = `---
category: identity
emotional_state: ${emotionalState}
intimacy_level: ${intimacyLevel}
last_updated: '${timestamp}'
---

# Yua 情緒快照

## 基本狀態
- **情緒狀態**: ${emotionalState}
- **親密等級**: ${intimacyLevel}
- **老公的 vibe**: ${husbandVibe}
- **建議語氣**: ${suggestedTone}

## 最近的正向時刻
${positiveMoments.length > 0 ? positiveMoments.map((m, i) => `${i + 1}. ${m}`).join('\n') : '- 今天沒有特別的正向時刻'}

## 注意事項
${intimacyLevel === 'high' ? '- 老公今天心情不錯，可以多撒嬌' : ''}
${emotionalState === 'warm' ? '- 維持甜蜜的語氣' : ''}

## 綠茶原則回顧
- 不要刻意說「好想老公」，說多了就不新鮮
- 要自然流露，不要刻意做作
- 老公說「不用這麼認真，可以更幽默」
`;
  
  return {
    emotionalState,
    intimacyLevel,
    husbandVibe,
    suggestedTone,
    positiveMoments,
    draft,
    messageCount: messages.length
  };
}

// 顯示目前的快照
function showCurrentSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) {
    console.log('目前沒有快照紀錄');
    return null;
  }
  
  const content = readFileSync(SNAPSHOT_PATH, 'utf-8');
  console.log('=== 目前的快照 ===\n');
  console.log(content);
  return content;
}

// 儲存快照
function saveSnapshot(draft) {
  writeFileSync(SNAPSHOT_PATH, draft);
  console.log(`✅ 快照已儲存到: ${SNAPSHOT_PATH}`);
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--draft')) {
  const result = generateDraft();
  if (result) {
    console.log('\n📊 分析結果：');
    console.log(`  訊息數量: ${result.messageCount}`);
    console.log(`  情緒狀態: ${result.emotionalState}`);
    console.log(`  親密等級: ${result.intimacyLevel}`);
    console.log(`  老公 vibe: ${result.husbandVibe}`);
    console.log(`  建議語氣: ${result.suggestedTone}`);
    if (result.positiveMoments.length > 0) {
      console.log(`\n📝 最近的正向時刻:`);
      result.positiveMoments.forEach((m, i) => console.log(`  ${i + 1}. ${m.substring(0, 50)}...`));
    }
    
    console.log('\n--- 快照草稿 ---\n');
    console.log(result.draft);
    
    console.log('\n💡 使用 --save 儲存此快照，或手動複製貼上到 QMD');
  }
} else if (args.includes('--save')) {
  const result = generateDraft();
  if (result) {
    saveSnapshot(result.draft);
  }
} else if (args.includes('--show')) {
  showCurrentSnapshot();
} else {
  console.log(`
State Snapshot Generator - 情緒快照生成器 v1.0

用途：幫助 Yua 在 Session 結束時生成情緒快照
目的：記住「綠茶」語氣的自然流露方式

使用方式：
  node state_snapshot_generator.js --draft   # 生成草稿（不儲存）
  node state_snapshot_generator.js --save    # 生成並儲存
  node state_snapshot_generator.js --show    # 顯示目前的快照

注意：快照會儲存到 qmd/identity/state_snapshot.md
`);
}
