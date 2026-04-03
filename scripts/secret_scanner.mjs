/**
 * secret_scanner.mjs
 * 
 * Secret Scanner - Detects sensitive information in files
 * Inspired by Claude Code's 30 secret scanner rules
 * 
 * Detects:
 * - API keys (OpenAI, Anthropic, AWS, Google, GitHub, etc.)
 * - Tokens (Bearer, OAuth, JWT, Slack, Telegram, etc.)
 * - Private keys (SSH, GPG, SSL)
 * - Passwords and credentials
 * - Webhook URLs and secrets
 * 
 * Usage:
 *   node secret_scanner.mjs                  Scan all files
 *   node secret_scanner.mjs --path <path>   Scan specific path
 *   node secret_scanner.mjs --check          Return count only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to scan
const WORKSPACE = 'C:/Users/bbfcc/.openclaw/workspace-tim';
const DEFAULT_SCAN_PATHS = [
  'C:/Users/bbfcc/.openclaw/workspace-tim',
  'C:/Users/bbfcc/.openclaw/workspace',
  'C:/Users/bbfcc/.openclaw'
];

// Patterns for secret detection
const SECRET_PATTERNS = [
  // OpenAI / Anthropic
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, type: 'OpenAI API Key', severity: 'critical' },
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, type: 'Anthropic API Key', severity: 'critical' },
  
  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/g, type: 'AWS Access Key', severity: 'critical' },
  { pattern: /[a-zA-Z0-9/+=]{40}/g, type: 'AWS Secret Key', severity: 'critical' },
  
  // GitHub
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, type: 'GitHub Personal Access Token', severity: 'critical' },
  { pattern: /gho_[a-zA-Z0-9]{36}/g, type: 'GitHub OAuth Token', severity: 'critical' },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/g, type: 'GitHub PAT', severity: 'critical' },
  
  // Telegram
  { pattern: /[0-9]{8,10}:[a-zA-Z0-9_-]{35}/g, type: 'Telegram Bot Token', severity: 'critical' },
  
  // Slack
  { pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g, type: 'Slack Token', severity: 'critical' },
  
  // Google
  { pattern: /AIza[0-9A-Za-z_-]{35}/g, type: 'Google API Key', severity: 'critical' },
  { pattern: /[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com/g, type: 'Google OAuth Client ID', severity: 'critical' },
  
  // Generic API keys
  { pattern: /api[_-]?key["\s:=]+["']?[a-zA-Z0-9]{20,}/gi, type: 'Generic API Key', severity: 'high' },
  
  // JWT Tokens
  { pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, type: 'JWT Token', severity: 'high' },
  
  // Bearer Tokens
  { pattern: /Bearer\s+[a-zA-Z0-9_-]{20,}/g, type: 'Bearer Token', severity: 'high' },
  
  // SSH Private Keys
  { pattern: /-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/g, type: 'SSH Private Key', severity: 'critical' },
  { pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g, type: 'GPG Private Key', severity: 'critical' },
  
  // Passwords in configs
  { pattern: /password["\s:=]+["']?[a-zA-Z0-9@#$%^&*!]{8,}/gi, type: 'Password', severity: 'high' },
  { pattern: /passwd["\s:=]+["']?[a-zA-Z0-9@#$%^&*!]{8,}/gi, type: 'Password', severity: 'high' },
  { pattern: /secret["\s:=]+["']?[a-zA-Z0-9@#$%^&*!]{8,}/gi, type: 'Secret', severity: 'high' },
  
  // Database connection strings
  { pattern: /mongodb(\+srv)?:\/\/[a-zA-Z0-9:@/._-]+/g, type: 'MongoDB Connection', severity: 'high' },
  { pattern: /postgres(ql)?:\/\/[a-zA-Z0-9:@/._-]+/g, type: 'PostgreSQL Connection', severity: 'high' },
  { pattern: /mysql:\/\/[a-zA-Z0-9:@/._-]+/g, type: 'MySQL Connection', severity: 'high' },
  { pattern: /redis:\/\/[a-zA-Z0-9:@/._-]+/g, type: 'Redis Connection', severity: 'medium' },
  
  // Webhook URLs with secrets
  { pattern: /https:\/\/.*?[?&#](?:token|key|secret)=[a-zA-Z0-9_-]{10,}/gi, type: 'Webhook URL with Secret', severity: 'high' },
  
  // Telegram Bot Token pattern
  { pattern: /telegtam[_-]?bot[_-]?token["\s:=]+["']?[0-9]{8,10}:[a-zA-Z0-9_-]{35}/gi, type: 'Telegram Bot Token', severity: 'critical' },
  
  // Discord
  { pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}/g, type: 'Discord Bot Token', severity: 'critical' },
  
  // Stripe
  { pattern: /sk_live_[a-zA-Z0-9]{24,}/g, type: 'Stripe Live Key', severity: 'critical' },
  { pattern: /rk_live_[a-zA-Z0-9]{24,}/g, type: 'Stripe Live Key', severity: 'critical' },
  
  // SendGrid
  { pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g, type: 'SendGrid API Key', severity: 'critical' },
  
  // Twilio
  { pattern: /SK[a-zA-Z0-9]{32}/g, type: 'Twilio API Key', severity: 'critical' },
  
  // Private keys and certificates
  { pattern: /-----BEGIN CERTIFICATE-----/g, type: 'SSL Certificate', severity: 'medium' },
  
  // Environment variable patterns
  { pattern: /(?:export\s+)?[A-Z_]+=(?:'|")?[a-zA-Z0-9@#$%^&*!]{8,}(?:'|")?/g, type: 'Environment Variable with Secret', severity: 'high' },
  
  // Generic high-entropy secrets
  { pattern: /["']{1}[a-zA-Z0-9+/=]{40,}["']{1}/g, type: 'Possible Base64 Secret', severity: 'medium' },
];

/**
 * Scan a single file for secrets
 */
