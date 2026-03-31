/**
 * Privacy Filter - 隱私過濾器
 * 
 * 雙層過濾：
 * 1. Regex 靜態攔截：API Keys、身分證、信用卡等
 * 2. LLM 動態掃描：偵測潛在敏感資訊
 * 
 * 使用方式：
 *   node privacy_filter.js --scan <text>     # 測試單段文字
 *   node privacy_filter.js --file <path>     # 過濾檔案
 *   node privacy_filter.js --check-qmd       # 檢查所有 QMD
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

// ========== 第一層：Regex 靜態攔截 ==========

const STATIC_PATTERNS = [
  // API Keys / Secrets
  { 
    regex: /api[_-]?key["\s:=]+[\w-]{16,}/gi, 
    label: 'API_KEY',
    severity: 'HIGH'
  },
  { 
    regex: /secret["\s:=]+[\w-]{16,}/gi, 
    label: 'SECRET',
    severity: 'HIGH'
  },
  { 
    regex: /password["\s:=]+[\S]{8,}/gi, 
    label: 'PASSWORD',
    severity: 'HIGH'
  },
  { 
    regex: /bearer[\s]+[\w-]{20,}/gi, 
    label: 'BEARER_TOKEN',
    severity: 'HIGH'
  },
  { 
    regex: /sk-[a-zA-Z0-9]{20,}/gi, 
    label: 'OPENAI_KEY',
    severity: 'HIGH'
  },
  { 
    regex: /ghp_[a-zA-Z0-9]{20,}/gi, 
    label: 'GITHUB_TOKEN',
    severity: 'HIGH'
  },
  
  // 身份識別
  { 
    regex: /\b[A-Z]\d{9}\b/g, 
    label: 'TAIWAN_ID',
    severity: 'HIGH'
  },
  { 
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, 
    label: 'CREDIT_CARD',
    severity: 'HIGH'
  },
  { 
    regex: /\b\d{3}[-\s]?\d{8}\b/g, 
    label: 'PHONE_NUMBER',
    severity: 'MEDIUM'
  },
  
  // 電子郵件（可配置是否遮蔽）
  { 
    regex: /[\w.-]+@[\w.-]+\.\w+/gi, 
    label: 'EMAIL',
    severity: 'LOW',
    defaultAction: 'WARN'  // 預設只警告，不自動遮蔽
  },
  
  // 公司敏感資料
  { 
    regex: /Brynet[\s]?Solutions/gi, 
    label: 'COMPANY_NAME',
    severity: 'LOW'  // 只標記，不遮蔽
  },
  { 
    regex: /帳單|銀行對帳|財務[資料]*|帳戶明細/gi, 
    label: 'FINANCIAL_INFO',
    severity: 'MEDIUM'
  },
  { 
    regex: /銀行[\s]*帳戶|銀行[\s]*帳號|存款[\S]{0,5}帳/gi, 
    label: 'BANK_ACCOUNT',
    severity: 'HIGH'
  },
  { 
    regex: /(?!個人)帳號[\s：:]*\(?\d{5,}\)?/gi, 
    label: 'PERSONAL_ACCOUNT',
    severity: 'LOW'  // 排除「個人帳號」，只標記其他數字帳號
  },
  
  // IP / 網路
  { 
    regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, 
    label: 'IP_ADDRESS',
    severity: 'LOW'
  },
  
  // 私人敏感
  { 
    regex: /身份證|健保卡|駕照/gi, 
    label: 'GOVERNMENT_ID',
    severity: 'HIGH'
  },
  { 
    regex: /地址[\s：:]*[\S]{5,}/gi, 
    label: 'ADDRESS',
    severity: 'MEDIUM'
  }
];

// ========== 第二層：LLM 動態掃描（簡化版）============

const SEMANTIC_SENSITIVE_PATTERNS = [
  { keywords: ['銀行帳戶', '銀行帳號', '存款帳戶', '匯款', '轉帳'], label: 'BANK_ACCOUNT', severity: 'HIGH' },
  { keywords: ['密碼', 'passwd', 'pwd'], label: 'PASSWORD', severity: 'HIGH' },
  { keywords: ['私人', '機密', 'confidential', '不要外傳'], label: 'PRIVATE_INFO', severity: 'MEDIUM' },
  { keywords: ['商業機密', '技術授權', '專利'], label: 'TRADE_SECRET', severity: 'HIGH' },
  { keywords: ['員工薪資', '獎金', '紅利'], label: 'SALARY_INFO', severity: 'MEDIUM' },
  { keywords: ['客戶名單', '顧客資料', '用戶資料'], label: 'CUSTOMER_DATA', severity: 'HIGH' },
];

// ========== 過濾核心函數 ==========

function staticScan(text) {
  const findings = [];
  
  for (const pattern of STATIC_PATTERNS) {
    const matches = text.match(pattern.regex);
    if (matches) {
      for (const match of matches) {
        findings.push({
          type: 'STATIC_REGEX',
          label: pattern.label,
          severity: pattern.severity,
          matched: match,
          replacement: `[${pattern.label}_REDACTED]`,
          action: pattern.defaultAction === 'WARN' ? 'WARN' : 'REDACT'
        });
      }
      // Reset regex lastIndex
      pattern.regex.lastIndex = 0;
    }
  }
  
  return findings;
}

function semanticScan(text) {
  const findings = [];
  const lowerText = text.toLowerCase();
  
  for (const pattern of SEMANTIC_SENSITIVE_PATTERNS) {
    for (const keyword of pattern.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        // Find the sentence containing this keyword
        const sentences = text.split(/[。！？\n]/);
        for (const sentence of sentences) {
          if (sentence.toLowerCase().includes(keyword.toLowerCase())) {
            findings.push({
              type: 'SEMANTIC_KEYWORD',
              label: pattern.label,
              severity: pattern.severity,
              context: sentence.trim().substring(0, 100),
              keyword: keyword
            });
          }
        }
        break; // Only report once per pattern
      }
    }
  }
  
  return findings;
}

/**
 * 完整過濾流程
 * @param {string} text - 要過濾的文字
 * @param {object} options - 選項
 * @returns {object} - 過濾結果
 */
