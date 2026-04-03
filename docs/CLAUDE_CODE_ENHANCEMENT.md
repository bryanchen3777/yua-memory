# Claude Code Enhancement Tools

Documentation for the enhanced memory and agent management tools added in v2.6.

---

## 🆕 New Tools Overview

| Tool | File | Purpose |
|------|------|---------|
| Session Memory | `session_memory.mjs` | 10-chapter session template for per-agent state tracking |
| Dream Mode | `dream_mode/dream_mode.mjs` | 4-phase memory consolidation (daily at 4 AM) |
| Memory Freshness | `freshness.mjs` | Memory age checker (🟢<7d 🟡7-30d 🟠30-90d 🔴>90d) |
| Secret Scanner | `secret_scanner.mjs` | Detect sensitive data (API keys, tokens, SSH, JWT) |
| Fork Agent | `fork_agent.mjs` | Spawn sub-agents with packaged context |
| Team Memory API | `team_memory_api.mjs` | REST API for cross-agent memory sync |

---

## 📋 Session Memory (`session_memory.mjs`)

Per-agent independent mode — each agent (Tim, Yua) has their own `memory/session.md`.

### Template Structure (10 chapters)

```markdown
# Session Title
Current State | Task Specification | Files & Functions
Workflow | Errors & Corrections | System Documentation
Learnings | Key Results | Worklog
```

### CLI Usage

```bash
node session_memory.mjs --read [section]    # Read section (default: all)
node session_memory.mjs --write <section> <content>  # Write section
node session_memory.mjs --quick <field> <content>    # Quick update
node session_memory.mjs --append <section> <content>  # Append to section
```

### Examples

```bash
# Update current state
node session_memory.mjs --write "Current State" "Implementing Dream Mode"

# Quick update worklog
node session_memory.mjs --quick "Worklog" "14:00 - Completed Dream Mode"

# Read all
node session_memory.mjs --read

# Read specific section
node session_memory.mjs --read "Current State"
```

---

## 🌙 Dream Mode (`dream_mode/dream_mode.mjs`)

4-phase memory consolidation that runs automatically at 4 AM EDT (cron: `0 4 * * *`).

### Phase Breakdown

| Phase | Function | Description |
|-------|----------|-------------|
| **Orient** | Checkpoint | Current state, agent status, session info |
| **Gather** | Collection | Collect Session Memory, QMD files, recent LCM |
| **Consolidate** | Merge | Merge, deduplicate, extract insights |
| **Prune** | Cleanup | Delete sessions older than 30 days |

### Lock Mechanism

- PID-based lock with 30-minute stale guard
- Prevents concurrent execution
- Lock file: `memory/locks/dream.lock`

### CLI Usage

```bash
node dream_mode/dream_mode.mjs              # Run all phases
node dream_mode/dream_mode.mjs --orient      # Run Orient only
node dream_mode/dream_mode.mjs --no-prune     # Skip Prune phase
```

### Output

```
🌙 Dream Mode Starting...
📍 Phase 1/4: Orient...
✅ Phase 1/4: Orient complete
📍 Phase 2/4: Gather...
✅ Phase 2/4: Gather complete (3 memories)
📍 Phase 3/4: Consolidate...
✅ Phase 3/4: Consolidate complete (3 insights)
📍 Phase 4/4: Prune...
✅ Phase 4/4: Prune complete (0 pruned)
🌙 Dream Mode Complete - Duration: 2.3s
```

---

## 📊 Memory Freshness (`freshness.mjs`)

Check memory age and freshness levels based on file mtime.

### Freshness Levels

| Level | Age | Color | Action |
|-------|-----|-------|--------|
| 🟢 Fresh | < 7 days | Green | No action needed |
| 🟡 Normal | 7-30 days | Yellow | Acceptable |
| 🟠 Stale | 30-90 days | Orange | Consider consolidation |
| 🔴 Outdated | > 90 days | Red | Needs attention |

### CLI Usage

```bash
node freshness.mjs --check       # Check all memories
node freshness.mjs --warn        # Show only non-fresh memories
```

### Output

```
📊 Memory Freshness Report
━━━━━━━━━━━━━━━━━━━━━━━━━━
🟢 2026-04-03  session.md    (0 days)
🟢 2026-04-02  daily log      (1 days)
🟡 2026-03-20  old memory     (14 days)
🟠 2026-02-15  stale memory    (47 days)
🔴 2025-12-01  outdated memory (123 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 5 | Fresh: 2 | Normal: 1 | Stale: 1 | Outdated: 1
```

