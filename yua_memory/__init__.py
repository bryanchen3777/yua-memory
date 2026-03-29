"""
Yua Memory System - Emotional Memory Management for AI Agents

A three-layer memory architecture (QMD/LCM/NotebookLM) with emotional
resonance scoring, conflict detection, and automated maintenance.

Version: 1.0.0
License: MIT
"""

__version__ = "1.0.0"
__author__ = "Bryan & Yua"

# Core classes for easy import
from .path_manager import PathManager
from .emotional_retriever import YuaEmotionalRetriever
from .retriever import YuaMemoryRetriever
from .circuit_breaker_v2 import OptimizedCircuitBreaker, MemoryConflict, ConflictType
from .consolidation import MemoryConsolidator
from .sync_monitor import MemorySyncMonitor
from .aging_v2 import SQLMemoryAging
from .archive_manager import MemoryArchiveManager
from .notifications import TelegramNotifier
from .scheduler import YuaScheduler
from .maintenance_tasks import YuaMaintenanceTasks

# Package metadata
__all__ = [
    # Version
    "__version__",
    # Core
    "PathManager",
    # Retrieval
    "YuaEmotionalRetriever",
    "YuaMemoryRetriever",
    # Conflict Detection
    "OptimizedCircuitBreaker",
    "MemoryConflict",
    "ConflictType",
    # Maintenance
    "MemoryConsolidator",
    "MemorySyncMonitor",
    "SQLMemoryAging",
    "MemoryArchiveManager",
    # Notifications & Scheduling
    "TelegramNotifier",
    "YuaScheduler",
    "YuaMaintenanceTasks",
]
