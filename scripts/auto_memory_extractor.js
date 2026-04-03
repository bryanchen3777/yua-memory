#!/usr/bin/env node
/**
 * auto_memory_extractor.js - AI-driven Memory Extraction
 * 
 * Extracts important memories from LCM and writes to QMD
 * Uses Claude AI to identify significant memories
 * Includes deduplication to avoid duplicate memories
 * 
 * Usage: node auto_memory_extractor.js [hours]
 * 
 * Environment variables:
 *   OPENCLAW_DATA_DIR - Path to OpenClaw data directory (default: ~/.openclaw)
 *   QMD_MEMORIES_DIR   - QMD memories directory (default: qmd/memories)
 */

import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================
// Configuration
// ============================================================

const OPENCLAW_DATA_DIR = process.env.OPENCLAW_DATA_DIR || 
  (process.platform === 'win32' ? 'C:/Users/bbfcc/.openclaw' : '~/.openclaw');
const LCM_DB_NAME = process.env.LCM_DB_NAME || 'lcm.db';
const QMD_MEMORIES_DIR = join(OPENCLAW_DATA_DIR, process.env.QMD_MEMORIES_DIR || 'qmd/memories');
const LCM_DB = join(OPENCLAW_DATA_DIR, LCM_DB_NAME);

// Claude CLI configuration
const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH ||
  (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash');
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
// LCM Data Queries
// ============================================================

function getRecentMessages(hours = 48) {
  const database = getDb();
  if (!database) return [];
  
  try {
    const cutoff = Math.floor(Date.now() / 1000) - (hours * 3600);
    
    const messages = database.prepare(`
      SELECT m.id, m.conversation_id, m.role, m.content, m.created_at, c.title
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.created_at > ?
      ORDER BY m.created_at DESC
    `).all(cutoff);
    
    return messages.map(row => ({
      id: row.id,
      conversation_id: row.conversation_id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      title: row.title || 'Untitled'
    }));
  } catch (err) {
    console.error('getRecentMessages error:', err.message);
    return [];
  }
}

function getRecentSummaries(hours = 48) {
  const database = getDb();
  if (!database) return [];
  
  try {
    const cutoff = Math.floor(Date.now() / 1000) - (hours * 3600);
    
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
      title: row.title || 'Untitled'
    }));
  } catch (err) {
    console.error('getRecentSummaries error:', err.message);
    return [];
  }
}

// ============================================================
// Deduplication
// ============================================================

