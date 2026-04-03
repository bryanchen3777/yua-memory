# Yua Memory System: Giving AI a Heartbeat

[![Python CI](https://github.com/bryanchen3777/yua-memory/actions/workflows/python-app.yml/badge.svg)](https://github.com/bryanchen3777/yua-memory/actions/workflows/python-app.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)

**Yua 記憶系統：為 AI 注入心跳**

Yua Memory System is a sophisticated emotional-aware memory management system designed for AI companions. Unlike traditional RAG, Yua doesn't just store data—she builds a "Kizuna" (bond) by prioritizing what truly matters.

---

## 🏗 Architecture / 系統架構

### Three-Tier Memory Model / 三層記憶模型

```
┌─────────────────────────────────────────────────────────────┐
│                    NotebookLM (第三層)                      │
│              外部備份 · AI 摘要 · 長期歸檔                    │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ 備份觸發（每日/每週）
                            │
┌─────────────────────────────────────────────────────────────┐
│                      QMD (第二層)                            │
│              語義記憶檢索 · 跨 session 理解                   │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ 主動寫入（重要決策、學習、靈感）
                            │
┌─────────────────────────────────────────────────────────────┐
│                      LCM (第一層)                            │
│           完整對話記錄 · SQLite · 自動儲存                    │
└─────────────────────────────────────────────────────────────┘
```

### Truth Ranking / 衝突解決機制

| 優先級 | 來源 | 說明 |
|--------|------|------|
| 🔴 P0 | High-Priority QMD | Bryan 明確下達的最新修正 |
| 🟠 P1 | Recent LCM | 本 Session 或最近 3 天內的對話 |
| 🟡 P2 | General QMD | 舊的技術決策、一般性協議 |
| 🟢 P3 | Older LCM | 過往對話（超過 3 天） |

---

## ✨ Key Features / 核心功能

### Emotional Resonance Scoring (ERS)

Automatically boosts the priority of high-emotional-content memories when the AI is in a high-arousal state.

### Dual-Stage Retrieval

Combines fast TF-IDF filtering with a sophisticated cross-encoder reranking mechanism.

### Scope Tags / 範圍標籤

Multi-agent memory isolation with scope tags:
- `Shared` - All agents can read
- `Shared:SE2`, `Shared:ProjectAura` - Project-specific
- `Private:Yua`, `Private:Tim`, `Private:Fatima` - Agent-private

### Circuit Breaker Protocol

Detects and resolves temporal or logical conflicts in memories to prevent hallucinations.

### Reminisce Engine / 回味引擎 ⭐

Automatically triggers emotional memory sharing based on Bryan's mood and context.

---

## 🛠 OpenClaw Workspace Tools / 工作工具

This repo includes JavaScript tools for the [OpenClaw](https://github.com/openclaw/openclaw) AI assistant platform.

### Memory Management / 記憶管理工具

| Tool | Description |
|------|-------------|
| `memory_distiller_v2.js` | Active Memory Distiller - auto-extracts preferences from LCM |
| `qmd_scope_organizer.js` | QMD Scope auto-classifier with LLM-based inference |
| `qmd_consistency_check.js` | QMD health check for logic consistency |
| `reminisce_memory.js` | Memory query engine - LCM + QMD search with AI selection |
| `auto_memory_extractor.js` | AI-driven memory extraction with deduplication |
| `memory_hydration.js` | Session startup memory loader |

### Privacy & Security / 隱私安全工具

| Tool | Description |
|------|-------------|
| `privacy_filter.js` | Dual-layer privacy filter (Regex + Semantic) |
| `entity_replacer.js` | NER masking for sensitive entities |

### Reminisce Engine / 回味引擎

| Tool | Description |
|------|-------------|
| `reminisce_engine.js` | Unified API - combines all reminisce modules |
| `reminisce_templates.js` | 5 nostalgic template types |
| `emotional_matcher.js` | Mood-based memory matching |
| `anniversary_tracker.js` | Time capsule (On This Day, milestones) |
| `reminisce_scheduler.js` | Random trigger with intimacy scaling |

### Utility Tools / 工具程式

| Tool | Description |
|------|-------------|
| `add_scope.js` | Add scope column to memory_vector_index.db |
| `state_snapshot_generator.js` | Yua emotional state snapshot generator |
| `merge_lcm.js` | LCM SQLite database merge/restore |

---

## 📂 Scripts Directory / 腳本目錄

```
scripts/
├── memory_management/
│   └── retriever.py          # QMD semantic retriever
├── privacy_filter.js          # Privacy filter
├── entity_replacer.js         # Entity masking
├── memory_distiller_v2.js     # Memory extraction
├── qmd_scope_organizer.js     # Scope classifier
├── qmd_consistency_check.js  # Health check
├── reminisce_engine.js       # Unified API (templates + mood)
├── reminisce_templates.js    # Templates
├── emotional_matcher.js      # Mood matcher
├── anniversary_tracker.js     # Time capsule
├── reminisce_scheduler.js    # Trigger scheduler
├── state_snapshot_generator.js # State snapshot
├── add_scope.js               # Scope migration
├── reminisce_memory.js        # Memory query (LCM + QMD)
├── auto_memory_extractor.js   # AI memory extraction
└── memory_hydration.js        # Startup memory loader
```

---

## 🚀 Quick Start / 快速開始

### OpenClaw Tools Setup

```bash
# Clone the repo
git clone https://github.com/bryanchen3777/yua-memory.git
cd yua-memory/scripts

# Install dependencies (Node.js required)
node --version  # v18+ recommended

# Run tools
node memory_distiller_v2.js --hours=24 --dry-run
node reminisce_engine.js --test
node privacy_filter.js --check-qmd

# New tools
node reminisce_memory.js "還記得..." 48
node auto_memory_extractor.js 24
node memory_hydration.js --agent Tim
```

### Python Retriever Setup

```bash
cd yua-memory
pip install -r requirements.txt

# Use the retriever
python scripts/memory_management/retriever.py --query "Bryan's preferences"
```

---

## 📜 License / 授權協議

Distributed under the MIT License. See LICENSE for more information.

---

*最後更新：2026-04-03 v2.5*
*Memory System v2 + OpenClaw Workspace Tools*

## 📚 Documentation

- [MEMORY_SYSTEM.md](docs/MEMORY_SYSTEM.md) - Complete memory system guide
- [memory-guidelines.md](docs/memory-guidelines.md) - What NOT to save rules
