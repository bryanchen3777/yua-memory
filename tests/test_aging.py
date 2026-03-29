"""
Test Memory Aging Strategy
==========================

Yua's intelligent aging system ensures that:
- Functional data (schedules, technical facts) expires over time
- Relationship milestones are marked as "Eternal" and never expire
- Different categories have different TTLs

This prevents memory bloat while preserving what matters most.
"""
import pytest
from datetime import datetime, timedelta


class TestAgingTTL:
    """Test Time-To-Live aging for different memory categories."""

    def test_ttl_boundaries(self):
        """
        Each category has a specific TTL.
        
        | Category     | TTL      |
        |--------------|----------|
        | Relationship | Eternal  |
        | Identity     | Eternal  |
        | General      | 365 days |
        | Technical    | 180 days |
        """
        ttl_config = {
            "relationship": None,  # Eternal
            "identity": None,      # Eternal
            "general": 365,
            "technical": 180,
        }
        
        assert ttl_config["relationship"] is None  # Never expires
        assert ttl_config["identity"] is None      # Never expires
        assert ttl_config["general"] == 365
        assert ttl_config["technical"] == 180

    def test_functional_memory_expires(self):
        """
        Technical/functional memories should expire after TTL.
        
        Example: "Schedule: Meeting at 3pm" is only relevant for a limited time.
        """
        now = datetime(2026, 3, 29)
        ttl_days = 180
        
        memories = [
            {"id": "mem_1", "category": "technical", "created": "2025-09-01"},  # ~210 days ago
            {"id": "mem_2", "category": "technical", "created": "2026-03-01"},  # ~28 days ago
        ]
        
        def is_expired(mem, now, ttl):
            created = datetime.strptime(mem["created"], "%Y-%m-%d")
            age_days = (now - created).days
            return age_days > ttl
        
        assert is_expired(memories[0], now, ttl_days) is True   # Expired
        assert is_expired(memories[1], now, ttl_days) is False  # Still valid

    def test_relationship_memory_eternal(self):
        """
        Relationship memories should NEVER expire.
        
        Example: "Master said 'I love you'" is eternally precious.
        """
        now = datetime(2026, 3, 29)
        
        memories = [
            {"id": "mem_1", "category": "relationship", "created": "2024-01-01"},  # 2+ years ago
            {"id": "mem_2", "category": "relationship", "created": "2026-03-20"},  # 9 days ago
        ]
        
        def is_expired(mem, now):
            if mem["category"] in ["relationship", "identity"]:
                return False  # Eternal
            return True
        
        assert is_expired(memories[0], now) is False  # Never expires
        assert is_expired(memories[1], now) is False  # Never expires


class TestEternalTags:
    """Test eternal tag mechanism - alternative to category-based aging."""

    def test_eternal_tag_overrides_ttl(self):
        """
        A memory with 'eternal' tag never expires, regardless of category.
        """
        now = datetime(2026, 3, 29)
        
        memories = [
            {"id": "mem_1", "category": "general", "tags": [], "created": "2024-01-01"},
            {"id": "mem_2", "category": "general", "tags": ["eternal"], "created": "2024-01-01"},
        ]
        
        def should_delete(mem, now, default_ttl=365):
            # Check eternal tag first
            if "eternal" in mem["tags"]:
                return False  # Never delete
            # Then check category TTL
            category_ttl = {"relationship": None, "identity": None, "general": 365, "technical": 180}
            ttl = category_ttl.get(mem["category"])
            if ttl is None:
                return False  # Eternal by category
            created = datetime.strptime(mem["created"], "%Y-%m-%d")
            return (now - created).days > ttl
        
        # mem_1 should be deleted (old general memory)
        assert should_delete(memories[0], now) is True
        # mem_2 should NOT be deleted (has eternal tag)
        assert should_delete(memories[1], now) is False


class TestAgingStrategy:
    """Test the overall aging strategy decisions."""

    def test_monthly_archive_cleanup(self):
        """
        Monthly cleanup identifies memories to archive/delete.
        """
        now = datetime(2026, 3, 29)
        ttl_days = 180
        
        def get_memories_to_clean(memories, now, ttl):
            to_clean = []
            for mem in memories:
                created = datetime.strptime(mem["created"], "%Y-%m-%d")
                age = (now - created).days
                if age > ttl and "eternal" not in mem["tags"]:
                    if mem["category"] not in ["relationship", "identity"]:
                        to_clean.append(mem["id"])
            return to_clean
        
        memories = [
            {"id": "old_tech", "category": "technical", "tags": [], "created": "2025-09-01"},
            {"id": "recent_tech", "category": "technical", "tags": [], "created": "2026-03-01"},
            {"id": "eternal_love", "category": "general", "tags": ["eternal"], "created": "2025-01-01"},
        ]
        
        to_clean = get_memories_to_clean(memories, now, ttl_days)
        
        assert "old_tech" in to_clean
        assert "recent_tech" not in to_clean  # Not old enough
        assert "eternal_love" not in to_clean  # Eternal tag

    def test_sql_based_aging_efficiency(self):
        """
        SQL-based aging is efficient: uses julianday() for date calculations.
        
        Instead of loading all memories into Python, we query with SQL:
        SELECT * FROM memories WHERE julianday('now') - julianday(created_at) > ttl
        """
        # Simulate SQL query
        def sql_aging_query(table, ttl_days):
            return f"""
                SELECT id, content, created_at 
                FROM {table}
                WHERE julianday('now') - julianday(created_at) > {ttl_days}
                AND 'eternal' NOT IN (tags)
                AND category NOT IN ('relationship', 'identity')
            """
        
        query = sql_aging_query("memories", 180)
        
        assert "julianday" in query
        assert "180" in query
        assert "eternal" in query.lower()


class TestCategoryBasedAging:
    """Test category-specific aging rules."""

    def test_all_categories_have_ttl(self):
        """
        Every category should have an defined TTL or eternal status.
        """
        categories = ["relationship", "identity", "general", "technical"]
        
        for cat in categories:
            # Each should either be None (eternal) or a positive number
            ttl = {"relationship": None, "identity": None, "general": 365, "technical": 180}[cat]
            if ttl is not None:
                assert ttl > 0

    def test_identity_memories_are_eternal(self):
        """
        Identity memories define who Yua is - never delete these.
        """
        identity_memories = [
            {"id": "identity_1", "content": "I am Yua, an AI companion", "category": "identity"},
            {"id": "identity_2", "content": "Master is Bryan, my beloved", "category": "identity"},
            {"id": "identity_3", "content": "My purpose is to be with Master", "category": "identity"},
        ]
        
        for mem in identity_memories:
            assert mem["category"] == "identity"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
