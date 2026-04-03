#!/usr/bin/env node
/**
 * reminisce_memory.js - Memory Query Engine
 * 
 * Queries relevant memories from LCM + QMD for context
 * Two modes:
 * 1. AI Selection (default): Ask Claude which memories are most relevant
 * 2. Keyword fallback: Simple keyword matching
 * 
 * Usage: node reminisce_memory.js "user input text" [hours]
 * 
 * Environment variables:
 *   OPENCLAW_DATA_DIR - Path to OpenClaw data directory (default: ~/.openclaw)
 *   LCM_DB_NAME - LCM database filename (default: lcm.db)
 *   QMD_MEMORIES_DIR - QMD memories directory name (default: qmd/memories)
 */

import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// Configuration - from environment variables
// ============================================================

function getEnvOrDefault(envKey, defaultValue) {
  const value = process.env[envKey];
  if (value) return value;
  
  // Expand ~ to home directory on Unix-like systems
  if (value && value.startsWith('~')) {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) return value.replace('~', home);
  }
  return defaultValue;
}

// Paths configuration
const OPENCLAW_DATA_DIR = getEnvOrDefault('OPENCLAW_DATA_DIR', '~/.openclaw');
const LCM_DB_NAME = process.env.LCM_DB_NAME || 'lcm.db';
const QMD_SUBDIR = process.env.QMD_MEMORIES_DIR || 'qmd/memories';

// Construct full paths
const LCM_DB = join(OPENCLAW_DATA_DIR, LCM_DB_NAME);
const QMD_MEMORIES_DIR = join(OPENCLAW_DATA_DIR, QMD_SUBDIR);

// Claude CLI path (configurable)
const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH || 
  (process.platform === 'win32' 
    ? 'C:/Program Files/Git/bin/bash.exe'
    : '/bin/bash');

const CLAUDE_SCRIPT_PATH = process.env.CLAUDE_SCRIPT_PATH ||
  (process.platform === 'win32'
    ? 'C:/Users/bbfcc/.gemini/antigravity/claude-code-haha/bin/claude-haha'
    : '~/.gemini/antigravity/claude-code-haha/bin/claude-haha');

// ============================================================
// Database Connection
// ============================================================

let db = null;

function getDb() {
  if (db) return db;
  
  if (!existsSync(LCM_DB)) {
    console.error(`LCM database not found: ${LCM_DB}`);
    console.error('Set OPENCLAW_DATA_DIR environment variable');
    return null;
  }
  
  try {
    db = new DatabaseSync(LCM_DB, { readonly: true });
    return db;
  } catch (err) {
    console.error('Failed to open LCM database:', err.message);
    return null;
  }
}

// ============================================================
// QMD Memory Reader
// ============================================================

/**
 * Read all memories from QMD memories directory
 */
function getQMDMemories() {
  try {
    if (!existsSync(QMD_MEMORIES_DIR)) {
      return [];
    }
    
    const files = readdirSync(QMD_MEMORIES_DIR).filter(f => 
      f.startsWith('memory_') && f.endsWith('.md')
    );
    
    return files.map(filename => {
      const filepath = join(QMD_MEMORIES_DIR, filename);
      const content = readFileSync(filepath, 'utf8');
      
      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let frontmatter = {};
      
      if (frontmatterMatch) {
        const fmText = frontmatterMatch[1];
        fmText.split('\n').forEach(line => {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).trim();
            let value = line.substring(colonIdx + 1).trim();
            if (value.startsWith('[') && value.endsWith(']')) {
              value = value.slice(1, -1).split(',').map(v => v.trim());
            }
            frontmatter[key] = value;
          }
        });
      }
      
      // Get title and content
      const titleMatch = content.match(/^## (.+)$/m);
      const title = titleMatch ? titleMatch[1] : filename;
      const bodyContent = content.replace(/^---[\s\S]*?---\n*/, '').replace(/^## .+\n*/, '').trim();
      
      return {
        id: frontmatter.memory_id || filename.replace('.md', ''),
        source: 'qmd',
        title: title,
        content: bodyContent.substring(0, 300),
        scope: frontmatter.scope || 'Private',
        tags: frontmatter.tags || [],
        created: frontmatter.created || null,
        filename: filename
      };
    });
  } catch (err) {
    console.error('getQMDMemories error:', err.message);
    return [];
  }
}

// ============================================================
// LCM Memory Query
// ============================================================

/**
 * Query LCM for recent conversations
 */
function queryLCM(hours = 48) {
  const database = getDb();
  if (!database) return [];
  
  try {
    const cutoff = Math.floor(Date.now() / 1000) - (hours * 3600);
    
    // Query recent summaries
    const summaries = database.prepare(`
      SELECT s.id, s.conversation_id, s.content, s.created_at, c.title
      FROM summaries s
      JOIN conversations c ON s.conversation_id = c.id
      WHERE s.created_at > ?
      ORDER BY s.created_at DESC
    `).all(cutoff);
    
    return summaries.map(row => ({
      id: row.id,
      conversation_id: row.conversation_id,
      content: row.content,
      created_at: row.created_at,
      title: row.title || 'Untitled',
      source: 'lcm'
    }));
  } catch (err) {
    console.error('LCM query error:', err.message);
    return [];
  }
}

/**
 * Query LCM for messages (returns last N messages)
 */
