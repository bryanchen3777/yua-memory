/**
 * dream_mode.mjs
 * 
 * Dream Mode - 4-phase memory consolidation system
 * Inspired by Claude Code's Dream Mode
 * 
 * 4 Phases:
 * 1. Orient - Understand current memory state
 * 2. Gather - Collect relevant recent memories
 * 3. Consolidate - Merge and synthesize into long-term memory
 * 4. Prune - Remove outdated or redundant information
 * 
 * Triggered by: cron (24h) or session count (5 sessions)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const WORKSPACE = 'C:/Users/bbfcc/.openclaw/workspace-tim';
const LOCK_DIR = path.join(WORKSPACE, 'memory', 'locks');
const LOCK_FILE = path.join(LOCK_DIR, 'dream.lock');
const SESSION_MEMORY = path.join(WORKSPACE, 'memory', 'session.md');
const QMD_DIR = 'C:/Users/bbfcc/.openclaw/workspace/qmd';
const MEMORY_DIR = path.join(WORKSPACE, 'memory');

// Settings
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_COUNT_THRESHOLD = 5;

/**
 * Lock mechanism with PID stale guard (from Claude Code)
 */
function acquireLock() {
  // Create lock dir if not exists
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }
  
  // Check if lock exists
  if (fs.existsSync(LOCK_FILE)) {
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    
    // Check if process is still alive
    try {
      process.kill(lock.pid, 0); // Signal 0 just checks if process exists
      const age = Date.now() - lock.mtime;
      if (age < STALE_THRESHOLD_MS) {
        console.log(`🔒 Dream Mode already running (PID ${lock.pid}, age ${Math.round(age/1000)}s)`);
        return false;
      }
      console.log(`⚠️ Stale lock found (PID ${lock.pid}, age ${Math.round(age/1000)}s), taking over`);
    } catch (e) {
      // Process doesn't exist, lock is stale
      console.log(`🧹 Stale lock cleaned up (PID ${lock.pid})`);
    }
  }
  
  // Acquire lock
  const lock = {
    pid: process.pid,
    mtime: Date.now(),
    startedAt: new Date().toISOString()
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2), 'utf8');
  console.log(`🔓 Dream Mode lock acquired (PID ${process.pid})`);
  return true;
}

/**
 * Release lock
 */
function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (lock.pid === process.pid) {
      fs.unlinkSync(LOCK_FILE);
      console.log(`🔐 Dream Mode lock released`);
    }
  }
}

/**
 * Phase 1: Orient - Understand current state
 */