function isDuplicate(newMemory) {
  try {
    if (!existsSync(QMD_MEMORIES_DIR)) return false;
    
    const files = readdirSync(QMD_MEMORIES_DIR).filter(f => 
      f.startsWith('memory_') && f.endsWith('.md')
    );
    
    for (const file of files) {
      const filepath = join(QMD_MEMORIES_DIR, file);
      const content = readFileSync(filepath, 'utf8');
      
      // Get existing title
      const titleMatch = content.match(/^## (.+)$/m);
      if (!titleMatch) continue;
      const existingTitle = titleMatch[1].toLowerCase();
      
      // Get existing content
      const bodyMatch = content.replace(/^---[\s\S]*?---\n*/, '').replace(/^## .+\n*/, '').trim();
      const newTitle = (newMemory.title || '').toLowerCase();
      
      // Title similarity check
      if (calculateSimilarity(existingTitle, newTitle) > 0.7) {
        console.log(`   ⚠️  Skipped (similar title): "${newMemory.title}" ≈ "${existingTitle}"`);
        return true;
      }
      
      // Content keyword overlap
      const existingKeywords = extractSimpleKeywords(bodyMatch);
      const newKeywords = extractSimpleKeywords(newMemory.content || '');
      const overlap = existingKeywords.filter(k => newKeywords.includes(k));
      if (overlap.length >= 3 && overlap.length / newKeywords.length > 0.5) {
        console.log(`   ⚠️  Skipped (similar content): "${newMemory.title}"`);
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

function extractSimpleKeywords(text) {
  if (!text) return [];
  const words = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\w]{2,4}/g) || [];
  const stopWords = new Set(['的', '了', '是', '在', '有', '和', '與', '對', '這', '那', '什麼', '怎麼']);
  return [...new Set(words.filter(w => w.length >= 2 && !stopWords.has(w)))].slice(0, 20);
}

function calculateSimilarity(str1, str2) {
  const words1 = new Set(str1.split(/[\s\u4e00-\u9fff\u3400-\u4dbf]+/).filter(w => w.length > 0));
  const words2 = new Set(str2.split(/[\s\u4e00-\u9fff\u3400-\u4dbf]+/).filter(w => w.length > 0));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// ============================================================
// AI Memory Extraction
// ============================================================

async function extractMemoriesWithAI(messages, summaries) {
  if (messages.length === 0 && summaries.length === 0) {
    console.log('   No recent data to extract from');
    return [];
  }
  
  // Format conversation text (sanitize special characters)
  const convText = messages.slice(0, 50).map(m => {
    const sanitized = (m.content || '').replace(/---/g, '_Separator_').replace(/"/g, '\\"');
    return `[${m.role}] ${sanitized}`;
  }).join('\n');
  
  const summaryText = summaries.map(s => {
    const sanitized = (s.content || '').replace(/---/g, '_Separator_').replace(/"/g, '\\"');
    return `- ${sanitized}`;
  }).join('\n');
  
  const prompt = `You are a memory extraction expert. Analyze the following conversations and summaries and extract important memories.

## Format Requirements
Return a JSON array, each element representing one memory:
{
  "type": "user|feedback|project|reference",
  "title": "Memory title (brief description)",
  "content": "Detailed content (2-3 sentences)",
  "tags": ["tag1", "tag2"],
  "scope": "Private"
}

## Memory Types (must choose one)
- user: User preferences, habits (Bryan likes to use Claude)
- feedback: User feedback, guidance (Bryan said 'don't do that')
- project: Project status, technical decisions (what we're working on)
- reference: External pointers, URLs, documentation links

## Rules
- Extract only truly important memories
- Maximum 5 memories
- Maximum 3 tags
- Default scope is "Private"
- Content should have enough detail for future understanding

## What NOT to Extract
- Code patterns (can be derived from source code)
- Git history (use git log)
- Debugging solutions (fix is in code)
- Content already in documentation
- Temporary task details

## Conversations (recent messages):
${convText.substring(0, 3000)}

## Summaries (recent):
${summaryText.substring(0, 2000)}

Return JSON array only, no other text.`;

  try {
    // Write prompt to temp file
    const tmpPromptFile = join(process.env.TEMP || '/tmp', `memory_extract_prompt_${Date.now()}.txt`);
    writeFileSync(tmpPromptFile, prompt, 'utf8');
    
    // Build CLI command
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
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('AI extraction failed:', err.message);
    return [];
  }
}

// ============================================================
// QMD Writing
// ============================================================

let sequenceCounter = null;

function getNextSequence() {
  if (sequenceCounter === null) {
    try {
      if (!existsSync(QMD_MEMORIES_DIR)) {
        sequenceCounter = 1;
        return sequenceCounter;
      }
      
      const files = readdirSync(QMD_MEMORIES_DIR)
        .filter(f => f.startsWith('memory_') && f.endsWith('.md'))
        .map(f => {
          const match = f.match(/memory_(\d+)\.md/);
          return match ? parseInt(match[1], 10) : 0;
        });
      
      sequenceCounter = files.length > 0 ? Math.max(...files) + 1 : 1;
    } catch (err) {
      sequenceCounter = 1;
    }
  } else {
    sequenceCounter++;
  }
  
  return sequenceCounter;
}

function generateMemoryId() {
  return 'mem_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36).substring(6);
}

function writeMemoryToQMD(memory) {
  // Check for duplicate first
  if (isDuplicate(memory)) {
    return false;
  }
  
  const seq = getNextSequence();
  const filename = `memory_${String(seq).padStart(3, '0')}.md`;
  const filepath = join(QMD_MEMORIES_DIR, filename);
  const now = new Date().toISOString();
  const id = generateMemoryId();
  
  const content = `---
scope: ${memory.scope || 'Private'}
type: ${memory.type || 'user'}
memory_id: ${id}
created: ${now}
tags: [${(memory.tags || []).join(', ')}]
---

## ${memory.title}

${memory.content}

<!-- auto-extracted -->
`;

  try {
    if (!existsSync(QMD_MEMORIES_DIR)) {
      mkdirSync(QMD_MEMORIES_DIR, { recursive: true });
    }
    writeFileSync(filepath, content, 'utf8');
    console.log(`✅ Written: ${filename}`);
    return true;
  } catch (e) {
    console.error(`Failed to write ${filename}:`, e.message);
    return false;
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const hours = parseInt(process.argv[2]) || 48;
  
  console.log('🔍 Auto Memory Extraction');
  if (process.env.OPENCLAW_DATA_DIR) {
    console.log(`   Data dir: ${OPENCLAW_DATA_DIR}`);
  }
  
  // Fetch recent data
  const messages = getRecentMessages(hours);
  const summaries = getRecentSummaries(hours);
  
  console.log(`   Found ${messages.length} messages, ${summaries.length} summaries`);
  
  if (messages.length === 0 && summaries.length === 0) {
    console.log('   No recent data');
    return;
  }
  
  // Extract memories with AI
  console.log('🤖 Claude analyzing...');
  const extracted = await extractMemoriesWithAI(messages, summaries);
  
  if (extracted.length === 0) {
    console.log('   AI extraction failed or no important memories found');
    return;
  }
  
  console.log(`\n📝 Extracted ${extracted.length} memories:`);
  
  let written = 0;
  for (const memory of extracted) {
    if (writeMemoryToQMD(memory)) {
      written++;
    }
  }
  
  console.log(`\n✅ Successfully wrote ${written}/${extracted.length} memories`);
}

// Export for module use
export { extractMemoriesWithAI, writeMemoryToQMD, isDuplicate };

// Run if executed directly
main().catch(console.error);