function filter(text, options = {}) {
  const {
    autoRedact = false,  // 是否自動遮蔽（還是只報告）
    redactLevel = 'HIGH' // 自動遮蔽的最低 severity 等級
  } = options;
  
  const staticResults = staticScan(text);
  const semanticResults = semanticScan(text);
  
  // 合併結果
  const allFindings = [...staticResults, ...semanticResults];
  
  // 按 severity 排序
  allFindings.sort((a, b) => {
    const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
  
  // 自動遮蔽
  let filteredText = text;
  if (autoRedact) {
    for (const finding of allFindings) {
      if (finding.severity === 'HIGH' || (finding.severity === 'MEDIUM' && redactLevel === 'MEDIUM')) {
        if (finding.replacement) {
          filteredText = filteredText.replace(finding.matched, finding.replacement);
        }
      }
    }
  }
  
  return {
    original: text,
    filtered: filteredText,
    findings: allFindings,
    summary: {
      total: allFindings.length,
      high: allFindings.filter(f => f.severity === 'HIGH').length,
      medium: allFindings.filter(f => f.severity === 'MEDIUM').length,
      low: allFindings.filter(f => f.severity === 'LOW').length,
      wouldRedact: autoRedact ? allFindings.filter(f => f.severity !== 'LOW').length : 0
    },
    isClean: allFindings.filter(f => f.severity !== 'LOW').length === 0
  };
}

// ========== CLI 介面 ==========

const args = process.argv.slice(2);

function usage() {
  console.log(`
Privacy Filter - 隱私過濾器 v1.0

使用方式：
  node privacy_filter.js --scan <text>     # 測試單段文字
  node privacy_filter.js --file <path>    # 過濾檔案
  node privacy_filter.js --check-qmd       # 檢查所有 QMD
  node privacy_filter.js --auto-redact <path>  # 自動遮蔽並覆寫

範例：
  node privacy_filter.js --scan "我的 API Key 是 sk-1234567890abcdef"
  node privacy_filter.js --file ./backup.txt
  node privacy_filter.js --check-qmd
`);
}

async function scanText(text) {
  const result = filter(text);
  
  console.log('\n=== 隱私掃描結果 ===\n');
  console.log(`清潔狀態：${result.isClean ? '✅ 通過' : '❌ 發現敏感資訊'}`);
  console.log(`\n摘要：`);
  console.log(`  高風險：${result.summary.high}`);
  console.log(`  中風險：${result.summary.medium}`);
  console.log(`  低風險：${result.summary.low}`);
  
  if (result.findings.length > 0) {
    console.log(`\n詳細發現：`);
    for (const f of result.findings) {
      const icon = f.severity === 'HIGH' ? '🔴' : f.severity === 'MEDIUM' ? '🟡' : '🟢';
      console.log(`  ${icon} [${f.label}] ${f.type}`);
      if (f.matched) {
        console.log(`     匹配：${f.matched}`);
      }
      if (f.context) {
        console.log(`     語境：${f.context}...`);
      }
    }
  }
  
  if (!result.isClean) {
    console.log('\n建議：手動檢查或使用 --auto-redact 自動遮蔽');
  }
}

async function filterFile(filepath, autoRedact = false) {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const result = filter(content, { autoRedact });
    
    console.log(`\n=== 檔案掃描：${filepath} ===\n`);
    console.log(`清潔狀態：${result.isClean ? '✅ 通過' : '❌ 發現敏感資訊'}`);
    console.log(`摘要：高${result.summary.high} / 中${result.summary.medium} / 低${result.summary.low}`);
    
    if (result.findings.length > 0 && result.summary.high > 0) {
      console.log('\n🔴 高風險發現：');
      for (const f of result.findings.filter(f => f.severity === 'HIGH')) {
        console.log(`  - ${f.label}: ${f.matched || f.context}`);
      }
    }
    
    if (autoRedact && !result.isClean) {
      writeFileSync(filepath, result.filtered);
      console.log(`\n✅ 已自動遮蔽並覆寫檔案`);
    }
    
    return result;
  } catch (e) {
    console.error(`錯誤：${e.message}`);
    return null;
  }
}

async function checkQMD() {
  const QMD_BASE = 'C:\\Users\\bbfcc\\.openclaw\\workspace\\qmd';
  const results = [];
  
  function scanDir(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dir}\\${entry.name}`;
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const content = readFileSync(fullPath, 'utf-8');
        const result = filter(content);
        if (!result.isClean) {
          results.push({ path: fullPath, ...result });
        }
      }
    }
  }
  
  console.log('正在掃描 QMD 資料夾...\n');
  scanDir(QMD_BASE);
  
  if (results.length === 0) {
    console.log('✅ 所有 QMD 檔案都通過隱私檢查');
  } else {
    console.log(`❌ 發現 ${results.length} 個檔案有隱私風險：\n`);
    for (const r of results) {
      const shortPath = r.path.replace(QMD_BASE, 'qmd');
      console.log(`📄 ${shortPath}`);
      console.log(`   高風險：${r.summary.high} / 中風險：${r.summary.medium}`);
      for (const f of r.findings.filter(f => f.severity !== 'LOW').slice(0, 3)) {
        console.log(`   - ${f.label}: ${(f.matched || f.context || '').substring(0, 50)}`);
      }
      console.log('');
    }
  }
  
  return results;
}

// 主程式
if (args.length === 0) {
  usage();
} else if (args[0] === '--scan' && args.length > 1) {
  scanText(args.slice(1).join(' '));
} else if (args[0] === '--file' && args.length > 1) {
  filterFile(args[1]);
} else if (args[0] === '--check-qmd') {
  checkQMD();
} else if (args[0] === '--auto-redact' && args.length > 1) {
  filterFile(args[1], true);
} else {
  usage();
}

export { filter, staticScan, semanticScan };
