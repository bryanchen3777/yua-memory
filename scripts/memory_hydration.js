#!/usr/bin/env node
/**
 * memory_hydration.js - Session Startup Memory Loader
 * 
 * Loads important memories on session startup
 * Called from AGENTS.md startup sequence
 * 
 * Usage: node memory_hydration.js --agent Tim --scope All
 * 
 * Environment variables:
 *   OPENCLAW_DATA_DIR - Path to OpenClaw data directory
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================
// Configuration
// ============================================================

const OPENCLAW_DATA_DIR = process.env.OPENCLAW_DATA_DIR || 
  (process.platform === 'win32' ? 'C:/Users/bbfcc/.openclaw' : '~/.openclaw');

const QMD_DIR = join(OPENCLAW_DATA_DIR, 'qmd');

// Default agent
const DEFAULT_AGENT = 'Tim';
const DEFAULT_SCOPE = 'All';

// ============================================================
// Memory Reading
// ============================================================

function readQMDFiles(agent, scope) {
  const memories = {
    highPriority: [],
    technicalContext: [],
    recentMemories: [],
    otherMemories: []
  };
  
  // Possible QMD directories
  const possibleDirs = [
    join(QMD_DIR, 'memories'),
    join(QMD_DIR, 'identity'),
    join(QMD_DIR, 'rules'),
    join(QMD_DIR, 'technical')
  ];
  
  for (const dir of possibleDirs) {
    if (!existsSync(dir)) continue;
    
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      
      for (const file of files) {
        const filepath = join(dir, file);
        const content = readFileSync(filepath, 'utf8');
        
        // Parse frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) continue;
        
        const frontmatter = {};
        frontmatterMatch[1].split('\n').forEach(line => {
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
        
        // Check scope (Shared is visible to all)
        const fileScope = frontmatter.scope || 'Shared';
        const canRead = 
          fileScope === 'Shared' ||
          fileScope === `Private:${agent}` ||
          fileScope === scope ||
          scope === 'All';
        
        if (!canRead) continue;
        
        // Get title and content
        const titleMatch = content.match(/^## (.+)$/m);
        const title = titleMatch ? titleMatch[1] : file;
        const bodyContent = content.replace(/^---[\s\S]*?---\n*/, '').replace(/^## .+\n*/, '').trim();
        
        const memoryEntry = {
          title,
          content: bodyContent.substring(0, 500),
          scope: fileScope,
          tags: frontmatter.tags || [],
          type: frontmatter.type || 'general',
          created: frontmatter.created || null
        };
        
        // Categorize by tags or type
        const tags = (frontmatter.tags || []).map(t => t.toLowerCase());
        const type = (frontmatter.type || '').toLowerCase();
        
        if (tags.includes('high-priority') || tags.includes('#priority/high')) {
          memories.highPriority.push(memoryEntry);
        } else if (type === 'technical' || type === 'project' || tags.includes('技術')) {
          memories.technicalContext.push(memoryEntry);
        } else if (tags.includes('recent') || tags.includes('最新')) {
          memories.recentMemories.push(memoryEntry);
        } else {
          memories.otherMemories.push(memoryEntry);
        }
      }
    } catch (err) {
      // Directory read error, skip
    }
  }
  
  return memories;
}

function getRecentLCMSummaries(hours = 24, limit = 5) {
  // This is a simplified version - full implementation would use SQLite
  // For now, return placeholder
  return [];
}

// ============================================================
// Output Formatter
// ============================================================

function formatMemorySection(title, memories, limit = 5) {
  if (memories.length === 0) return '';
  
  const items = memories.slice(0, limit).map(m => 
    `**${m.title}**\n   ${m.content.substring(0, 200)}...`
  ).join('\n\n');
  
  return `### ${title}\n${items}\n`;
}

function formatOutput(memories, agent, scope) {
  let output = `# Memory Hydration - ${agent}\n`;
  output += `*Loaded at ${new Date().toISOString()}*\n\n`;
  
  if (memories.highPriority.length > 0) {
    output += formatMemorySection('🚨 HIGH PRIORITY ITEMS', memories.highPriority);
  }
  
  if (memories.technicalContext.length > 0) {
    output += formatMemorySection('🔧 TECHNICAL CONTEXT', memories.technicalContext);
  }
  
  if (memories.recentMemories.length > 0) {
    output += formatMemorySection('📝 RECENT MEMORIES', memories.recentMemories);
  }
  
  if (memories.otherMemories.length > 0) {
    output += formatMemorySection('📚 OTHER MEMORIES', memories.otherMemories, 3);
  }
  
  return output;
}

// ============================================================
// Main
// ============================================================

function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let agent = DEFAULT_AGENT;
  let scope = DEFAULT_SCOPE;
  let jsonOutput = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) {
      agent = args[i + 1];
      i++;
    } else if (args[i] === '--scope' && args[i + 1]) {
      scope = args[i + 1];
      i++;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
memory_hydration.js - Session Startup Memory Loader

Usage:
  node memory_hydration.js [options]

Options:
  --agent <name>   Agent name (default: Tim)
  --scope <scope>  Scope filter (default: All)
  --json           Output as JSON
  --help, -h       Show this help

Environment variables:
  OPENCLAW_DATA_DIR  Path to OpenClaw data directory

Example:
  node memory_hydration.js --agent Yua --scope All
`);
      process.exit(0);
    }
  }
  
  console.log(`Loading memories for ${agent} (scope: ${scope})...`);
  
  const memories = readQMDFiles(agent, scope);
  
  const summary = {
    agent,
    scope,
    loadedAt: new Date().toISOString(),
    counts: {
      highPriority: memories.highPriority.length,
      technical: memories.technicalContext.length,
      recent: memories.recentMemories.length,
      other: memories.otherMemories.length
    }
  };
  
  if (jsonOutput) {
    console.log(JSON.stringify({ summary, memories }, null, 2));
  } else {
    console.log(`\n📊 Loaded:`);
    console.log(`   High Priority: ${summary.counts.highPriority}`);
    console.log(`   Technical: ${summary.counts.technical}`);
    console.log(`   Recent: ${summary.counts.recent}`);
    console.log(`   Other: ${summary.counts.other}`);
    
    const output = formatOutput(memories, agent, scope);
    if (output) {
      console.log('\n' + output);
    }
  }
  
  return memories;
}

// Export for module use
export { readQMDFiles, getRecentLCMSummaries };

// Run if executed directly
main();