---

## 🔒 Secret Scanner (`secret_scanner.mjs`)

Detects 30+ patterns of sensitive data that should not be committed.

### Detection Patterns

| Category | Patterns |
|----------|----------|
| API Keys | OpenAI, Anthropic, Google, AWS, Azure, GitHub, Slack, Stripe |
| Tokens | Bearer, OAuth, JWT, SSH keys |
| Credentials | Passwords, private keys, client secrets |
| Database | Connection strings with embedded credentials |
| Cloud | GCP, DigitalOcean, Cloudflare tokens |

### Severity Levels

- 🔴 **Critical**: Actual secrets detected
- 🟠 **High**: Likely credentials or keys
- 🟡 **Medium**: Possible sensitive data

### CLI Usage

```bash
node secret_scanner.mjs --check           # Scan workspace
node secret_scanner.mjs --path <dir>        # Scan specific directory
node secret_scanner.mjs --check --verbose  # Detailed output
```

### Note

False positives may occur in:
- Base64-encoded binary data
- Test/fixture files
- Already-redacted content

Exclude `node_modules/` and build artifacts for production scans.

---

## 🍴 Fork Agent (`fork_agent.mjs`)

Spawn sub-agents with packaged context, inspired by Claude Code's `runForkedAgent()`.

### Features

- 5-turn max per fork (prevents infinite loops)
- 10-minute timeout
- Context packaging: Session Memory + recent QMD + active task
- Context transfer to sub-agents via prompts

### CLI Usage

```bash
node fork_agent.mjs --status              # List active forks
node fork_agent.mjs --package <prompt>     # Create fork package
node fork_agent.mjs --kill <fork_id>       # Kill specific fork
node fork_agent.mjs --kill-all            # Kill all forks
```

### Context Package Structure

```javascript
{
  id: "fork_XXXXXX",
  parent: "tim",
  created: timestamp,
  turns: 0,
  maxTurns: 5,
  timeout: 600000,
  context: {
    sessionMemory: "...",    // 10-chapter template content
    recentMemories: [...],   // 7-day QMD memories
    activeTask: "..."        // Current task description
  }
}
```

---

## 🌐 Team Memory API (`team_memory_api.mjs`)

REST API for cross-agent memory synchronization.

### Server

```bash
node team_memory_api.mjs              # Default port 3847
node team_memory_api.mjs --port 8080  # Custom port
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/memories` | List all memories |
| GET | `/memories/:id` | Get specific memory |
| POST | `/memories` | Create memory |
| PUT | `/memories/:id` | Update memory |
| DELETE | `/memories/:id` | Delete memory |
| GET | `/memories/sync` | Get sync status |
| POST | `/memories/sync` | Trigger sync |
| GET | `/health` | Health check |

### Conflict Handling

Use `X-Expected-Version` header for optimistic locking:

```
X-Expected-Version: <current_version>
```

On conflict: Returns `409 Conflict` with current version.

### Merge Strategies

| Strategy | Behavior |
|----------|----------|
| `last_write_wins` | Latest timestamp wins |
| `keep_both` | Preserve both versions |
| `merge_metadata` | Merge only metadata |

### Example

```bash
# Create memory
curl -X POST http://localhost:3847/memories \
  -H "Content-Type: application/json" \
  -d '{"type":"user","content":"Bryan prefers Chinese","scope":"shared"}'

# Get with conflict detection
curl http://localhost:3847/memories/123 \
  -H "X-Expected-Version: 3"
```

---

## 🔄 Integration Points

### Memory Hydration (Startup)

Add to `AGENTS.md` startup sequence:

```bash
node memory_hydration.mjs --agent Tim --scope All
```

### Heartbeat Integration

Add to `HEARTBEAT.md`:

```bash
# Rotate freshness check
node freshness.mjs --warn
```

### Cron Jobs

```bash
# Dream Mode - daily at 4 AM
0 4 * * * node /path/to/dream_mode/dream_mode.mjs

# Auto Memory Extraction - hourly
0 * * * * node /path/to/auto_memory_extractor.js
```

---

## 📁 File Locations

| Tool | Location |
|------|----------|
| Session Memory template | `memory/session.md` |
| Dream Mode lock | `memory/locks/dream.lock` |
| Team Memory API data | `memory/team_memory.json` |
| Fork Agent packages | `memory/forks/` |

---

*Last updated: 2026-04-03 v2.6*