/**
 * fork_agent.mjs
 * 
 * Fork Agent Pattern - Context packaging for spawned sub-agents
 * Inspired by Claude Code's runForkedAgent()
 * 
 * This script provides:
 * 1. Context packaging utilities for forked agents
 * 2. Fork state management (saves to memory/forks/)
 * 3. Pattern documentation and helpers
 * 
 * Usage:
 *   node fork_agent.mjs --package "<task>"      Create context package
 *   node fork_agent.mjs --status                List all forks
 *   node fork_agent.mjs --info <id>             Get fork details
 *   node fork_agent.mjs --kill <id>             Kill/delete a fork
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const WORKSPACE = 'C:/Users/bbfcc/.openclaw/workspace-tim';
const FORK_STATE_DIR = path.join(WORKSPACE, 'memory', 'forks');
const QMD_DIR = 'C:/Users/bbfcc/.openclaw/workspace/qmd';

// Settings
const MAX_TURNS = 5;
const FORK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Ensure fork state directory exists
 */
function ensureForkDir() {
  if (!fs.existsSync(FORK_STATE_DIR)) {
    fs.mkdirSync(FORK_STATE_DIR, { recursive: true });
  }
}

/**
 * Package current context for fork transfer
 * This creates the context object that would be passed to a spawned agent
 */
function packageContext(options = {}) {
  const context = {
    timestamp: new Date().toISOString(),
    workspace: WORKSPACE,
    session: {
      type: 'forked',
      parentSession: options.parentSession || 'main',
      reason: options.reason || 'manual_fork'
    },
    recentMemories: [],
    currentTask: options.task || 'Unspecified task',
    constraints: options.constraints || [],
    agent: options.agent || 'tim',
    maxTurns: options.maxTurns || MAX_TURNS,
    timeoutMs: options.timeoutMs || FORK_TIMEOUT_MS
  };
  
  // Load recent QMD memories
  if (fs.existsSync(QMD_DIR)) {
    const categories = fs.readdirSync(QMD_DIR);
    
    for (const cat of categories) {
      const catPath = path.join(QMD_DIR, cat);
      if (!fs.statSync(catPath).isDirectory()) continue;
      
      const files = fs.readdirSync(catPath).filter(f => f.endsWith('.md')).slice(-3);
      
      for (const file of files) {
        const filePath = path.join(catPath, file);
        const stat = fs.statSync(filePath);
        const age = Date.now() - stat.mtime.getTime();
        
        // Only include memories from last 7 days
        if (age < 7 * 24 * 60 * 60 * 1000) {
          const content = fs.readFileSync(filePath, 'utf8');
          context.recentMemories.push({
            category: cat,
            file,
            summary: content.substring(0, 500)
          });
        }
      }
    }
  }
  
  // Load session memory if exists
  const sessionMemoryPath = path.join(WORKSPACE, 'memory', 'session.md');
  if (fs.existsSync(sessionMemoryPath)) {
    context.sessionMemory = fs.readFileSync(sessionMemoryPath, 'utf8');
  }
  
  return context;
}

/**
 * Build prompt for forked agent with context
 * This is the actual prompt that would be passed to sessions_spawn
 */
function buildForkPrompt(task, context) {
  let prompt = `# Forked Agent Context

## Task
${task}

## Agent Info
- Target Agent: ${context.agent}
- Workspace: ${context.workspace}
- Fork Reason: ${context.session.reason}
- Parent Session: ${context.session.parentSession}
- Max Turns: ${context.maxTurns}
- Timeout: ${context.timeoutMs / 1000 / 60} minutes

## Recent Memories (Last 7 days)
`;

  if (context.recentMemories.length > 0) {
    for (const mem of context.recentMemories) {
      prompt += `\n### ${mem.category}/${mem.file}\n${mem.summary}\n`;
    }
  } else {
    prompt += '\nNo recent memories.\n';
  }

  if (context.sessionMemory) {
    prompt += `
## Current Session Memory
${context.sessionMemory}
`;
  }

  prompt += `
## Instructions
1. Complete the task assigned above
2. You have ${context.maxTurns} turns maximum
3. When done, summarize your findings/results
4. Do NOT access sensitive secrets - use the Secret Scanner patterns if unsure

## Constraints
- Read-only operations preferred for安全
- If you need to modify files, ask parent agent first
- Report progress every 2 turns
`;

  return prompt;
}