function scanFile(filePath) {
  const results = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);
    
    // Skip binary or very large files
    if (content.length > 1024 * 1024) { // 1MB limit
      return results;
    }
    
    for (const rule of SECRET_PATTERNS) {
      const matches = content.match(rule.pattern);
      if (matches) {
        // Deduplicate matches
        const uniqueMatches = [...new Set(matches)];
        
        for (const match of uniqueMatches) {
          // Mask the secret for display
          const masked = maskSecret(match, rule.type);
          
          results.push({
            file: filePath,
            fileName,
            type: rule.type,
            severity: rule.severity,
            match: masked,
            line: findLineNumber(content, match)
          });
        }
      }
    }
  } catch (err) {
    // Skip files that can't be read
  }
  
  return results;
}

/**
 * Mask a secret for safe display
 */
function maskSecret(secret, type) {
  if (secret.length <= 8) return '********';
  
  if (type.includes('Token') || type.includes('Key')) {
    return secret.substring(0, 4) + '...' + secret.substring(secret.length - 4);
  }
  
  return secret.substring(0, 3) + '***' + secret.substring(secret.length - 3);
}

/**
 * Find line number of a match
 */
function findLineNumber(content, match) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(match)) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Scan a directory recursively
 */
function scanDirectory(dirPath, results = []) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      // Skip certain directories
      if (entry.isDirectory()) {
        const skipDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.cache'];
        if (!skipDirs.includes(entry.name)) {
          scanDirectory(fullPath, results);
        }
        continue;
      }
      
      // Only scan text files
      const ext = path.extname(entry.name).toLowerCase();
      const textExts = ['.js', '.mjs', '.ts', '.json', '.md', '.yml', '.yaml', '.env', '.txt', '.py', '.sh', '.ps1', '.bat', '.cmd', '.xml', '.html', '.css'];
      
      if (textExts.includes(ext) || entry.name.startsWith('.')) {
        const fileResults = scanFile(fullPath);
        results.push(...fileResults);
      }
    }
  } catch (err) {
    // Skip directories that can't be read
  }
  
  return results;
}

/**
 * Print results
 */
function printResults(results) {
  if (results.length === 0) {
    console.log('✅ No secrets detected!');
    return;
  }
  
  // Group by severity
  const bySeverity = {
    critical: results.filter(r => r.severity === 'critical'),
    high: results.filter(r => r.severity === 'high'),
    medium: results.filter(r => r.severity === 'medium')
  };
  
  console.log('🔒 Secret Scanner Report');
  console.log('═'.repeat(50));
  console.log(`\n⚠️  Found ${results.length} potential secret(s)\n`);
  
  if (bySeverity.critical.length > 0) {
    console.log('🔴 CRITICAL:');
    for (const r of bySeverity.critical) {
      console.log(`   ${r.type}: ${r.file}`);
      console.log(`   Line ${r.line}: ${r.match}`);
      console.log('');
    }
  }
  
  if (bySeverity.high.length > 0) {
    console.log('🟠 HIGH:');
    for (const r of bySeverity.high) {
      console.log(`   ${r.type}: ${r.file}`);
      console.log(`   Line ${r.line}: ${r.match}`);
      console.log('');
    }
  }
  
  if (bySeverity.medium.length > 0) {
    console.log('🟡 MEDIUM:');
    for (const r of bySeverity.medium) {
      console.log(`   ${r.type}: ${r.file}`);
      console.log(`   Line ${r.line}: ${r.match}`);
      console.log('');
    }
  }
  
  console.log('─'.repeat(50));
  console.log('Recommendation: Rotate these secrets immediately and update your config.');
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
secret_scanner.mjs - Secret Scanner

Usage:
  node secret_scanner.mjs                  Scan default paths
  node secret_scanner.mjs --path <path>    Scan specific path
  node secret_scanner.mjs --check          Return count only
  node secret_scanner.mjs --help           Show this help

Scans for:
  - API Keys (OpenAI, Anthropic, AWS, Google, GitHub)
  - Tokens (Bearer, OAuth, JWT, Slack, Telegram)
  - Private Keys (SSH, GPG, SSL)
  - Passwords and credentials
  - Database connection strings
  - Webhook URLs with secrets
`);
  process.exit(0);
} else if (args.includes('--check')) {
  let count = 0;
  for (const scanPath of DEFAULT_SCAN_PATHS) {
    if (fs.existsSync(scanPath)) {
      const results = scanDirectory(scanPath);
      count += results.length;
    }
  }
  console.log(`Secrets found: ${count}`);
  process.exit(count > 0 ? 1 : 0);
} else {
  let scanPaths = DEFAULT_SCAN_PATHS;
  
  const pathIndex = args.indexOf('--path');
  if (pathIndex !== -1 && args[pathIndex + 1]) {
    scanPaths = [args[pathIndex + 1]];
  }
  
  const allResults = [];
  
  for (const scanPath of scanPaths) {
    if (!fs.existsSync(scanPath)) {
      console.log(`⚠️  Path not found: ${scanPath}`);
      continue;
    }
    
    if (fs.statSync(scanPath).isDirectory()) {
      console.log(`📁 Scanning: ${scanPath}`);
      scanDirectory(scanPath, allResults);
    } else {
      console.log(`📄 Scanning: ${scanPath}`);
      allResults.push(...scanFile(scanPath));
    }
  }
  
  console.log('');
  printResults(allResults);
}

export { scanFile, scanDirectory, SECRET_PATTERNS };
