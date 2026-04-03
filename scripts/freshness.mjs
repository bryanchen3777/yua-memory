/**
 * freshness.mjs
 * 
 * Memory freshness checker - warns about potentially stale memories
 * Helps prevent using outdated information
 * 
 * Freshness levels:
 * 🟢 Fresh: < 7 days
 * 🟡 Normal: 7-30 days  
 * 🟠 Stale: 30-90 days
 * 🔴 Outdated: > 90 days
 * 
 * Usage:
 *   node freshness.mjs              Check all memories
 *   node freshness.mjs --check      Return stale memories count
 *   node freshness.mjs --warn       Show warnings for stale memories
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const WORKSPACE = 'C:/Users/bbfcc/.openclaw/workspace-tim';
const QMD_DIR = 'C:/Users/bbfcc/.openclaw/workspace/qmd';
const MEMORY_DIR = path.join(WORKSPACE, 'memory');

// Freshness thresholds (in days)
const THRESHOLDS = {
  FRESH: 7,
  NORMAL: 30,
  STALE: 90
};

const FRESHNESS_LEVELS = {
  FRESH: { emoji: '🟢', label: 'Fresh', maxDays: THRESHOLDS.FRESH },
  NORMAL: { emoji: '🟡', label: 'Normal', maxDays: THRESHOLDS.NORMAL },
  STALE: { emoji: '🟠', label: 'Stale', maxDays: THRESHOLDS.STALE },
  OUTDATED: { emoji: '🔴', label: 'Outdated', maxDays: Infinity }
};

/**
 * Get freshness level based on age
 */
function getFreshnessLevel(daysOld) {
  if (daysOld < THRESHOLDS.FRESH) return FRESHNESS_LEVELS.FRESH;
  if (daysOld < THRESHOLDS.NORMAL) return FRESHNESS_LEVELS.NORMAL;
  if (daysOld < THRESHOLDS.STALE) return FRESHNESS_LEVELS.STALE;
  return FRESHNESS_LEVELS.OUTDATED;
}

/**
 * Parse date from frontmatter or filename
 */
function parseDate(content, filePath) {
  // Try frontmatter date
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const dateMatch = fmMatch[1].match(/date:\s*(.+)/i);
    if (dateMatch) {
      return new Date(dateMatch[1]).getTime();
    }
    
    const updatedMatch = fmMatch[1].match(/updated:\s*(.+)/i);
    if (updatedMatch) {
      return new Date(updatedMatch[1]).getTime();
    }
  }
  
  // Fall back to file mtime
  return fs.statSync(filePath).mtime.getTime();
}

/**
 * Format days ago string
 */
function formatDaysAgo(timestamp) {
  const daysOld = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  
  if (daysOld === 0) return 'today';
  if (daysOld === 1) return 'yesterday';
  if (daysOld < 7) return `${daysOld} days ago`;
  if (daysOld < 14) return '1 week ago';
  if (daysOld < 30) return `${Math.floor(daysOld / 7)} weeks ago`;
  if (daysOld < 60) return '1 month ago';
  if (daysOld < 90) return `${Math.floor(daysOld / 30)} months ago`;
  if (daysOld < 365) return `${Math.floor(daysOld / 30)} months ago`;
  return `${Math.floor(daysOld / 365)} year(s) ago`;
}

/**
 * Check a single file for freshness
 */
function checkFile(filePath, relativePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const timestamp = parseDate(content, filePath);
  const daysOld = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  const level = getFreshnessLevel(daysOld);
  const daysAgo = formatDaysAgo(timestamp);
  
  return {
    file: relativePath,
    timestamp: new Date(timestamp).toISOString(),
    daysOld: Math.round(daysOld),
    daysAgo,
    level,
    isStale: level === FRESHNESS_LEVELS.STALE || level === FRESHNESS_LEVELS.OUTDATED
  };
}

/**
 * Check all memories in QMD and memory directory
 */
