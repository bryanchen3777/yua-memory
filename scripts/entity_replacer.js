/**
 * Entity Replacer - 敏感實體替換器
 * 
 * 將敏感資訊替換為匿名化 placeholder
 * 例如：客戶 A → [CLIENT_ALPHA], 銀行餘額 → [FIN_VALUE_STABLE]
 * 
 * 使用方式：
 *   node entity_replacer.js --scan <text>
 *   node entity_replacer.js --anonymize <file>
 *   node entity_replacer.js --learn     # 從對話學習新的 entity
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 內建敏感實體對應表
const ENTITY_MAP = {
  // 人物
  ' Bryan': '[USER_BRYAN]',
  'Bryan': '[USER_BRYAN]',
  '布萊恩': '[USER_BRYAN]',
  '老公': '[USER_INTIMATE]',
  
  // 公司
  'Brynet Solutions': '[COMPANY_PRIMARY]',
  'Brynance Solutions': '[COMPANY_SECONDARY]',
  
  // 金融
  '銀行帳戶': '[BANK_ACCOUNT]',
  '帳戶餘額': '[FIN_VALUE]',
  '股票帳戶': '[BROKERAGE_ACCOUNT]',
  
  // 專案
  'Soul Evolution': '[PROJECT_MAIN]',
  'Soul Evolution 2.0': '[PROJECT_MAIN_V2]',
  'Project Aura': '[PROJECT_AURA]',
  
  // 客戶
  '客戶A': '[CLIENT_ALPHA]',
  '客戶B': '[CLIENT_BETA]',
  '客戶C': '[CLIENT_GAMMA]',
  
  // 通用
  '[COMPANY_FINANCIAL_RECORD_2025_07]': '[FIN_DOCUMENT]'
};

// 自動偵測並學習新 entity 的模式
const ENTITY_DETECTION_PATTERNS = [
  { regex: /[A-Z][a-z]+ [\w]+(?:先生|小姐|女士)/g, label: 'PERSON_NAME' },
  { regex: /公司名稱[\s：:]*([^\s，,]+)/g, label: 'COMPANY' },
  { regex: /專案名稱[\s：:]*([^\s，,]+)/g, label: 'PROJECT' },
  { regex: /\$\d+[\d,]*|USD?\s?\d+[\d,]*|NT\$\s?\d+[\d,]*/g, label: 'MONEY_AMOUNT' }
];

/**
 * 對文字進行匿名化處理
 */
function anonymize(text, customMap = {}) {
  const fullMap = { ...ENTITY_MAP, ...customMap };
  let result = text;
  const replacements = [];
  
  // 按 key 長度排序（優先替換較長的 key）
  const keys = Object.keys(fullMap).sort((a, b) => b.length - a.length);
  
  for (const key of keys) {
    const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = result.match(regex);
    if (matches) {
      // 統計每個 key 被替換的次數
      const count = (result.match(regex) || []).length;
      replacements.push({ from: key, to: fullMap[key], count });
      result = result.replace(regex, fullMap[key]);
    }
  }
  
  return {
    original: text,
    anonymized: result,
    replacements
  };
}

/**
 * 批次處理檔案
 */
function anonymizeFile(filepath, dryRun = true) {
  if (!existsSync(filepath)) {
    console.error(`檔案不存在：${filepath}`);
    return null;
  }
  
  const content = readFileSync(filepath, 'utf-8');
  const result = anonymize(content);
  
  console.log(`\n=== 檔案匿名化：${filepath} ===\n`);
  console.log(`替換數量：${result.replacements.length}`);
  
  if (result.replacements.length > 0) {
    console.log('\n替換詳情：');
    for (const r of result.replacements) {
      console.log(`  ${r.from} → ${r.to} (${r.count}次)`);
    }
  }
  
  if (!dryRun) {
    writeFileSync(filepath, result.anonymized);
    console.log('\n✅ 已寫入檔案');
  } else {
    console.log('\n💡 這是預覽模式，使用 --write 實際寫入');
    console.log('\n匿名化後內容（前500字）：');
    console.log(result.anonymized.substring(0, 500) + '...');
  }
  
  return result;
}

/**
 * 學習新的 entity（從對話內容）
 */
function learnEntities(text) {
  const learned = [];
  
  for (const pattern of ENTITY_DETECTION_PATTERNS) {
    const matches = text.match(pattern.regex);
    if (matches) {
      for (const match of matches) {
        learned.push({
          type: pattern.label,
          value: match,
          placeholder: `[${pattern.label}_NEW_${learned.length + 1}]`
        });
      }
    }
  }
  
  return learned;
}

/**
 * 檢查是否包含敏感關鍵字（用於 Distiller --apply 前檢查）
 */
function hasSensitiveContent(text) {
  const sensitivePatterns = [
    /api[_-]?key/i,
    /password/i,
    /secret/i,
    /token/i,
    /credential/i,
    /認證/,
    /密碼/
  ];
  
  for (const pattern of sensitivePatterns) {
    if (pattern.test(text)) {
      return {
        hasSensitive: true,
        matched: pattern.source
      };
    }
  }
  
  return { hasSensitive: false };
}

// CLI
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
Entity Replacer - 敏感實體替換器 v1.0

使用方式：
  node entity_replacer.js --scan <text>      # 測試文字匿名化
  node entity_replacer.js --file <path>     # 匿名化檔案（預覽）
  node entity_replacer.js --file <path> --write   # 匿名化並寫入
  node entity_replacer.js --learn <text>     # 從文字學習新 entity

範例：
  node entity_replacer.js --scan "Brynet Solutions 的銀行帳戶餘額是..."
  node entity_replacer.js --file ./backup.txt --write
`);
} else if (args[0] === '--scan' && args.length > 1) {
  const text = args.slice(1).join(' ');
  const result = anonymize(text);
  console.log('\n=== 匿名化結果 ===\n');
  console.log(`原文：${result.original}`);
  console.log(`\n匿名化：${result.anonymized}`);
  if (result.replacements.length > 0) {
    console.log('\n替換：');
    for (const r of result.replacements) {
      console.log(`  ${r.from} → ${r.to}`);
    }
  }
} else if (args[0] === '--file' && args.length > 1) {
  const filepath = args[1];
  const write = args.includes('--write');
  anonymizeFile(filepath, !write);
} else if (args[0] === '--learn' && args.length > 1) {
  const text = args.slice(1).join(' ');
  const learned = learnEntities(text);
  console.log('\n=== 學習到的 Entity ===\n');
  if (learned.length === 0) {
    console.log('未偵測到新的 entity');
  } else {
    for (const l of learned) {
      console.log(`  ${l.value} → ${l.placeholder} (${l.type})`);
    }
    console.log('\n建議將這些加入 ENTITY_MAP');
  }
} else if (args[0] === '--check' && args.length > 1) {
  const text = args.slice(1).join(' ');
  const result = hasSensitiveContent(text);
  console.log(`\n敏感內容檢查：${result.hasSensitive ? '❌ 發現' : '✅ 通過'}`);
  if (result.hasSensitive) {
    console.log(`匹配模式：${result.matched}`);
  }
}

export { anonymize, hasSensitiveContent, learnEntities };
