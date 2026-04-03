/**
 * session_memory.mjs
 * 
 * Utility to update Session Memory during active sessions.
 * This allows tracking current state without disrupting workflow.
 * 
 * Usage:
 *   node session_memory.mjs --section "Current State" --content "Working on X"
 *   node session_memory.mjs --section "Worklog" --append "- Did task A"
 *   node session_memory.mjs --read
 *   node session_memory.mjs --read "Current State"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_MEMORY_PATH = path.join(__dirname, 'memory', 'session.md');

const SECTIONS = [
  'Session Title',
  'Current State', 
  'Task Specification',
  'Files & Functions',
  'Workflow',
  'Errors & Corrections',
  'System Documentation',
  'Learnings',
  'Key Results',
  'Worklog'
];

/**
 * Read the entire session memory file
 */
function readSessionMemory() {
  if (!fs.existsSync(SESSION_MEMORY_PATH)) {
    return null;
  }
  return fs.readFileSync(SESSION_MEMORY_PATH, 'utf8');
}

/**
 * Read a specific section
 */
function readSection(sectionName) {
  const content = readSessionMemory();
  if (!content) return null;
  
  const lines = content.split('\n');
  let inSection = false;
  let sectionContent = [];
  let foundSection = false;
  
  for (const line of lines) {
    if (line.startsWith('## ') && line !== '## ' + sectionName) {
      if (foundSection) break; // Entered next section
      inSection = false;
    }
    if (line.startsWith('## ') && line.includes(sectionName)) {
      inSection = true;
      foundSection = true;
      continue;
    }
    if (inSection) {
      sectionContent.push(line);
    }
  }
  
  return sectionContent.join('\n').trim();
}

/**
 * Update or append to a section
 */
function updateSection(sectionName, content, append = false) {
  let fileContent = readSessionMemory();
  
  if (!fileContent) {
    // Initialize with template
    fileContent = `# Session Memory

> Last updated: ${new Date().toISOString()}
> Agent: Tim

---

## Session Title

-

## Current State


## Task Specification


## Files & Functions


## Workflow


## Errors & Corrections


## System Documentation


## Learnings


## Key Results


## Worklog


`;
  }
  
  // Find the section
  const lines = fileContent.split('\n');
  let sectionStart = -1;
  let sectionEnd = -1;
  let foundSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ') && line.includes(sectionName)) {
      sectionStart = i + 1;
      foundSection = true;
      continue;
    }
    if (foundSection && line.startsWith('## ')) {
      sectionEnd = i - 1;
      break;
    }
  }
  
  if (sectionStart === -1) {
    console.error(`Section "${sectionName}" not found`);
    return false;
  }
  
  if (sectionEnd === -1) {
    sectionEnd = lines.length - 1;
  }
  
  // Preserve the ## header but replace content
  const header = lines[sectionStart - 1];
  let newLines;
  
  if (append) {
    // Append to existing content
    const existingContent = lines.slice(sectionStart, sectionEnd + 1).join('\n');
    newLines = existingContent + '\n' + content;
  } else {
    newLines = content;
  }
  
  // Rebuild file
  const before = lines.slice(0, sectionStart);
  const after = lines.slice(sectionEnd + 1);
  
  // Update timestamp
  let newContent;
  if (append) {
    newContent = [...before, newLines, ...after].join('\n');
  } else {
    newContent = [...before, newLines, ...after].join('\n');
  }
  
  // Update timestamp in header
  const timestamp = new Date().toISOString();
  newContent = newContent.replace(
    /> Last updated: .*/,
    `> Last updated: ${timestamp}`
  );
  
  fs.writeFileSync(SESSION_MEMORY_PATH, newContent, 'utf8');
  return true;
}

/**
 * Quick update helpers
 */
function quickUpdate(field, value) {
  const sectionMap = {
    'title': 'Session Title',
    'state': 'Current State',
    'task': 'Task Specification',
    'files': 'Files & Functions',
    'workflow': 'Workflow',
    'errors': 'Errors & Corrections',
    'docs': 'System Documentation',
    'learnings': 'Learnings',
    'results': 'Key Results',
    'log': 'Worklog'
  };
  
  const section = sectionMap[field.toLowerCase()];
  if (!section) {
    console.error(`Unknown field: ${field}`);
    console.error(`Valid fields: ${Object.keys(sectionMap).join(', ')}`);
    return false;
  }
  
  return updateSection(section, value);
}

// CLI
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help')) {
  console.log(`
session_memory.mjs - Session Memory utility

Usage:
  node session_memory.mjs --read                    Read entire session memory
  node session_memory.mjs --read "Section Name"    Read specific section
  node session_memory.mjs --update "Section" "content"   Update a section
  node session_memory.mjs --append "Section" "content"   Append to section
  node session_memory.mjs --quick <field> "content"       Quick update

Fields:
  title, state, task, files, workflow, errors, docs, learnings, results, log

Examples:
  node session_memory.mjs --read
  node session_memory.mjs --read "Current State"
  node session_memory.mjs --update "Current State" "Working on OpenClaw upgrade"
  node session_memory.mjs --quick state "Finished the OpenClaw upgrade"
  node session_memory.mjs --append "Worklog" "- Completed task A"
`);
  process.exit(0);
}

let success = false;

if (args[0] === '--read') {
  if (args[1]) {
    const section = args.slice(1).join(' ');
    const content = readSection(section);
    console.log(content || '(not found)');
  } else {
    console.log(readSessionMemory());
  }
  success = true;
} else if (args[0] === '--update') {
  const section = args[1];
  const content = args.slice(2).join(' ');
  success = updateSection(section, content);
} else if (args[0] === '--append') {
  const section = args[1];
  const content = args.slice(2).join(' ');
  success = updateSection(section, content, true);
} else if (args[0] === '--quick') {
  const field = args[1];
  const content = args.slice(2).join(' ');
  success = quickUpdate(field, content);
}

if (success) {
  console.log('✅ Session memory updated');
} else {
  console.log('❌ Failed to update session memory');
}

export { readSessionMemory, readSection, updateSection, quickUpdate };
