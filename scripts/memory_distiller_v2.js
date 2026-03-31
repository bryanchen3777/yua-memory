/**
 * Active Memory Distiller (Soul Evolution 2.3)
 * 
 * 自動從 LCM 掃描並建議更新 QMD
 * 觸發時機：每 20 輪對話 / Session 結束 / cron job
 * 
 * 使用方式:
 *   node memory_distiller.js [--hours 24] [--dry-run]
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LCM_DB = 'C:\\Users\\bbfcc\\.openclaw\\lcm.db';
const QMD_BASE = 'C:\\Users\\bbfcc\\.openclaw\\workspace\\qmd';

// 命令列參數
const args = process.argv.slice(2);
const hours = parseInt(args.find(a => a.startsWith('--hours='))?.split('=')[1] || '24');
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const applyMode = args.includes('--apply');

console.log(`=== Active Memory Distiller ===`);
console.log(`Scanning last ${hours} hours, ${dryRun ? 'DRY RUN' : applyMode ? 'APPLY MODE' : 'REVIEW MODE'}\n`);

// ========== 隱私檢查（內聯，避免循環依賴）==========
const SENSITIVE_PATTERNS = [
  /api[_-]?key["\s:=]+[\w-]{16,}/gi,
  /secret["\s:=]+[\w-]{16,}/gi,
  /password["\s:=]+\S{8,}/gi,
  /sk-[a-zA-Z0-9]{20,}/gi,
  /ghp_[a-zA-Z0-9]{20,}/gi,
  /\b[A-Z]\d{9}\b/g,
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g
];

function hasSensitiveContent(text) {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) return true;
    pattern.lastIndex = 0;
  }
  return false;
}

function privacyCheckDraft(draft) {
  if (hasSensitiveContent(draft.content) || hasSensitiveContent(draft.reason)) {
    if (verbose) console.log(`  [PRIVACY] Skipped due to sensitive content: ${draft.filename}`);
    return false;
  }
  return true;
}

// Pattern definitions for detecting valuable memories
const PATTERNS = {
  preference: {
    keywords: ['我喜歡', '我要', '我想要', 'prefer', 'like', 'want', 'I\'d rather', '傾向'],
    weight: 1.5,
    category: 'rules',
    scope: 'Shared'
  },
  decision: {
    keywords: ['決定了', '採用', '就用', 'decided', 'we will', 'let\'s go', '確定', 'confirmed'],
    weight: 2.0,
    category: 'technical',
    scope: 'Shared'
  },
  change: {
    keywords: ['改成', '改為', '更換', 'change to', 'switch to', 'migrate', 'transition to'],
    weight: 1.8,
    category: 'technical',
    scope: 'Shared'
  },
  rule: {
    keywords: ['規定', '不准', '必須', 'must not', 'should always', 'need to', 'have to', '要記得'],
    weight: 1.6,
    category: 'rules',
    scope: 'Shared'
  },
  learning: {
    keywords: ['學到', '發現', 'learned', 'figured out', 'realized', '注意到', 'found that'],
    weight: 1.4,
    category: 'technical',
    scope: 'Shared'
  },
  project: {
    keywords: ['專案', 'project', '我們的', 'our', '這個功能', 'this feature', '建置', 'build'],
    weight: 1.3,
    category: 'protocols',
    scope: 'Shared'
  }
};

// 連接資料庫
let db;
try {
  db = new DatabaseSync(LCM_DB);
} catch (e) {
  console.error('Failed to connect to LCM database:', e.message);
  process.exit(1);
}

// Step 1: 取得最近對話
function getRecentConversations(hours) {
  const convos = db.prepare(`
    SELECT c.conversation_id, c.session_key, c.title, c.created_at,
           COUNT(m.message_id) as msg_count
    FROM conversations c
    LEFT JOIN messages m ON c.conversation_id = m.conversation_id
    WHERE c.created_at >= datetime('now', '-${hours} hours')
    GROUP BY c.conversation_id
    ORDER BY c.created_at DESC
  `).all();
  return convos;
}

// Step 2: 取得最近訊息
function getRecentMessages(hours, limit = 500) {
  const messages = db.prepare(`
    SELECT m.message_id, m.conversation_id, m.role, m.content, m.created_at,
           c.session_key
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.conversation_id
    WHERE m.created_at >= datetime('now', '-${hours} hours')
      AND m.content IS NOT NULL
      AND LENGTH(m.content) BETWEEN 10 AND 2000
    ORDER BY m.created_at DESC
    LIMIT ${limit}
  `).all();
  return messages;
}

// Step 3: Pattern matching
function analyzeMessage(msg) {
  const content = msg.content || '';
  const findings = [];
  
  for (const [type, config] of Object.entries(PATTERNS)) {
    for (const kw of config.keywords) {
      if (content.includes(kw)) {
        // 取得包含關鍵詞的前後文
        const idx = content.indexOf(kw);
        const start = Math.max(0, idx - 30);
        const end = Math.min(content.length, idx + kw.length + 50);
        const snippet = content.substring(start, end).replace(/\n/g, ' ').trim();
        
        findings.push({
          type,
          keyword: kw,
          snippet,
          weight: config.weight,
          category: config.category,
          scope: config.scope,
          msg_id: msg.message_id,
          session: msg.session_key,
          time: msg.created_at
        });
        break; // 每種type只取第一個match
      }
    }
  }
  
  return findings;
}

// Step 4: 排序並去除重複
function deduplicateAndRank(findings) {
  // 按 weight 排序
  findings.sort((a, b) => b.weight - a.weight);
  
  // 去除太相似的（同一 session 同一 type 取第一個）
  const seen = new Set();
  const unique = [];
  
  for (const f of findings) {
    const key = `${f.session}:${f.type}:${f.keyword}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(f);
    }
  }
  
  return unique;
}

// Step 5: 生成 QMD 草稿
function generateQMDDraft(findings) {
  const drafts = [];
  
  for (const f of findings.slice(0, 10)) { // 最多10個建議
    const timestamp = new Date().toISOString().split('T')[0];
    const draft = {
      filename: `${f.category}/${timestamp}-auto-${f.type}.md`,
      scope: f.scope,
      type: f.type,
      keyword: f.keyword,  // 修復：加入 keyword 屬性
      category: f.category, // 修復：加入 category 屬性
      content: `# [${f.type}] Auto-detected from conversation\n\n`
        + `## Date\n${timestamp}\n\n`
        + `## Source\n`
        + `- Session: ${f.session}\n`
        + `- Detected at: ${f.time}\n`
        + `- Keyword: "${f.keyword}"\n\n`
        + `## Content\n`
        + `\`\`\`\n${f.snippet}\n\`\`\`\n\n`
        + `## Suggestion\n`
        + `This was detected from recent conversation. `
        + `Please review and decide if this should be added to QMD.\n\n`
        + `## Suggested Category\n${f.category}\n\n`
        + `## Suggested Scope\n${f.scope}\n`,
      reason: f.snippet
    };
    
    // 隱私檢查（--apply 模式時強制執行）
    if (applyMode && !privacyCheckDraft(draft)) {
      if (verbose) console.log(`  [SKIP] ${draft.filename} - privacy check failed`);
      continue;
    }
    
    drafts.push(draft);
  }
  
  return drafts;
}

// Step 6: 檢查現有 QMD 避免重複
function checkExistingQMD(drafts) {
  const filtered = [];
  
  for (const draft of drafts) {
    const filepath = join(QMD_BASE, draft.filename);
    
    // 檢查檔案是否存在
    if (existsSync(filepath)) {
      if (verbose) console.log(`  [SKIP] ${draft.filename} already exists`);
      continue;
    }
    
    // 簡單檢查是否有重複關鍵詞
    let isDuplicate = false;
    try {
      const existingContent = readFileSync(filepath, 'utf-8');
      for (const kw of Object.values(PATTERNS)) {
        for (const k of kw.keywords) {
          if (existingContent.includes(k)) {
            isDuplicate = true;
            break;
          }
        }
      }
    } catch (e) {
      // 檔案不存在，所以不重複
    }
    
    if (!isDuplicate) {
      filtered.push(draft);
    }
  }
  
  return filtered;
}

// Step 7: 輸出建議
function outputSuggestions(drafts) {
  if (drafts.length === 0) {
    console.log('\n✅ No new memory suggestions (all recent findings already in QMD or no patterns detected)');
    return;
  }
  
  console.log(`\n📝 Found ${drafts.length} potential memory updates:\n`);
  
  drafts.forEach((d, i) => {
    console.log(`${i + 1}. [${d.type}] ${d.filename}`);
    console.log(`   Keyword: "${d.keyword}"`);
    console.log(`   Snippet: "${d.reason.substring(0, 80)}..."`);
    console.log(`   Scope: ${d.scope}, Category: ${d.category}\n`);
  });
  
  console.log('---\n');
  console.log('To apply these suggestions, run:');
  console.log('  node memory_distiller.js --apply');
  console.log('\nOr review each file and create manually.');
}

// Step 8: 寫入 QMD（如果 --apply）
function applySuggestions(drafts) {
  if (dryRun) {
    console.log('[DRY RUN] Would create:');
    drafts.forEach(d => console.log(`  - ${d.filename}`));
    return;
  }
  
  for (const draft of drafts) {
    const filepath = join(QMD_BASE, draft.filename);
    try {
      writeFileSync(filepath, draft.content);
      console.log(`✅ Created: ${draft.filename}`);
    } catch (e) {
      console.error(`❌ Failed to create ${draft.filename}: ${e.message}`);
    }
  }
}

// 主流程
console.log('1. Fetching recent conversations...');
const convos = getRecentConversations(hours);
console.log(`   Found ${convos.length} conversations`);

console.log('\n2. Fetching recent messages...');
const messages = getRecentMessages(hours);
console.log(`   Found ${messages.length} messages`);

console.log('\n3. Analyzing patterns...');
const allFindings = [];
for (const msg of messages) {
  const findings = analyzeMessage(msg);
  allFindings.push(...findings);
}
console.log(`   Found ${allFindings.length} potential memory points`);

console.log('\n4. Deduplicating and ranking...');
const ranked = deduplicateAndRank(allFindings);
console.log(`   Reduced to ${ranked.length} unique suggestions`);

console.log('\n5. Generating QMD drafts...');
const drafts = generateQMDDraft(ranked);
console.log(`   Generated ${drafts.length} draft files`);

console.log('\n6. Checking existing QMD...');
const newDrafts = checkExistingQMD(drafts);
console.log(`   ${newDrafts.length} are new suggestions`);

console.log('\n7. Output...');
outputSuggestions(newDrafts);

// 如果有 --apply 參數，實際寫入
if (args.includes('--apply')) {
  console.log('\n8. Applying suggestions...');
  applySuggestions(newDrafts);
}

// 完成
db.close();
console.log('\n=== Distiller Complete ===');
