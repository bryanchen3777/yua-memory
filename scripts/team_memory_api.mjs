/**
 * team_memory_api.mjs
 * 
 * Team Memory REST API - Share memories across agents
 * Features:
 * - REST API for CRUD operations
 * - Version-based conflict detection
 * - Automatic merge strategies
 * - Sync status endpoint
 * 
 * Usage:
 *   node team_memory_api.mjs              Start server (default port 3847)
 *   node team_memory_api.mjs --port 8080  Start on specific port
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const WORKSPACE = 'C:/Users/bbfcc/.openclaw/workspace-tim';
const TEAM_MEMORY_DIR = path.join(WORKSPACE, 'memory', 'team');
const TEAM_DB_FILE = path.join(TEAM_MEMORY_DIR, 'memories.json');

// Settings
const DEFAULT_PORT = 3847;
const VERSION_BUMP_MS = 1000; // Minimum ms between version bumps

/**
 * Ensure team memory directory exists
 */
function ensureTeamDir() {
  if (!fs.existsSync(TEAM_MEMORY_DIR)) {
    fs.mkdirSync(TEAM_MEMORY_DIR, { recursive: true });
  }
  if (!fs.existsSync(TEAM_DB_FILE)) {
    fs.writeFileSync(TEAM_DB_FILE, JSON.stringify({ memories: [], version: 1 }, null, 2));
  }
}

/**
 * Load team memories database
 */
function loadDB() {
  ensureTeamDir();
  return JSON.parse(fs.readFileSync(TEAM_DB_FILE, 'utf8'));
}

/**
 * Save team memories database
 */
function saveDB(db) {
  ensureTeamDir();
  fs.writeFileSync(TEAM_DB_FILE, JSON.stringify(db, null, 2));
}

/**
 * Generate unique ID
 */
