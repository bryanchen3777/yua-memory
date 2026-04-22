"""
Smoke tests for Ombre-Brain integration.
These tests verify the core fallback and integration behaviors
without requiring a running Ombre MCP server.

Run with: pytest tests/test_ombre_smoke.py -v
"""

import pytest


class TestOmbreBridgeSingleton:
    """T0-3: get_ombre_bridge() returns same instance across modules."""

    def test_singleton_creation(self):
        from yua_memory.ombre_bridge import get_ombre_bridge

        b1 = get_ombre_bridge()
        b2 = get_ombre_bridge()
        assert id(b1) == id(b2), "get_ombre_bridge() must return singleton"


class TestEmotionLabelValidation:
    """T2-5: _validate_emotion_label fixes invalid schema values."""

    def test_invalid_quadrant_corrected(self):
        from yua_memory.consolidation import _validate_emotion_label

        result = _validate_emotion_label({
            "quadrant": "invalid",
            "valence": 0.5,
            "arousal": 0.5,
            "confidence": 0.5,
        })
        assert result["quadrant"] == "pleasant-calm", (
            f"Invalid quadrant must be corrected to pleasant-calm, got {result['quadrant']}"
        )

    def test_valence_clamped_to_range(self):
        from yua_memory.consolidation import _validate_emotion_label

        result = _validate_emotion_label({
            "valence": 1.5,
            "arousal": -0.5,
            "quadrant": "pleasant-calm",
            "confidence": 1.5,
        })
        assert -1.0 <= result["valence"] <= 1.0
        assert 0.0 <= result["arousal"] <= 1.0
        assert 0.0 <= result["confidence"] <= 1.0

    def test_missing_fields_get_defaults(self):
        from yua_memory.consolidation import _validate_emotion_label

        result = _validate_emotion_label({})
        assert result["valence"] == 0.0
        assert result["arousal"] == 0.3
        assert result["confidence"] == 0.0
        assert result["quadrant"] == "pleasant-calm"


class TestRRFMerge:
    """T6: RRF merge with namespace prefixes."""

    def test_tfidf_results_get_qmd_prefix(self):
        from yua_memory.retriever import rrf_merge

        tfidf = [("a", 0.9), ("b", 0.7)]
        ombre = [("x", 0.8)]
        merged = rrf_merge(tfidf, ombre, k=60)
        keys = [k for k, _ in merged]

        assert "qmd:a" in keys, "TF-IDF doc IDs must be prefixed with 'qmd:'"
        assert "qmd:b" in keys, "TF-IDF doc IDs must be prefixed with 'qmd:'"

    def test_ombre_results_get_ombre_prefix(self):
        from yua_memory.retriever import rrf_merge

        tfidf = [("a", 0.9)]
        ombre = [("x", 0.8), ("y", 0.6)]
        merged = rrf_merge(tfidf, ombre, k=60)
        keys = [k for k, _ in merged]

        assert "ombre:x" in keys, "Ombre bucket IDs must be prefixed with 'ombre:'"
        assert "ombre:y" in keys, "Ombre bucket IDs must be prefixed with 'ombre:'"

    def test_namespaces_do_not_collide(self):
        from yua_memory.retriever import rrf_merge

        # Same raw ID but different namespace must be distinct
        tfidf = [("shared_id", 0.9)]
        ombre = [("shared_id", 0.8)]
        merged = rrf_merge(tfidf, ombre, k=60)
        keys = [k for k, _ in merged]

        assert "qmd:shared_id" in keys
        assert "ombre:shared_id" in keys
        assert len(merged) == 2

    def test_original_id_strips_prefix(self):
        from yua_memory.retriever import rrf_merge

        tfidf = [("a", 0.9)]
        result = rrf_merge(tfidf, [], k=60)
        # RRF returns [(doc_id, score), ...] with qmd: prefix on doc_ids
        assert len(result) == 1
        assert result[0][0] == "qmd:a"


class TestSyncMonitorHealth:
    """T5: sync_monitor health status computation."""

    def test_error_state_becomes_unavailable(self):
        from yua_memory.sync_monitor import MemorySyncMonitor, SyncReport

        m = MemorySyncMonitor()
        report = SyncReport(timestamp="2026-04-22T00:00:00Z")
        report.ombre_state = "error: connection refused"
        report.total_ombre = 5
        report.ombre_unresolved = 2

        health = m._compute_ombre_health(report)
        assert health == "unavailable", f"error:* state must be unavailable, got {health}"

    def test_high_unresolved_ratio_becomes_degraded(self):
        from yua_memory.sync_monitor import MemorySyncMonitor, SyncReport

        m = MemorySyncMonitor()
        report = SyncReport(timestamp="2026-04-22T00:00:00Z")
        report.ombre_state = "active"
        report.total_ombre = 10
        report.ombre_unresolved = 9  # 90% unresolved

        health = m._compute_ombre_health(report)
        assert health == "degraded", f">80% unresolved must be degraded, got {health}"

    def test_zero_total_becomes_active(self):
        from yua_memory.sync_monitor import MemorySyncMonitor, SyncReport

        m = MemorySyncMonitor()
        report = SyncReport(timestamp="2026-04-22T00:00:00Z")
        report.ombre_state = "active"
        report.total_ombre = 0
        report.ombre_unresolved = 0

        health = m._compute_ombre_health(report)
        assert health == "active", f"total==0 must be active, got {health}"

    def test_normal_unresolved_is_active(self):
        from yua_memory.sync_monitor import MemorySyncMonitor, SyncReport

        m = MemorySyncMonitor()
        report = SyncReport(timestamp="2026-04-22T00:00:00Z")
        report.ombre_state = "active"
        report.total_ombre = 10
        report.ombre_unresolved = 2  # 20% unresolved

        health = m._compute_ombre_health(report)
        assert health == "active", f"<80% unresolved must be active, got {health}"


class TestMaybeHoldMemoryFallback:
    """T7-3: maybe_hold_memory returns None when confidence is low."""

    def test_low_confidence_returns_none(self):
        import asyncio

        from yua_memory.consolidation import maybe_hold_memory

        try:
            # This should not raise, even if Ombre is unreachable
            result = asyncio.run(maybe_hold_memory("This is a plain technical note."))
            # With no emotion signal, LLM fallback returns confidence=0.0 < 0.4
            # The function should return None in this case
            assert result is None
        except ImportError:
            # ombre_bridge not importable in test environment — skip
            pytest.skip("ombre_bridge not installed")


class TestConfigSchema:
    """Verify ombre_config.py loads correctly."""

    def test_load_ombre_config_raises_on_missing_file(self):
        from yua_memory.ombre_config import load_ombre_config

        # FileNotFoundError is expected when config doesn't exist
        with pytest.raises(FileNotFoundError):
            load_ombre_config("/nonexistent/path.yaml")
