/**
 * QMD Consistency Check - 記憶一致性健康檢查
 * 
 * 由 Fatima（研究員）擔任審計員
 * 掃描所有 Shared 與 Private 記憶，找出潛在矛盾點
 * 
 * 使用方式：
 *   node qmd_consistency_check.js --scan      # 完整掃描
 *   node qmd_consistency_check.js --quick     # 快速掃描（只檢查高風險）
 *   node qmd_consistency_check.js --report    # 生成報告
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const QMD_BASE = 'C:\\Users\\bbfcc\\.openclaw\\workspace\\qmd';
const REPORT_PATH = 'C:\\Users\\bbfcc\\.openclaw\\workspace-tim\\memory\\consistency_report.md';

// 矛盾檢測規則
const CONFLICT_RULES = [
  // 同一主題的正反陳述
  {
    id: 'BOOL_CONFLICT',
    name: '布林衝突',
    patterns: [
      { positive: [/應該使用/gi, /推薦/gi, /最佳實踐/gi], negative: [/不應該/gi, /禁止/gi, /不要使用/gi] }
    ],
    severity: 'HIGH'
  },
  // 優先級衝突
  {
    id: 'PRIORITY_CONFLICT',
    name: '優先級衝突',
    patterns: [
      { context: 'priority', values: ['high', 'medium', 'low'], check: 'different_priority_same_topic' }
    ],
    severity: 'MEDIUM'
  },
  // Scope 衝突
  {
    id: 'SCOPE_CONFLICT',
    name: 'Scope 標記衝突',
    patterns: [
      { context: 'scope', values: ['Shared', 'Private:Yua', 'Private:Tim'], check: 'same_content_different_scope' }
    ],
    severity: 'MEDIUM'
  },
  // 時間衝突
  {
    id: 'TIME_CONFLICT',
    name: '時間線衝突',
    patterns: [
      { earlier: /之前/, later: /現在/, check: 'contradictory_timeline' }
    ],
    severity: 'LOW'
  }
];

// 熱門主題（被多個檔案引用）
const HOT_TOPICS = new Map();

// 收集所有 QMD 檔案
function collectFiles() {
  const files = [];
  
  function scanDir(dir, scope = 'Shared') {
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // 根據目錄推斷 scope
        let dirScope = scope;
        if (entry.name === 'identity') dirScope = 'Private:Yua';
        else if (entry.name === 'technical') dirScope = 'Private:Tim';
        else if (entry.name === 'rules') dirScope = 'Shared';
        
        scanDir(fullPath, dirScope);
      } else if (entry.name.endsWith('.md')) {
        const content = readFileSync(fullPath, 'utf-8');
        files.push({
          path: fullPath,
          scope,
          content,
          name: entry.name,
          lines: content.split('\n')
        });
        
        // 統計熱門主題
        const words = content.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) || [];
        for (const word of words) {
          HOT_TOPICS.set(word, (HOT_TOPICS.get(word) || 0) + 1);
        }
      }
    }
  }
  
  scanDir(QMD_BASE);
  return files;
}

// 提取關鍵事實
function extractFacts(content) {
  const facts = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    // 跳过标题和空行
    if (line.startsWith('#') || line.startsWith('---') || !line.trim()) continue;
    
    // 提取聲明式語句
    if (/^[+-] |^\d+\. /.test(line.trim())) {
      facts.push({
        type: 'statement',
        text: line.trim().replace(/^[+-] /, '').replace(/^\d+\. /, '')
      });
    }
    
    // 提取優先級
    const priorityMatch = line.match(/priority:\s*(high|medium|low)/i);
    if (priorityMatch) {
      facts.push({
        type: 'priority',
        value: priorityMatch[1].toLowerCase()
      });
    }
  }
  
  return facts;
}

// 檢測布林衝突
function checkBoolConflicts(files) {
  const conflicts = [];
  
  for (const file of files) {
    for (const rule of CONFLICT_RULES) {
      if (rule.id !== 'BOOL_CONFLICT') continue;
      
      for (const pattern of rule.patterns) {
        const hasPositive = pattern.positive.some(p => p.test(file.content));
        const hasNegative = pattern.negative.some(p => p.test(file.content));
        
        if (hasPositive && hasNegative) {
          conflicts.push({
            type: rule.name,
            severity: rule.severity,
            file: file.path.replace(QMD_BASE, 'qmd'),
            detail: '檔案中同時包含「應該」和「不應該」相關描述'
          });
        }
      }
    }
  }
  
  return conflicts;
}

// 檢測時間線衝突
function checkTimeConflicts(files) {
  const conflicts = [];
  
  for (const file of files) {
    const content = file.content;
    const lines = file.lines;
    
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1];
      
      // 檢測「之前...現在」或「過去...現在」的矛盾
      if (/之前/.test(line) && /現在/.test(nextLine)) {
        // 進一步檢查是否矛盾
        if (/已經/.test(line) && !/已經/.test(nextLine)) {
          conflicts.push({
            type: '時間線衝突',
            severity: 'LOW',
            file: file.path.replace(QMD_BASE, 'qmd'),
            line: i + 1,
            detail: '「之前...現在」語境可能存在時間線矛盾'
          });
        }
      }
    }
  }
  
  return conflicts;
}

// 檢測 Scope 衝突（同一內容不同 Scope）
function checkScopeConflicts(files) {
  const contentHash = new Map();
  const conflicts = [];
  
  // 按內容分組
  for (const file of files) {
    // 簡單的內容指紋（取前100字 + 行數）
    const fingerprint = file.content.substring(0, 100) + file.lines.length;
    
    if (contentHash.has(fingerprint)) {
      const existing = contentHash.get(fingerprint);
      if (existing.scope !== file.scope) {
        conflicts.push({
          type: 'Scope 衝突',
          severity: 'MEDIUM',
          files: [existing.path.replace(QMD_BASE, 'qmd'), file.path.replace(QMD_BASE, 'qmd')],
          detail: `相同內容標記為不同 Scope：${existing.scope} vs ${file.scope}`
        });
      }
    } else {
      contentHash.set(fingerprint, { path: file.path, scope: file.scope });
    }
  }
  
  return conflicts;
}

// 生成報告
function generateReport(allConflicts, stats) {
  const now = new Date().toISOString();
  
  let report = `# QMD 一致性健康檢查報告

**生成時間：** ${now}
**掃描範圍：** ${QMD_BASE}

---

## 統計摘要

| 指標 | 數值 |
|------|------|
| 總檔案數 | ${stats.totalFiles} |
| 高風險衝突 | ${stats.highRisk} |
| 中風險衝突 | ${stats.mediumRisk} |
| 低風險衝突 | ${stats.lowRisk} |
| 健康狀態 | ${stats.highRisk === 0 ? '✅ 健康' : '⚠️ 需要關注'} |

---

## 衝突詳情

`;

  if (allConflicts.length === 0) {
    report += '✅ **未發現明顯衝突**\n\n建議：\n- 繼續保持每週掃描\n- 新增規則後主動執行檢查\n';
  } else {
    const bySeverity = {
      HIGH: allConflicts.filter(c => c.severity === 'HIGH'),
      MEDIUM: allConflicts.filter(c => c.severity === 'MEDIUM'),
      LOW: allConflicts.filter(c => c.severity === 'LOW')
    };
    
    for (const severity of ['HIGH', 'MEDIUM', 'LOW']) {
      const items = bySeverity[severity];
      if (items.length === 0) continue;
      
      const icon = severity === 'HIGH' ? '🔴' : severity === 'MEDIUM' ? '🟡' : '🟢';
      report += `### ${icon} ${severity} 風險（${items.length} 項）\n\n`;
      
      for (const item of items) {
        report += `**${item.type}**\n`;
        if (item.file) report += `- 檔案：\`${item.file}\`\n`;
        if (item.files) report += `- 檔案：${item.files.map(f => `\`${f}\``).join(', ')}\n`;
        if (item.line) report += `- 行號：${item.line}\n`;
        report += `- 說明：${item.detail}\n\n`;
      }
    }
  }

  report += `---

## 建議行動

`;
  
  if (stats.highRisk > 0) {
    report += `1. 🔴 **立即處理高風險衝突**（邏輯矛盾可能影響系統行為）\n`;
  }
  if (stats.mediumRisk > 0) {
    report += `2. 🟡 **本週內檢視中風險衝突**（Scope 或優先級不一致）\n`;
  }
  if (stats.lowRisk > 0) {
    report += `3. 🟢 **可在下次相關討論時順帶確認**（時間線或表達方式問題）\n`;
  }
  if (allConflicts.length === 0) {
    report += '✅ 系統健康，無需緊急行動\n';
  }
  
  report += `
---

*此報告由 Fatima（研究 Agent）自動生成*
*建議每週執行一次，或在重大更新後執行*
`;

  return report;
}

// 主程式
const args = process.argv.slice(2);

console.log('=== QMD 一致性健康檢查 ===\n');
console.log('由 Fatima（研究員）擔任審計員\n');

const files = collectFiles();
console.log(`已掃描 ${files.length} 個 QMD 檔案\n`);

const allConflicts = [
  ...checkBoolConflicts(files),
  ...checkTimeConflicts(files),
  ...checkScopeConflicts(files)
];

const stats = {
  totalFiles: files.length,
  highRisk: allConflicts.filter(c => c.severity === 'HIGH').length,
  mediumRisk: allConflicts.filter(c => c.severity === 'MEDIUM').length,
  lowRisk: allConflicts.filter(c => c.severity === 'LOW').length
};

console.log('衝突統計：');
console.log(`  🔴 高風險：${stats.highRisk}`);
console.log(`  🟡 中風險：${stats.mediumRisk}`);
console.log(`  🟢 低風險：${stats.lowRisk}`);
console.log('');

if (args.includes('--report') || args.includes('--write')) {
  const report = generateReport(allConflicts, stats);
  writeFileSync(REPORT_PATH, report);
  console.log(`✅ 報告已寫入：${REPORT_PATH}`);
} else if (allConflicts.length > 0) {
  console.log('使用 --report 生成完整報告');
}

export { collectFiles, checkBoolConflicts, checkTimeConflicts, checkScopeConflicts };