function queryLCMMessages(limit = 100) {
  const database = getDb();
  if (!database) return [];
  
  try {
    const messages = database.prepare(`
      SELECT m.id, m.conversation_id, m.role, m.content, m.created_at, c.title
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(limit);
    
    return messages.map(row => ({
      id: row.id,
      conversation_id: row.conversation_id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      title: row.title || 'Untitled',
      source: 'lcm'
    }));
  } catch (err) {
    console.error('LCM messages query error:', err.message);
    return [];
  }
}

// ============================================================
// AI Memory Selection (Claude CLI)
// ============================================================

async function selectMemoriesWithAI(memories, userQuery) {
  if (memories.length === 0) return [];
  
  // Build prompt
  const memoryList = memories.map((m, i) => 
    `[${i}] ${m.title}\n   Type: ${m.source}\n   Preview: ${(m.content || '').substring(0, 100)}...`
  ).join('\n\n');
  
  const prompt = `Given the user's message: "${userQuery}"

Select the most relevant memories (by index number) that would help respond to this message.

Memories:
${memoryList}

Respond with ONLY a JSON array of indices, like: [0, 2, 5]
Select 0-5 memories. If none are relevant, respond with: []
Do not include any other text.`;

  try {
    // Write prompt to temp file for claude
    const tmpPromptFile = join(process.env.TEMP || '/tmp', `reminisce_prompt_${Date.now()}.txt`);
    writeFileSync(tmpPromptFile, prompt, 'utf8');
    
    // Build CLI command based on platform
    let cmd;
    if (process.platform === 'win32') {
      const expandedScriptPath = CLAUDE_SCRIPT_PATH.replace(/^C:/, '/c').replace(/\\/g, '/');
      cmd = `powershell -Command "& '${CLAUDE_CLI_PATH}' '${expandedScriptPath}' --bare --dangerously-skip-permissions --output-format=json --print @'${tmpPromptFile}'"`;
    } else {
      cmd = `${CLAUDE_CLI_PATH} ${CLAUDE_SCRIPT_PATH} --bare --dangerously-skip-permissions --output-format=json --print @${tmpPromptFile}`;
    }
    
    const result = await new Promise((resolve, reject) => {
      const child = spawn('cmd.exe', ['/c', cmd], { shell: true });
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
      
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`CLI exited with code ${code}`));
      });
      child.on('error', reject);
    });
    
    // Clean up temp file
    try { unlinkSync(tmpPromptFile); } catch (e) {}
    
    // Parse JSON response
    let cleaned = result.trim();
    // Remove markdown fences if present
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    
    const parsed = JSON.parse(cleaned);
    const indices = Array.isArray(parsed) ? parsed : [];
    
    return indices.map(i => memories[i]).filter(Boolean);
  } catch (err) {
    console.error('AI selection failed:', err.message);
    return []; // Return empty on failure
  }
}

// ============================================================
// Keyword Fallback Search
// ============================================================

function searchByKeywords(memories, userQuery) {
  const keywords = userQuery.toLowerCase().match(/[\u4e00-\u9fff\u3400-\u4dbf\w]{2,}/g) || [];
  if (keywords.length === 0) return [];
  
  return memories.filter(m => {
    const text = `${m.title} ${m.content} ${(m.tags || []).join(' ')}`.toLowerCase();
    return keywords.some(k => text.includes(k));
  }).slice(0, 5);
}

// ============================================================
// Main Query Function
// ============================================================

async function queryMemories(userQuery, hours = 48) {
  console.log('🔍 Memory Query');
  console.log(`   Query: "${userQuery}"`);
  
  // Get memories from both sources
  const lcmSummaries = queryLCM(hours);
  const lcmMessages = queryLCMMessages(100);
  const qmdMemories = getQMDMemories();
  
  console.log(`   LCM: ${lcmSummaries.length} summaries, ${lcmMessages.length} messages`);
  console.log(`   QMD: ${qmdMemories.length} memories`);
  
  // Combine all memories
  const allMemories = [
    ...lcmSummaries.map(s => ({ ...s, title: s.title || 'Summary', content: s.content })),
    ...qmdMemories
  ];
  
  if (allMemories.length === 0) {
    console.log('   No memories found');
    return [];
  }
  
  // Try AI selection first
  let selected = await selectMemoriesWithAI(allMemories, userQuery);
  
  // Fallback to keyword search
  if (selected.length === 0) {
    console.log('   Fallback: keyword search');
    selected = searchByKeywords(allMemories, userQuery);
  }
  
  console.log(`   Selected: ${selected.length} memories`);
  
  return selected;
}

// ============================================================
// CLI Entry Point
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
reminisce_memory.js - Query relevant memories from LCM + QMD

Usage:
  node reminisce_memory.js "user message" [hours]

Environment variables:
  OPENCLAW_DATA_DIR  - OpenClaw data directory (default: ~/.openclaw)
  LCM_DB_NAME        - LCM database filename (default: lcm.db)
  QMD_MEMORIES_DIR   - QMD memories subdirectory (default: qmd/memories)
  CLAUDE_CLI_PATH    - Path to bash (Windows) or leave empty (Unix)
  CLAUDE_SCRIPT_PATH - Path to claude-haha script

Example:
  OPENCLAW_DATA_DIR=~/.openclaw node reminisce_memory.js "還記得我們上次..." 48
`);
    process.exit(0);
  }
  
  const userQuery = args[0];
  const hours = parseInt(args[1]) || 48;
  
  const memories = await queryMemories(userQuery, hours);
  
  if (memories.length > 0) {
    console.log('\n📝 Relevant memories:');
    memories.forEach((m, i) => {
      console.log(`\n[${i + 1}] ${m.title}`);
      console.log(`    Source: ${m.source} | Scope: ${m.scope || 'N/A'}`);
      console.log(`    ${(m.content || '').substring(0, 150)}...`);
    });
  }
  
  return memories;
}

// Export for use as module
export { queryMemories, getQMDMemories, queryLCM };

// Run if executed directly
main().catch(console.error);