/**
 * Save fork state to disk
 */
function saveForkState(forkId, state) {
  ensureForkDir();
  const statePath = path.join(FORK_STATE_DIR, `${forkId}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Load fork state from disk
 */
function loadForkState(forkId) {
  const statePath = path.join(FORK_STATE_DIR, `${forkId}.json`);
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

/**
 * Delete fork state
 */
function deleteForkState(forkId) {
  const statePath = path.join(FORK_STATE_DIR, `${forkId}.json`);
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}

/**
 * List all active forks
 */
function listForks() {
  ensureForkDir();
  const files = fs.readdirSync(FORK_STATE_DIR).filter(f => f.endsWith('.json'));
  const forks = [];
  
  for (const file of files) {
    const forkId = file.replace('.json', '');
    const state = loadForkState(forkId);
    if (state) {
      forks.push({
        forkId,
        createdAt: state.createdAt,
        task: state.task,
        turns: state.turns || 0,
        maxTurns: state.maxTurns || MAX_TURNS,
        status: state.status || 'unknown',
        promptPreview: (state.prompt || '').substring(0, 100)
      });
    }
  }
  
  return forks;
}

/**
 * Create a fork package (for use with sessions_spawn tool)
 */
function createForkPackage(task, options = {}) {
  const forkId = `fork_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  // Package context
  const context = packageContext({
    task,
    parentSession: options.parentSession || 'main',
    reason: options.reason || 'manual_fork',
    agent: options.agent || 'tim'
  });
  
  // Build prompt
  const prompt = buildForkPrompt(task, context);
  
  // Create fork state
  const forkState = {
    forkId,
    createdAt: new Date().toISOString(),
    task,
    context,
    prompt,
    turns: 0,
    maxTurns: context.maxTurns,
    timeoutMs: context.timeoutMs,
    status: 'ready',
    agent: options.agent || 'tim'
  };
  
  saveForkState(forkId, forkState);
  
  return {
    forkId,
    status: 'ready',
    prompt,
    context,
    usage: `Use sessions_spawn with task="${prompt.substring(0, 50)}..." and label="fork:${forkId}"`
  };
}

/**
 * Get fork status
 */
function getForkStatus(forkId) {
  const state = loadForkState(forkId);
  if (!state) {
    return { success: false, error: 'Fork not found' };
  }
  
  return {
    success: true,
    fork: {
      forkId: state.forkId,
      createdAt: state.createdAt,
      task: state.task,
      turns: state.turns,
      maxTurns: state.maxTurns,
      status: state.status,
      prompt: state.prompt ? state.prompt.substring(0, 200) + '...' : null
    }
  };
}

/**
 * Kill/delete a fork
 */
function killFork(forkId) {
  const state = loadForkState(forkId);
  if (!state) {
    return { success: false, error: 'Fork not found' };
  }
  
  state.status = 'killed';
  state.killedAt = new Date().toISOString();
  saveForkState(forkId, state);
  
  return { success: true, forkId, message: `Fork ${forkId} marked as killed` };
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
fork_agent.mjs - Fork Agent Pattern

Usage:
  node fork_agent.mjs --package "<task>"     Create context package for spawn
  node fork_agent.mjs --status               List all forks
  node fork_agent.mjs --info <id>            Get fork details
  node fork_agent.mjs --kill <id>            Kill/delete a fork
  node fork_agent.mjs --prompt "<task>"      Preview the fork prompt
  node fork_agent.mjs --help                 Show this help

Fork Agent Pattern (for OpenClaw agents):
─────────────────────────────────────────────
This script packages context for spawning sub-agents using sessions_spawn.

Pattern:
1. Use --package to create a fork context
2. Use sessions_spawn with the returned prompt
3. Fork state is saved to memory/forks/

Example (in an OpenClaw agent):
  const fork = createForkPackage("Review PR #123");
  const result = await sessions_spawn({
    task: fork.prompt,
    label: fork.forkId,
    mode: "run",
    runtime: "subagent"
  });

CLI Example:
  node fork_agent.mjs --package "Review PR #123"
  node fork_agent.mjs --status
  node fork_agent.mjs --info fork_123456_abc123
`);
  process.exit(0);
} else if (args.includes('--package')) {
  const taskIndex = args.indexOf('--package');
  const task = args.slice(taskIndex + 1).join(' ');
  
  if (!task) {
    console.error('Error: --package requires a task argument');
    process.exit(1);
  }
  
  console.log(`🍴 Creating fork package for: ${task}\n`);
  
  const fork = createForkPackage(task);
  
  console.log('Fork Package Created:');
  console.log('═'.repeat(50));
  console.log(`Fork ID: ${fork.forkId}`);
  console.log(`Status: ${fork.status}`);
  console.log(`Max Turns: ${fork.context.maxTurns}`);
  console.log(`Timeout: ${fork.context.timeoutMs / 1000 / 60} minutes`);
  console.log('\nUse with sessions_spawn:');
  console.log(fork.usage);
  console.log('\nFull prompt saved to memory/forks/' + fork.forkId + '.json');
  
} else if (args.includes('--prompt')) {
  const taskIndex = args.indexOf('--prompt');
  const task = args.slice(taskIndex + 1).join(' ');
  
  if (!task) {
    console.error('Error: --prompt requires a task argument');
    process.exit(1);
  }
  
  const context = packageContext({ task });
  const prompt = buildForkPrompt(task, context);
  
  console.log('Generated Fork Prompt:');
  console.log('═'.repeat(50));
  console.log(prompt);
  
} else if (args.includes('--status')) {
  const forks = listForks();
  console.log('🍴 Active Forks');
  console.log('═'.repeat(50));
  
  if (forks.length === 0) {
    console.log('No active forks.');
  } else {
    for (const fork of forks) {
      console.log(`\n${fork.forkId}`);
      console.log(`  Task: ${fork.task}`);
      console.log(`  Status: ${fork.status}`);
      console.log(`  Turns: ${fork.turns}/${fork.maxTurns}`);
      console.log(`  Created: ${fork.createdAt}`);
    }
  }
} else if (args.includes('--info')) {
  const idIndex = args.indexOf('--info');
  const forkId = args[idIndex + 1];
  
  if (!forkId) {
    console.error('Error: --info requires a fork ID');
    process.exit(1);
  }
  
  const result = getForkStatus(forkId);
  if (!result.success) {
    console.log(`Error: ${result.error}`);
    process.exit(1);
  }
  
  console.log('Fork Details:');
  console.log(JSON.stringify(result.fork, null, 2));
} else if (args.includes('--kill')) {
  const idIndex = args.indexOf('--kill');
  const forkId = args[idIndex + 1];
  
  if (!forkId) {
    console.error('Error: --kill requires a fork ID');
    process.exit(1);
  }
  
  const result = killFork(forkId);
  console.log(result.success ? `✅ ${result.message}` : `❌ ${result.error}`);
} else {
  console.log('Fork Agent Pattern - CLI');
  console.log('═'.repeat(50));
  console.log('Use --help for usage information');
  console.log('\nExamples:');
  console.log('  node fork_agent.mjs --package "Review PR #123"');
  console.log('  node fork_agent.mjs --prompt "Analyze this code"');
  console.log('  node fork_agent.mjs --status');
  console.log('  node fork_agent.mjs --info <fork_id>');
  console.log('  node fork_agent.mjs --kill <fork_id>');
}

export { 
  createForkPackage, 
  listForks, 
  getForkStatus, 
  killFork,
  packageContext,
  buildForkPrompt,
  MAX_TURNS 
};