async function phaseOrient() {
  console.log('\n📍 PHASE 1: Orient');
  console.log('─'.repeat(40));
  
  const state = {
    agent: 'Tim',
    timestamp: new Date().toISOString(),
    sessionMemoryExists: fs.existsSync(SESSION_MEMORY),
    qmdExists: fs.existsSync(QMD_DIR),
    recentSessions: [],
    lockStatus: fs.existsSync(LOCK_FILE) ? 'active' : 'none'
  };
  
  // Read current session memory if exists
  if (state.sessionMemoryExists) {
    const content = fs.readFileSync(SESSION_MEMORY, 'utf8');
    // Extract key info
    const titleMatch = content.match(/## Session Title\n([^\n]+)/);
    const stateMatch = content.match(/## Current State\n([^\n]+)/);
    state.currentTitle = titleMatch ? titleMatch[1].trim() : 'Unknown';
    state.currentState = stateMatch ? stateMatch[1].trim() : 'Unknown';
  }
  
  console.log(`   Agent: ${state.agent}`);
  console.log(`   Current Session: ${state.currentTitle || 'None'}`);
  console.log(`   Session Memory: ${state.sessionMemoryExists ? '✅' : '❌'}`);
  console.log(`   QMD: ${state.qmdExists ? '✅' : '❌'}`);
  
  return state;
}

/**
 * Phase 2: Gather - Collect relevant memories
 */
async function phaseGather(orientState) {
  console.log('\n📥 PHASE 2: Gather');
  console.log('─'.repeat(40));
  
  const memories = {
    sessionMemory: null,
    recentQMD: [],
    recentDecisions: [],
    recentRules: [],
    recentTechnical: []
  };
  
  // Read session memory
  if (fs.existsSync(SESSION_MEMORY)) {
    memories.sessionMemory = fs.readFileSync(SESSION_MEMORY, 'utf8');
    console.log('   ✅ Session Memory loaded');
  }
  
  // Gather from QMD categories
  const categories = ['rules', 'technical', 'protocols', 'context', 'identity'];
  for (const cat of categories) {
    const catPath = path.join(QMD_DIR, cat);
    if (!fs.existsSync(catPath)) continue;
    
    const files = fs.readdirSync(catPath).filter(f => f.endsWith('.md'));
    // Get files modified in last 7 days
    const recentFiles = files.filter(f => {
      const stat = fs.statSync(path.join(catPath, f));
      const age = Date.now() - stat.mtime.getTime();
      return age < 7 * 24 * 60 * 60 * 1000;
    });
    
    for (const file of recentFiles) {
      const content = fs.readFileSync(path.join(catPath, file), 'utf8');
      const summary = content.replace(/^---[\s\S]*?---/, '').trim().substring(0, 200);
      memories.recentQMD.push({
        category: cat,
        file,
        summary,
        mtime: fs.statSync(path.join(catPath, file)).mtime
      });
    }
  }
  
  console.log(`   ✅ Gathered ${memories.recentQMD.length} recent QMD files`);
  console.log(`   📁 Categories: ${[...new Set(memories.recentQMD.map(m => m.category))].join(', ') || 'None'}`);
  
  return memories;
}

/**
 * Phase 3: Consolidate - Merge and synthesize
 */
async function phaseConsolidate(orientState, memories) {
  console.log('\n🧠 PHASE 3: Consolidate');
  console.log('─'.repeat(40));
  
  const consolidated = {
    newQMDEntries: [],
    updatedQMDEntries: [],
    insights: []
  };
  
  // Analyze session memory for key decisions/learning
  if (memories.sessionMemory) {
    // Extract learnings
    const learningsMatch = memories.sessionMemory.match(/## Learnings\n([\s\S]*?)(?=\n## |$)/);
    if (learningsMatch && learningsMatch[1].trim() && !learningsMatch[1].includes('(_')) {
      consolidated.insights.push({
        type: 'learning',
        content: learningsMatch[1].trim()
      });
    }
    
    // Extract errors & corrections
    const errorsMatch = memories.sessionMemory.match(/## Errors & Corrections\n([\s\S]*?)(?=\n## |$)/);
    if (errorsMatch && errorsMatch[1].trim() && !errorsMatch[1].includes('(_')) {
      consolidated.insights.push({
        type: 'error_fix',
        content: errorsMatch[1].trim()
      });
    }
    
    // Extract key results
    const resultsMatch = memories.sessionMemory.match(/## Key Results\n([\s\S]*?)(?=\n## |$)/);
    if (resultsMatch && resultsMatch[1].trim() && !resultsMatch[1].includes('(_')) {
      consolidated.insights.push({
        type: 'result',
        content: resultsMatch[1].trim()
      });
    }
  }
  
  // Generate new QMD entries if needed
  if (consolidated.insights.length > 0) {
    console.log(`   📝 Found ${consolidated.insights.length} insights to consolidate`);
    
    for (const insight of consolidated.insights) {
      console.log(`   • ${insight.type}: ${insight.content.substring(0, 60)}...`);
    }
  } else {
    console.log('   ℹ️ No new insights to consolidate');
  }
  
  return consolidated;
}

/**
 * Phase 4: Prune - Remove outdated info
 */
async function phasePrune(orientState, memories) {
  console.log('\n✂️ PHASE 4: Prune');
  console.log('─'.repeat(40));
  
  const pruned = {
    removed: [],
    archived: []
  };
  
  // Find old session memories (older than 30 days)
  const memoryFiles = fs.readdirSync(MEMORY_DIR).filter(f => f.startsWith('session_') && f.endsWith('.md'));
  
  for (const file of memoryFiles) {
    const filePath = path.join(MEMORY_DIR, file);
    const stat = fs.statSync(filePath);
    const age = Date.now() - stat.mtime.getTime();
    
    if (age > 30 * 24 * 60 * 60 * 1000) {
      // Archive old session memories
      const archiveDir = path.join(MEMORY_DIR, 'archive');
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }
      
      const archivePath = path.join(archiveDir, file);
      fs.renameSync(filePath, archivePath);
      pruned.archived.push(file);
    }
  }
  
  // Find duplicate QMD entries
  const seenContent = new Map();
  for (const mem of memories.recentQMD) {
    const key = mem.summary.substring(0, 50);
    if (seenContent.has(key)) {
      pruned.removed.push(mem.file);
    } else {
      seenContent.set(key, mem);
    }
  }
  
  if (pruned.archived.length > 0) {
    console.log(`   📦 Archived ${pruned.archived.length} old session memories`);
    for (const f of pruned.archived) {
      console.log(`     • ${f}`);
    }
  }
  
  if (pruned.removed.length > 0) {
    console.log(`   🗑️  Marked ${pruned.removed.length} duplicates for removal`);
    for (const f of pruned.removed) {
      console.log(`     • ${f}`);
    }
  }
  
  if (pruned.archived.length === 0 && pruned.removed.length === 0) {
    console.log('   ℹ️ Nothing to prune');
  }
  
  return pruned;
}

/**
 * Main Dream Mode execution
 */
async function runDreamMode() {
  console.log('🌙 DREAM MODE - Memory Consolidation');
  console.log('═'.repeat(50));
  console.log(`Started at: ${new Date().toISOString()}`);
  
  // Acquire lock
  if (!acquireLock()) {
    console.log('⚠️ Dream Mode already in progress, exiting');
    return { status: 'skipped', reason: 'already_running' };
  }
  
  try {
    // Phase 1: Orient
    const orientState = await phaseOrient();
    
    // Phase 2: Gather
    const memories = await phaseGather(orientState);
    
    // Phase 3: Consolidate
    const consolidated = await phaseConsolidate(orientState, memories);
    
    // Phase 4: Prune
    const pruned = await phasePrune(orientState, memories);
    
    console.log('\n' + '═'.repeat(50));
    console.log('✅ DREAM MODE COMPLETE');
    console.log(`   Duration: ${new Date().toISOString()}`);
    console.log(`   Insights: ${consolidated.insights.length}`);
    console.log(`   Pruned: ${pruned.archived.length + pruned.removed.length}`);
    
    return {
      status: 'success',
      orient: orientState,
      memories: {
        qmdCount: memories.recentQMD.length
      },
      consolidated: consolidated.insights.length,
      pruned: pruned.archived.length + pruned.removed.length
    };
    
  } catch (error) {
    console.error('❌ Dream Mode error:', error);
    return { status: 'error', error: error.message };
  } finally {
    releaseLock();
  }
}

/**
 * Check if Dream Mode should run (called by heartbeat/cron)
 */
function shouldRun() {
  const lockPath = LOCK_FILE;
  
  if (!fs.existsSync(lockPath)) {
    return { shouldRun: true, reason: 'no_lock' };
  }
  
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    
    // Check if process is still alive
    try {
      process.kill(lock.pid, 0);
      const age = Date.now() - lock.mtime;
      if (age < STALE_THRESHOLD_MS) {
        return { shouldRun: false, reason: 'already_running', age };
      }
    } catch (e) {
      // Process dead, lock is stale
      return { shouldRun: true, reason: 'stale_lock', age: Date.now() - lock.mtime };
    }
    
    // Check age
    const age = Date.now() - lock.mtime;
    if (age > 24 * 60 * 60 * 1000) {
      return { shouldRun: true, reason: 'old_lock', age };
    }
    
    return { shouldRun: false, reason: 'recently_run', age };
  } catch (e) {
    return { shouldRun: true, reason: 'corrupt_lock' };
  }
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--check')) {
  const result = shouldRun();
  console.log(`Dream Mode check: ${result.shouldRun ? '✅ Should run' : '⏸️ Skip'}`);
  console.log(`Reason: ${result.reason}${result.age ? ` (age: ${Math.round(result.age/1000)}s)` : ''}`);
  process.exit(result.shouldRun ? 0 : 1);
} else if (args.includes('--help')) {
  console.log(`
dream_mode.mjs - Dream Mode Memory Consolidation

Usage:
  node dream_mode.mjs           Run Dream Mode
  node dream_mode.mjs --check    Check if should run
  node dream_mode.mjs --help     Show this help

Description:
  4-phase memory consolidation:
  1. Orient - Understand current state
  2. Gather - Collect recent memories
  3. Consolidate - Merge and synthesize
  4. Prune - Remove outdated info

Triggered by:
  - Cron job (recommended: every 24h)
  - Or manually
`);
  process.exit(0);
} else {
  runDreamMode().then(result => {
    console.log('\nResult:', JSON.stringify(result, null, 2));
  });
}

export { runDreamMode, shouldRun, acquireLock, releaseLock };
