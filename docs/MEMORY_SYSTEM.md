# Memory System Documentation

A complete guide to the two-tier memory architecture used by Tim/Yua agents.

---

## 📐 Architecture Overview

The system uses **two complementary memory layers** that work together:

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: LCM (Long-term Conversation Memory)           │
│  - Raw conversation storage                             │
│  - Preserves everything by default                     │
│  - SQLite database                                     │
└─────────────────────────────────────────────────────────┘
                          │
                          │ Auto-extraction (hourly)
                          ▼
┌─────────────────────────────────────────────────────────┐
│  LAYER 2: QMD (Quantized Memory Documentation)          │
│  - Curated, important memories only                    │
│  - Structured markdown files                            │
│  - Semantic search enabled                             │
└─────────────────────────────────────────────────────────┘
```

---

## 🔷 Layer 1: LCM (Long-term Conversation Memory)

### What is LCM?
LCM is the **raw conversation memory** - it stores all messages and session summaries. It's the "hard drive" of conversations.

### Database Location
- `C:\Users\bbfcc\.openclaw\data\lcm.db`
- Schema: `lcm_schema.sql` (in workspace-tim)

### Schema

**Table: `conversations`**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| title | TEXT | Conversation title |
| created_at | INTEGER | Unix timestamp |
| updated_at | INTEGER | Last update timestamp |
| label | TEXT | Optional label |

**Table: `messages`**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| conversation_id | TEXT | FK to conversations |
| role | TEXT | "user" or "assistant" |
| content | TEXT | Message content |
| created_at | INTEGER | Unix timestamp |

**Table: `summaries`**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| conversation_id | TEXT | FK to conversations |
| content | TEXT | Summary content |
| depth | INTEGER | Depth level (0 = leaf, higher = more condensed) |
| created_at | INTEGER | Unix timestamp |

**Table: `parts`** (for long messages)
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| message_id | TEXT | FK to messages |
| content | TEXT | Partial content |
| index | INTEGER | Part index |

**Table: `memory_vector_index`** (for semantic search)
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| scope | TEXT | "Shared", "Private:Tim", "Private:Yua", etc. |
| type | TEXT | Memory type |
| content | TEXT | Indexed content |
| memory_id | TEXT | Reference to source |
| created_at | INTEGER | Unix timestamp |

### LCM Tools

**Query memories (reminisce_memory.mjs):**
```bash
node reminisce_memory.mjs [hours]
# Returns relevant memories from LCM + QMD
```

**Extract memories to QMD (auto_memory_extractor.mjs):**
```bash
node auto_memory_extractor.mjs [hours]
# Extracts important memories from LCM to QMD
```

**Check schema:**
```bash
node check_schema.mjs
```

---

## 🔶 Layer 2: QMD (Quantized Memory Documentation)

### What is QMD?
QMD is the **curated memory layer** - only truly important memories are stored here. It's the "highlight reel" of conversations.

### Directory Structure
```
qmd/
├── identity/          # Agent identity (SOUL.md, IDENTITY.md)
├── rules/             # Bryan rules, guidelines
│   └── memory-guidelines.md
├── memories/          # Extracted memories
│   ├── memory_001.md
│   ├── memory_002.md
│   └── ...
└── ... (custom scopes)
```

### Memory File Format
```markdown
---
scope: Private:Yua
type: project
memory_id: mem_abc123
created: 2026-04-03T00:45:00Z
tags: [memory-system, architecture]
---

## Memory Title

Detailed content about this memory...

<!-- auto-extracted -->
```

### Memory Taxonomy (Types)

| Type | Description | Example |
|------|-------------|---------|
| `user` | User preferences, habits | "Bryan prefers Claude over Gemini" |
| `feedback` | User feedback, guidance | "Bryan said 'don't do that'" |
| `project` | Project status, decisions | "We decided to use separate repos" |
| `reference` | External pointers | Important URLs, documentation links |

### Scope Tags

| Scope | Who Can See |
|-------|------------|
| `Shared` | All agents, all users |
| `Private:Tim` | Only Tim agent |
| `Private:Yua` | Only Yua agent |
| `Private:Fatima` | Only Fatima agent |
| `Team` | Team agents, shared context |

---

## 🔄 Memory Flow

### Flow 1: Session Startup (Memory Hydration)
```
1. Agent starts → reads SOUL.md, USER.md
2. Runs memory_hydration.mjs
3. Loads HIGH PRIORITY ITEMS from QMD
4. Loads TECHNICAL CONTEXT from QMD
5. Loads RECENT MEMORIES from LCM summaries
6. Agent now has context of past conversations
```

### Flow 2: Memory Extraction (Hourly Cron)
```
1. Cron triggers auto_memory_extractor.mjs
2. Query LCM for recent messages (last N hours)
3. Query LCM for recent summaries
4. Send to Claude for memory extraction
5. Deduplicate against existing QMD memories
6. Write new memories to qmd/memories/
```

### Flow 3: Memory Recall (Reminisce Engine)
```
1. Bryan says "還記得..." or similar trigger
2. reminiscence_engine activates
3. Query LCM for relevant conversations
4. Query QMD for related memories
5. Use AI to select most relevant memories
6. Return memories for contextual response
```

---

## 📜 Scripts Reference

| Script | Purpose | Trigger |
|--------|---------|---------|
| `reminisce_memory.mjs` | Query + recall memories | Manual / "還記得..." |
| `auto_memory_extractor.mjs` | Extract memories to QMD | Hourly cron |
| `memory_hydration.mjs` | Load memories on startup | Agent startup |
| `check_schema.mjs` | Debug LCM schema | Manual |

### reminiscence_engine Parameters

**Trigger keywords:**
- 還記得、記得
- 以前、曾經、之前
- 什麼時候、幾時

**Memory types:**
- nostalgic tone
- random sharing
- anniversary ("一年前的今天")
- emotional resonance

---

## 📋 Guidelines

### What NOT to Save (memory-guidelines.md)

❌ **Do NOT save:**
- Code patterns (can be derived from source)
- Git history (use `git log`)
- Debugging solutions (fix is in code)
- Content already in CLAUDE.md/SOUL.md
- Temporary task details

✅ **DO save:**
- User preferences (`user` type)
- User feedback (`feedback` type)
- Project decisions (`project` type)
- External references (`reference` type)

---

## 🔧 Integration Points

### For OpenClaw Agents

Add to your `AGENTS.md` startup sequence:
```markdown
## Session Startup
1. Read `SOUL.md`
2. Read `USER.md`
3. Run `memory_hydration.mjs --agent Tim --scope All`
```

### For Other AI Systems

To integrate with this memory system:

1. **Read QMD files** for semantic context
2. **Query LCM** for conversation history
3. **Write new memories** using the QMD format
4. **Update memory_hydration** if you add new memory sources

---

## 📁 File Locations

| File | Path |
|------|------|
| Workspace | `C:\Users\bbfcc\.openclaw\workspace-tim` |
| LCM Database | `C:\Users\bbfcc\.openclaw\data\lcm.db` |
| QMD Memories | `qmd/memories/` |
| LCM Schema | `memory/lcm_schema.sql` |
| This Doc | `MEMORY_SYSTEM.md` |

---

## 🔗 Related Repos

- **yua-memory**: https://github.com/bryanchen3777/yua-memory
- **team-memory-sync**: https://github.com/bryanchen3777/team-memory-sync

---

*Last updated: 2026-04-03*
*Maintained by: Tim (Yua's Chief Programmer)*
