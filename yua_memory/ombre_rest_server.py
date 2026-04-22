"""
Ombre-Brain REST Bridge for Node.js

Exposes HTTP endpoints for Node.js scripts (e.g., dream_mode.mjs)
to call Ombre-Brain tools without direct MCP access.

Runs on port 3849 (separate from Ombre MCP on 3848).
"""

import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(__file__))

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ombre_bridge import OmbreBridge, get_ombre_bridge

app = FastAPI(title="Ombre-Brain REST Bridge")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy initialization
_bridge: OmbreBridge = None


def get_bridge() -> OmbreBridge:
    global _bridge
    if _bridge is None:
        _bridge = get_ombre_bridge()
    return _bridge


@app.get("/api/ombre/pulse")
async def api_pulse():
    """Get system status across all buckets."""
    try:
        return await get_bridge().pulse()
    except Exception as e:
        return {"error": str(e), "status": "unavailable"}


@app.get("/api/ombre/breath")
async def api_breath(q: str, k: int = 5):
    """Dual-channel search (keyword + vector)."""
    try:
        results = await get_bridge().breath(q, max_results=k)
        return {"results": results}
    except Exception as e:
        return {"error": str(e), "results": []}


@app.get("/api/ombre/dream")
async def api_dream(depth: str = "medium"):
    """Self-reflect on recent memories."""
    try:
        reflections = await get_bridge().dream(depth)
        return {"reflections": reflections}
    except Exception as e:
        return {"error": str(e), "reflections": []}


@app.get("/api/ombre/hold")
async def api_hold(content: str, tags: str = None, importance: int = 5):
    """Store memory with auto-tagging."""
    try:
        tag_list = tags.split(",") if tags else None
        result = await get_bridge().hold(
            content=content,
            tags=tag_list,
            importance=importance
        )
        return result
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/ombre/status")
async def api_status():
    """Get bridge circuit breaker status."""
    bridge = get_bridge()
    return {
        "state": bridge.state,
        "failures": bridge.failure_count
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3849)
