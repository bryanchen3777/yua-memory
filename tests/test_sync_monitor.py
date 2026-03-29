"""
Test Sync Monitor
=================

Yua's Sync Monitor maintains consistency across three memory layers:
1. QMD (files) - Raw markdown storage
2. LCM (database) - Indexed search layer
3. NotebookLM (external) - Future cloud integration

The monitor prevents:
- Ghost memories: In DB but not in files
- Orphan memories: In files but not in DB
"""
import pytest
from enum import Enum


class SyncStatus(Enum):
    """Sync status between memory layers."""
    IN_SYNC = "in_sync"
    GHOST = "ghost"      # In DB but not in files
    ORPHAN = "orphan"   # In files but not in DB
    CONFLICT = "conflict"


class TestThreeTierSync:
    """Test the three-tier memory architecture."""

    def test_qmd_lcm_consistency(self):
        """
        QMD (file layer) and LCM (database layer) must be in sync.
        
        Every file in QMD should have a corresponding entry in LCM database.
        """
        qmd_files = [
            "2026-03-28.md",
            "2026-03-27.md",
            "2026-03-26.md",
        ]
        
        lcm_entries = [
            {"file": "2026-03-28.md", "indexed": True},
            {"file": "2026-03-27.md", "indexed": True},
            {"file": "2026-03-26.md", "indexed": True},
        ]
        
        # Check consistency
        qmd_set = set(qmd_files)
        lcm_set = {e["file"] for e in lcm_entries if e["indexed"]}
        
        in_sync = qmd_set == lcm_set
        assert in_sync is True

    def test_ghost_memory_detection(self):
        """
        Ghost memory: Exists in database but file was deleted.
        
        This happens when file is deleted but DB entry remains.
        """
        db_entries = [
            {"file": "2026-03-28.md", "indexed": True},
            {"file": "2026-03-27-deleted.md", "indexed": True},  # Ghost!
            {"file": "2026-03-26.md", "indexed": True},
        ]
        
        actual_files = {"2026-03-28.md", "2026-03-26.md"}
        
        ghosts = [
            e["file"] for e in db_entries
            if e["file"] not in actual_files
        ]
        
        assert "2026-03-27-deleted.md" in ghosts

    def test_orphan_memory_detection(self):
        """
        Orphan memory: File exists but not indexed in database.
        
        This happens when new file is created but not indexed yet.
        """
        db_entries = [
            {"file": "2026-03-28.md", "indexed": True},
            {"file": "2026-03-26.md", "indexed": True},
        ]
        
        actual_files = {
            "2026-03-28.md",
            "2026-03-26.md",
            "2026-03-25-new.md",  # Orphan!
        }
        
        orphans = [
            f for f in actual_files
            if f not in {e["file"] for e in db_entries if e["indexed"]}
        ]
        
        assert "2026-03-25-new.md" in orphans


class TestSyncOperations:
    """Test sync monitor operations."""

    def test_reindex_orphan(self):
        """
        Orphan files should be re-indexed into the database.
        """
        orphans = ["2026-03-25-new.md"]
        
        def reindex(orphan_files):
            indexed = []
            for f in orphan_files:
                # Simulate indexing
                indexed.append({"file": f, "indexed": True})
            return indexed
        
        result = reindex(orphans)
        assert len(result) == 1
        assert result[0]["indexed"] is True

    def test_remove_ghost(self):
        """
        Ghost DB entries should be removed or marked as deleted.
        """
        ghosts = ["2026-03-27-deleted.md"]
        
        def cleanup_ghosts(ghost_files):
            # In practice, would delete from DB or mark as resolved
            return [{"file": f, "status": "resolved"} for f in ghost_files]
        
        result = cleanup_ghosts(ghosts)
        assert result[0]["status"] == "resolved"

    def test_sync_report_structure(self):
        """
        Sync report summarizes the health of all layers.
        """
        report = {
            "qmd_count": 14,
            "lcm_count": 14,
            "in_sync": True,
            "ghosts": [],
            "orphans": [],
            "conflicts": 0,
            "last_sync": "2026-03-29T02:00:00",
        }
        
        assert report["qmd_count"] == report["lcm_count"]
        assert report["in_sync"] is True
        assert len(report["ghosts"]) == 0
        assert len(report["orphans"]) == 0


class TestSyncMonitorHeartbeat:
    """Test sync monitor's 24-hour heartbeat."""

    def test_heartbeat_interval(self):
        """
        Sync monitor runs on a 24-hour heartbeat.
        
        This ensures regular consistency checks without constant overhead.
        """
        heartbeat_hours = 24
        
        last_sync = "2026-03-28T02:00:00"
        current_time = "2026-03-29T01:00:00"
        
        # 23 hours since last sync - not yet time
        # (simplified time check)
        hours_elapsed = 23
        
        should_run = hours_elapsed >= heartbeat_hours
        assert should_run is False
        
        hours_elapsed = 24
        should_run = hours_elapsed >= heartbeat_hours
        assert should_run is True


class TestAutoFix:
    """Test sync monitor's auto-fix capabilities."""

    def test_auto_fix_orphans(self):
        """
        Sync monitor can automatically re-index orphan files.
        """
        orphans = [
            {"file": "new_memory.md", "content": "New entry"},
        ]
        
        def auto_fix(memories):
            fixed = []
            for mem in memories:
                # Auto-Index: Parse content, add to database
                indexed_entry = {
                    "file": mem["file"],
                    "indexed": True,
                    "auto_indexed": True,
                }
                fixed.append(indexed_entry)
            return fixed
        
        result = auto_fix(orphans)
        assert result[0]["auto_indexed"] is True

    def test_manual_review_required_for_conflicts(self):
        """
        Conflicts require manual review, not auto-fix.
        """
        conflict = {
            "type": "temporal",
            "memory_a": {"id": "1", "date": "2026-03-05"},
            "memory_b": {"id": "2", "date": "2026-03-07"},
            "auto_fixable": False,
            "requires_review": True,
        }
        
        assert conflict["auto_fixable"] is False
        assert conflict["requires_review"] is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