function checkAllMemories() {
  const results = {
    total: 0,
    fresh: 0,
    normal: 0,
    stale: 0,
    outdated: 0,
    files: []
  };
  
  // Check QMD directories
  if (fs.existsSync(QMD_DIR)) {
    const categories = fs.readdirSync(QMD_DIR);
    
    for (const cat of categories) {
      const catPath = path.join(QMD_DIR, cat);
      if (!fs.statSync(catPath).isDirectory()) continue;
      
      const files = fs.readdirSync(catPath).filter(f => f.endsWith('.md'));
      
      for (const file of files) {
        const filePath = path.join(catPath, file);
        const relativePath = `qmd/${cat}/${file}`;
        
        const result = checkFile(filePath, relativePath);
        results.total++;
        results.files.push(result);
        
        if (result.level === FRESHNESS_LEVELS.FRESH) results.fresh++;
        else if (result.level === FRESHNESS_LEVELS.NORMAL) results.normal++;
        else if (result.level === FRESHNESS_LEVELS.STALE) results.stale++;
        else results.outdated++;
      }
    }
  }
  
  // Check memory directory
  if (fs.existsSync(MEMORY_DIR)) {
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));
    
    for (const file of files) {
      const filePath = path.join(MEMORY_DIR, file);
      const relativePath = `memory/${file}`;
      
      const result = checkFile(filePath, relativePath);
      results.total++;
      results.files.push(result);
      
      if (result.level === FRESHNESS_LEVELS.FRESH) results.fresh++;
      else if (result.level === FRESHNESS_LEVELS.NORMAL) results.normal++;
      else if (result.level === FRESHNESS_LEVELS.STALE) results.stale++;
      else results.outdated++;
    }
  }
  
  return results;
}

/**
 * Print results
 */
function printResults(results) {
  console.log('💨 Memory Freshness Report');
  console.log('═'.repeat(50));
  console.log(`\n📊 Summary:`);
  console.log(`   Total memories: ${results.total}`);
  console.log(`   🟢 Fresh: ${results.fresh}`);
  console.log(`   🟡 Normal: ${results.normal}`);
  console.log(`   🟠 Stale: ${results.stale}`);
  console.log(`   🔴 Outdated: ${results.outdated}`);
  
  if (results.stale > 0 || results.outdated > 0) {
    console.log(`\n⚠️  Stale Memories (need review):`);
    for (const f of results.files) {
      if (f.isStale) {
        console.log(`   ${f.level.emoji} [${f.daysAgo}] ${f.file}`);
      }
    }
  }
  
  if (results.fresh > 0) {
    console.log(`\n✅ Fresh Memories (recently updated):`);
    for (const f of results.files.slice(0, 5)) {
      if (f.level === FRESHNESS_LEVELS.FRESH) {
        console.log(`   🟢 [${f.daysAgo}] ${f.file}`);
      }
    }
  }
}

/**
 * Generate warnings for stale memories
 */
function generateWarnings(results) {
  const warnings = [];
  
  for (const f of results.files) {
    if (f.level === FRESHNESS_LEVELS.STALE) {
      warnings.push(`🟠 Memory may be stale: ${f.file} (${f.daysAgo})`);
    } else if (f.level === FRESHNESS_LEVELS.OUTDATED) {
      warnings.push(`🔴 Memory likely outdated: ${f.file} (${f.daysAgo})`);
    }
  }
  
  return warnings;
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
freshness.mjs - Memory Freshness Checker

Usage:
  node freshness.mjs          Full report
  node freshness.mjs --check  Return stale count (exit code = stale count)
  node freshness.mjs --warn   Show warnings for stale memories

Freshness Levels:
  🟢 Fresh:   < 7 days
  🟡 Normal:  7-30 days
  🟠 Stale:   30-90 days
  🔴 Outdated: > 90 days
`);
  process.exit(0);
} else if (args.includes('--check')) {
  const results = checkAllMemories();
  console.log(`Stale memories: ${results.stale + results.outdated}`);
  process.exit(results.stale + results.outdated);
} else if (args.includes('--warn')) {
  const results = checkAllMemories();
  const warnings = generateWarnings(results);
  if (warnings.length > 0) {
    console.log('⚠️ Memory Freshness Warnings:');
    for (const w of warnings) {
      console.log(`   ${w}`);
    }
  } else {
    console.log('✅ All memories are fresh');
  }
} else {
  const results = checkAllMemories();
  printResults(results);
}

export { checkAllMemories, getFreshnessLevel, generateWarnings };