function generateId() {
  return `mem_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Calculate content hash for conflict detection
 */
function hashContent(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex').substring(0, 16);
}

/**
 * Detect conflict between versions
 */
function detectConflict(local, incoming) {
  if (!local.version || !incoming.version) return false;
  if (local.version !== incoming.version) {
    // Check if content actually changed
    const localHash = hashContent(local.content);
    const incomingHash = hashContent(incoming.content);
    return localHash !== incomingHash;
  }
  return false;
}

/**
 * Merge strategies
 */
const MergeStrategy = {
  /**
   * Last-write-wins: newer timestamp takes precedence
   */
  LAST_WRITE_WINS: 'last_write_wins',
  
  /**
   * Keep both versions as separate entries
   */
  KEEP_BOTH: 'keep_both',
  
  /**
   * Keep newer, but preserve metadata from both
   */
  MERGE_METADATA: 'merge_metadata'
};

/**
 * Merge two memory versions
 */
function mergeMemory(existing, incoming, strategy = MergeStrategy.LAST_WRITE_WINS) {
  const existingTime = new Date(existing.updatedAt || existing.createdAt).getTime();
  const incomingTime = new Date(incoming.updatedAt || incoming.createdAt).getTime();
  
  if (strategy === MergeStrategy.LAST_WRITE_WINS) {
    if (incomingTime > existingTime) {
      return {
        ...incoming,
        merged: true,
        mergeInfo: {
          strategy,
          supersededVersion: existing.version,
          supersededAt: existing.updatedAt
        }
      };
    }
    return {
      ...existing,
      mergeInfo: {
        strategy,
        supersededVersion: incoming.version,
        supersededAt: incoming.updatedAt
      }
    };
  }
  
  if (strategy === MergeStrategy.KEEP_BOTH) {
    return {
      ...incoming,
      id: incoming.id || existing.id,
      originalId: existing.id,
      merged: true,
      mergeInfo: {
        strategy,
        keptBoth: true,
        versions: [existing.version, incoming.version]
      }
    };
  }
  
  if (strategy === MergeStrategy.MERGE_METADATA) {
    const winner = incomingTime > existingTime ? incoming : existing;
    const loser = incomingTime > existingTime ? existing : incoming;
    
    return {
      ...winner,
      merged: true,
      mergeInfo: {
        strategy,
        mergedMetadata: {
          contributors: [...new Set([
            winner.lastModifiedBy,
            loser.lastModifiedBy
          ].filter(Boolean))],
          versions: winner.version,
          mergedFrom: loser.version
        }
      }
    };
  }
  
  return incoming;
}

/**
 * Parse JSON body from request
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Get all memories
 */
function handleGetMemories(db) {
  return db.memories.map(m => ({
    id: m.id,
    title: m.title,
    scope: m.scope,
    tags: m.tags,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    version: m.version,
    createdBy: m.createdBy
  }));
}

/**
 * Get memory by ID
 */
function handleGetMemory(db, id) {
  const memory = db.memories.find(m => m.id === id);
  if (!memory) return null;
  return memory;
}

/**
 * Create new memory
 */
function handleCreateMemory(db, data) {
  const now = new Date().toISOString();
  const memory = {
    id: generateId(),
    title: data.title || 'Untitled',
    content: data.content || '',
    scope: data.scope || 'team',
    tags: data.tags || [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    createdBy: data.agent || 'unknown',
    lastModifiedBy: data.agent || 'unknown'
  };
  
  db.memories.push(memory);
  db.version++;
  saveDB(db);
  
  return memory;
}

/**
 * Update memory
 */
function handleUpdateMemory(db, id, data, options = {}) {
  const index = db.memories.findIndex(m => m.id === id);
  if (index === -1) return { error: 'Memory not found', status: 404 };
  
  const existing = db.memories[index];
  
  // Conflict detection
  if (options.expectedVersion && existing.version !== options.expectedVersion) {
    const conflict = detectConflict(existing, data);
    if (conflict) {
      return {
        error: 'Conflict detected',
        status: 409,
        conflict: true,
        existing,
        incoming: data,
        mergeResult: mergeMemory(existing, data, options.mergeStrategy || MergeStrategy.LAST_WRITE_WINS)
      };
    }
  }
  
  const now = new Date().toISOString();
  const updated = {
    ...existing,
    ...data,
    id: existing.id, // Preserve original ID
    createdAt: existing.createdAt, // Preserve original creation time
    updatedAt: now,
    version: existing.version + 1,
    lastModifiedBy: data.agent || 'unknown'
  };
  
  db.memories[index] = updated;
  db.version++;
  saveDB(db);
  
  return { memory: updated, merged: false };
}

/**
 * Delete memory
 */
function handleDeleteMemory(db, id) {
  const index = db.memories.findIndex(m => m.id === id);
  if (index === -1) return { error: 'Memory not found', status: 404 };
  
  const deleted = db.memories.splice(index, 1)[0];
  db.version++;
  saveDB(db);
  
  return { deleted };
}

/**
 * Get sync status
 */
function handleSyncStatus(db) {
  return {
    totalMemories: db.memories.length,
    dbVersion: db.version,
    lastUpdated: db.lastSync || new Date().toISOString(),
    memories: db.memories.map(m => ({
      id: m.id,
      version: m.version,
      updatedAt: m.updatedAt
    }))
  };
}

/**
 * Request handler
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${DEFAULT_PORT}`);
  const pathname = url.pathname;
  const method = req.method;
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Expected-Version, X-Merge-Strategy');
  
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Get agent from header or default
  const agent = req.headers['x-agent'] || 'unknown';
  
  // Parse query params
  const expectedVersion = req.headers['x-expected-version'] ? parseInt(req.headers['x-expected-version']) : null;
  const mergeStrategy = req.headers['x-merge-strategy'] || MergeStrategy.LAST_WRITE_WINS;
  
  try {
    const db = loadDB();
    
    // Route: GET /memories
    if (method === 'GET' && pathname === '/memories') {
      sendJSON(res, 200, { memories: handleGetMemories(db) });
      return;
    }
    
    // Route: GET /memories/sync
    if (method === 'GET' && pathname === '/memories/sync') {
      sendJSON(res, 200, handleSyncStatus(db));
      return;
    }
    
    // Route: GET /memories/:id
    if (method === 'GET' && pathname.startsWith('/memories/')) {
      const id = pathname.replace('/memories/', '');
      const memory = handleGetMemory(db, id);
      if (!memory) {
        sendJSON(res, 404, { error: 'Memory not found' });
        return;
      }
      sendJSON(res, 200, memory);
      return;
    }
    
    // Route: POST /memories
    if (method === 'POST' && pathname === '/memories') {
      const body = await parseBody(req);
      const memory = handleCreateMemory(db, { ...body, agent });
      sendJSON(res, 201, memory);
      return;
    }
    
    // Route: PUT /memories/:id
    if (method === 'PUT' && pathname.startsWith('/memories/')) {
      const id = pathname.replace('/memories/', '');
      const body = await parseBody(req);
      const result = handleUpdateMemory(db, id, { ...body, agent }, { expectedVersion, mergeStrategy });
      
      if (result.error && result.status === 404) {
        sendJSON(res, 404, { error: result.error });
        return;
      }
      
      if (result.error && result.status === 409) {
        sendJSON(res, 409, {
          error: 'Conflict detected',
          conflict: true,
          existing: result.existing,
          incoming: result.incoming,
          mergeResult: result.mergeResult
        });
        return;
      }
      
      sendJSON(res, 200, result);
      return;
    }
    
    // Route: DELETE /memories/:id
    if (method === 'DELETE' && pathname.startsWith('/memories/')) {
      const id = pathname.replace('/memories/', '');
      const result = handleDeleteMemory(db, id);
      
      if (result.error && result.status === 404) {
        sendJSON(res, 404, { error: result.error });
        return;
      }
      
      sendJSON(res, 200, result);
      return;
    }
    
    // Health check
    if (method === 'GET' && pathname === '/health') {
      sendJSON(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
      return;
    }
    
    // Not found
    sendJSON(res, 404, { error: 'Not found' });
    
  } catch (err) {
    console.error('Error handling request:', err);
    sendJSON(res, 500, { error: 'Internal server error', message: err.message });
  }
}

