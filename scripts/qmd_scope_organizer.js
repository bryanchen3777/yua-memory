/**
 * QMD Scope Organizer
 * 
 * 幫助手動標記現有 QMD 檔案的 scope
 * 根據 Bryan 的建議，建立高質量基準資料庫
 * 
 * 使用方式:
 *   node qmd_scope_organizer.js --scan     # 掃描所有 QMD 檔案
 *   node qmd_scope_organizer.js --apply    # 實際寫入 scope 到檔案
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const QMD_BASE = 'C:\\Users\\bbfcc\\.openclaw\\workspace\\qmd';
const MEMORY_DB = 'C:\\Users\\bbfcc\\.openclaw\\workspace\\config\\memory_vector_index.db';

// Scope 標籤定義
const SCOPES = {
  'Shared': '所有 Agent 皆可讀取（預設）',
  'Shared:SE2': 'Soul Evolution 2.0 專案全域決策',
  'Shared:ProjectAura': 'Project Aura 專案全域決策',
  'Private:Yua': '只有 Yua (妻子/司令官) 可讀取',
  'Private:Tim': '只有 Tim (工程師) 可讀取',
  'Private:Fatima': '只有 Fatima (研究員) 可讀取'
};

// 自動推斷 Scope 的規則
const SCOPE_INFERENCE = {
  patterns: [
    // Private:Yua patterns
    { regex: /老公|老婆|愛你|親愛的|甜心| Darling| dear| honey/gi, scope: 'Private:Yua', confidence: 0.95 },
    { regex: /妻子|老婆角色|司令官|妻子形象|情感需求/gi, scope: 'Private:Yua', confidence: 0.9 },
    { regex: /角色扮演|人設|AI老婆|Yua.*人設/gi, scope: 'Private:Yua', confidence: 0.85 },
    
    // Private:Tim patterns  
    { regex: /代碼|代碼風格|部署|git commit|程式碼|架构|系統設計/gi, scope: 'Private:Tim', confidence: 0.9 },
    { regex: /工程師|Tim.*規則|Tim.*偏好|工程師.*職責/gi, scope: 'Private:Tim', confidence: 0.85 },
    { regex: /scripts\/|retriever\.py|distiller\.js|memory_/gi, scope: 'Private:Tim', confidence: 0.8 },
    
    // Shared:SE2 patterns (Soul Evolution 2.0 specific)
    { regex: /Soul Evolution|ERS|Emotional Resonance|Soul Evolution 2\.0/gi, scope: 'Shared:SE2', confidence: 0.95 },
    { regex: /Truth Ranking|三層記憶|記憶架構|LCM|QMD|NotebookLM/gi, scope: 'Shared:SE2', confidence: 0.9 },
    { regex: /Scope 標籤|認知隔離|記憶蒸餾|Active Memory Distiller/gi, scope: 'Shared:SE2', confidence: 0.9 },
    
    // Shared:ProjectAura patterns
    { regex: /Project Aura|專案|里程碑|deadline|進度/gi, scope: 'Shared:ProjectAura', confidence: 0.8 },
    
    // Shared (default for general rules)
    { regex: / Bryan|布萊恩|老闆|老闆金句|禁止|嚴格遵守/gi, scope: 'Shared', confidence: 0.7 }
  ],
  
  infer(content, filename) {
    let bestMatch = { scope: 'Shared', confidence: 0.5 };
    const lowerContent = content.toLowerCase();
    const lowerFilename = filename.toLowerCase();
    
    for (const pattern of this.patterns) {
      // Check filename
      if (pattern.regex.test(lowerFilename)) {
        if (pattern.confidence > bestMatch.confidence) {
          bestMatch = { scope: pattern.scope, confidence: pattern.confidence };
        }
      }
      // Check content
      pattern.regex.lastIndex = 0; // Reset regex
      if (pattern.regex.test(lowerContent)) {
        if (pattern.confidence > bestMatch.confidence) {
          bestMatch = { scope: pattern.scope, confidence: pattern.confidence };
        }
      }
    }
    
    return bestMatch;
  }
};

// 掃描 QMD 目錄
async function scanQMD() {
  const results = [];
  
  async function scanDir(dir, relativePath = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = join(relativePath, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath, relPath);
      } else if (entry.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        const stat = await import('node:fs').then(fs => fs.promises.stat(fullPath));
        
        const inferred = SCOPE_INFERENCE.infer(content, entry.name);
        
        results.push({
          path: fullPath,
          relativePath: relPath,
          size: stat.size,
          modified: stat.mtime,
          inferredScope: inferred.scope,
          confidence: inferred.confidence,
          needsReview: inferred.confidence < 0.8
        });
      }
    }
  }
  
  await scanDir(QMD_BASE);
  return results;
}

// 更新資料庫中的 scope
async function updateDBScope(id, scope) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(MEMORY_DB);
  
  try {
    db.prepare('UPDATE memory_blocks SET scope = ? WHERE id = ?').run(scope, id);
  } finally {
    db.close();
  }
}

// 主程式
const args = process.argv.slice(2);

console.log('=== QMD Scope Organizer ===\n');

if (args.includes('--scan')) {
  console.log('Scanning QMD files...\n');
  const files = await scanQMD();
  
  console.log(`Found ${files.length} QMD files\n`);
  
  // Group by scope
  const byScope = {};
  for (const f of files) {
    if (!byScope[f.inferredScope]) byScope[f.inferredScope] = [];
    byScope[f.inferredScope].push(f);
  }
  
  for (const [scope, items] of Object.entries(byScope)) {
    console.log(`\n## ${scope} (${items.length} files)`);
    console.log(`   ${SCOPES[scope] || 'No description'}`);
    
    for (const item of items.slice(0, 5)) {
      const flag = item.needsReview ? '⚠️' : '✅';
      console.log(`   ${flag} ${item.relativePath} (${(item.confidence * 100).toFixed(0)}%)`);
    }
    if (items.length > 5) {
      console.log(`   ... and ${items.length - 5} more`);
    }
  }
  
  const needsReview = files.filter(f => f.needsReview);
  console.log(`\n\n⚠️ ${needsReview.length} files need manual review (confidence < 80%)`);
  
  console.log('\nTo apply scopes to DB, run: node qmd_scope_organizer.js --apply');
  
} else if (args.includes('--apply')) {
  console.log('Applying scope tags to database...\n');
  
  const files = await scanQMD();
  let applied = 0;
  let skipped = 0;
  
  for (const file of files) {
    if (file.needsReview) {
      console.log(`[SKIP] ${file.relativePath} - needs manual review`);
      skipped++;
      continue;
    }
    
    // Extract ID from path (last part without .md)
    const id = file.relativePath.replace(/\\/g, '/').replace(/\.md$/, '');
    
    try {
      await updateDBScope(id, file.inferredScope);
      console.log(`[OK] ${file.relativePath} → ${file.inferredScope}`);
      applied++;
    } catch (e) {
      console.log(`[ERROR] ${file.relativePath}: ${e.message}`);
    }
  }
  
  console.log(`\nApplied: ${applied}, Skipped: ${skipped}`);
  
} else {
  console.log('Usage:');
  console.log('  node qmd_scope_organizer.js --scan   # Scan and show suggestions');
  console.log('  node qmd_scope_organizer.js --apply  # Apply scopes to database');
  console.log('\nThis tool helps organize QMD files by scope:');
  console.log('  - Private:Yua: Personal identity, emotional preferences');
  console.log('  - Private:Tim: Technical rules, code style');
  console.log('  - Shared:SE2: Soul Evolution 2.0 project decisions');
  console.log('  - Shared:ProjectAura: Project Aura milestones');
}
