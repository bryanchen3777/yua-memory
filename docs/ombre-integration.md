# Ombre-Brain Integration Guide

## Overview

Ombre-Brain is integrated as an **optional enrichment layer** on top of Yua's existing three-tier memory architecture (LCM / QMD / NotebookLM). It is NOT a replacement for any existing layer — when Ombre is unavailable or unconfigured, Yua continues to function normally using only its original memory system.

```
┌─────────────────────────────────────────────────────┐
│                    Yua Memory                         │
│                                                      │
│  ┌─────────┐   ┌─────────┐   ┌─────────────────┐    │
│  │   LCM   │   │   QMD   │   │  NotebookLM     │    │
│  │ (SQLite)│   │  (.md)  │   │  (External)     │    │
│  └─────────┘   └─────────┘   └─────────────────┘    │
│                       │                              │
│                       ▼                              │
│              ┌─────────────────┐                     │
│              │  Ombre-Brain    │  ← Enrichment      │
│              │  (Emotional     │    Layer           │
│              │   Memory)       │                    │
│              └─────────────────┘                     │
└─────────────────────────────────────────────────────┘
```

## What Ombre Provides

- **Russell Circumplex emotion tagging** (valence: -1~1, arousal: 0~1)
- **Forgetting curve** (λ=0.06, ~21-day archival cycle)
- **Dual-channel search** (TF-IDF + Ombre breath via RRF fusion)
- **Emotional Resonance Score (ERS)** boost for high-arousal memories

## Configuration

### OpenClaw Config (`openclaw.json`)

> **Important**: Use `mcp.servers` (nested under `mcp`), NOT `mcpServers` as a top-level key. The top-level `mcpServers` key is rejected by OpenClaw's config schema.

```json
{
  "mcp": {
    "servers": {
      "ombre-brain": {
        "url": "http://localhost:3848"
      },
      "ombre-rest-bridge": {
        "url": "http://localhost:3849/health"
      }
    }
  }
}
```

| Key | Description |
|-----|-------------|
| `mcp.servers.ombre-brain.url` | Ombre-Brain MCP server (port 3848) |
| `mcp.servers.ombre-rest-bridge.url` | REST bridge health endpoint (port 3849) |

### Environment Variables

```bash
# Optional: Override default MCP URL
OMBRE_BASE_URL=http://localhost:3848

# Required for emotion label generation:
OPENAI_API_KEY=sk-...
# or
DEEPSEEK_API_KEY=sk-...
```

## Fallback Behavior

Ombre is designed to fail gracefully. The following table documents all fallback scenarios:

| Scenario | Behavior |
|---------|----------|
| Ombre MCP unreachable | `OmbreUnavailable` raised → Circuit Breaker OPEN after 3 failures |
| confidence < 0.4 | `maybe_hold_memory()` returns `None`, no memory written |
| RRF merge timeout (30s) | Falls back to pure TF-IDF results |
| REST bridge unreachable | dream_mode logs `[Ombre][dream_failed]` and continues |
| Ombre not configured | All Ombre features silently no-op |

## Components

### `ombre_bridge.py` — MCP Client Bridge

Singleton `OmbreBridge` via `get_ombre_bridge()`. Provides:
- `pulse()` — health check (1.0s timeout)
- `breath()` — semantic search (3.0s timeout)
- `hold()` — store memory (5.0s timeout)
- `dream()` — consolidate (10.0s timeout)
- `trace()` — memory trace (5.0s timeout)
- `grow()` — grow memory (10.0s timeout)

### `consolidation.py` — Memory Consolidation

- `_validate_emotion_label()` — validates Russell circumplex schema
- `llm_generate_emotion_label()` — generates emotion tags via LLM
- `maybe_hold_memory()` — stores memory if confidence >= 0.4

### `retriever.py` — Dual-Channel Retrieval

- `retrieve()` — two-stage retrieval (TF-IDF → cross-encoder reranking)
- `retrieve(query, use_ombre_breath=True)` — enables Ombre merge for emotion queries
- `rrf_merge()` — Reciprocal Rank Fusion with namespace prefixes (`qmd:` / `ombre:`)
- Emotion keywords: love, happy, sad, angry, miss, 傷心, 快樂, 老公, etc.

### `sync_monitor.py` — Memory Sync Monitor

Health status computation:
- `error:*` state → `unavailable`
- `>80%` unresolved → `degraded`
- `total == 0` → `active`

### `ombre_rest_server.py` — REST Sidecar (Node.js)

FastAPI server on port 3849. Proxies Ombre MCP tools for Node.js consumers:
- `GET /health`
- `GET /api/ombre/pulse`
- `GET /api/ombre/breath?query=...&max_results=...`
- `GET /api/ombre/dream?depth=...`

Started as a sidecar, not managed by OpenClaw.

### `dream_mode.mjs` — Memory Consolidation Script

4-phase memory consolidation + Phase 3.5 Ombre Weight Pool:
1. Orient — understand current state
2. Gather — collect recent memories
3. Consolidate — synthesize learnings
4. Prune — remove outdated info
3.5. Ombre Weight Pool — retrieve emotionally intense unresolved memories

## Installation

```bash
# Core dependencies (required for bridge)
pip install httpx>=0.25.0

# Optional: for REST server
pip install fastapi>=0.104.0 uvicorn>=0.24.0
pip install "yua-memory[ombre]"

# Or install all Ombre dependencies
pip install "yua-memory[ombre]"
```

## Running

```bash
# Start REST bridge (required for dream_mode.mjs)
python -m yua_memory.ombre_rest_server &
curl http://localhost:3849/health

# Run dream_mode
node scripts/dream_mode/dream_mode.mjs
```