/**
 * Start the server
 */
function startServer(port = DEFAULT_PORT) {
  const server = http.createServer(handleRequest);
  
  server.listen(port, () => {
    console.log(`
🌐 Team Memory API Server
═══════════════════════════════
Port: ${port}
URL: http://localhost:${port}

Endpoints:
  GET    /memories          List all team memories
  GET    /memories/sync     Get sync status
  GET    /memories/:id      Get specific memory
  POST   /memories          Create new memory
  PUT    /memories/:id      Update memory (with conflict detection)
  DELETE /memories/:id      Delete memory
  GET    /health            Health check

Headers:
  X-Agent: <agent-name>           Set creator/modifier agent
  X-Expected-Version: <version>    For conflict detection
  X-Merge-Strategy: <strategy>     last_write_wins|keep_both|merge_metadata

Conflict Resolution:
  When X-Expected-Version is provided and doesn't match,
  the server returns 409 with merge suggestions.

Example:
  curl -X POST http://localhost:${port}/memories \\
    -H "Content-Type: application/json" \\
    -d '{"title":"Test","content":"Hello","scope":"team"}'
`);
  });
  
  return server;
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
team_memory_api.mjs - Team Memory REST API

Usage:
  node team_memory_api.mjs              Start server (port ${DEFAULT_PORT})
  node team_memory_api.mjs --port 8080  Start on specific port
  node team_memory_api.mjs --help       Show this help
`);
  process.exit(0);
}

const portArg = args.indexOf('--port');
const port = portArg !== -1 && args[portArg + 1] ? parseInt(args[portArg + 1]) : DEFAULT_PORT;

startServer(port);

export { startServer, loadDB, saveDB, MergeStrategy, mergeMemory };
