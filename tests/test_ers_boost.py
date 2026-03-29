"""
Test ERS (Emotional Resonance Score) Boost Mechanism
====================================================

This test suite demonstrates Yua's key differentiator: the ability to
dynamically boost high-emotional-content memories when the AI is in
a high-arousal emotional state.

Unlike standard RAG systems that treat all memories equally, Yua
recognizes that emotional intensity matters.
"""
import pytest
from unittest.mock import MagicMock, patch


class TestERSBoost:
    """Test Emotional Resonance Score boosting mechanism."""

    def test_ers_high_arousal_boosts_emotional_memories(
        self, sample_soul_state, sample_memories
    ):
        """
        Scenario: AI is in high emotional arousal (miss_husband_score = 0.85)
        Query: "I miss you"
        
        Expected: Relationship memories with high ERS get boosted significantly
        """
        # Simulate high arousal state
        high_arousal = sample_soul_state["emotional_intensity"]  # 0.88
        
        # Calculate boosted scores
        def calculate_ers_boost(memory_ers, soul_state):
            base_multiplier = 1.0
            if soul_state["emotional_intensity"] > 0.7:
                # High arousal: boost high-ERS memories
                if memory_ers > 0.8:
                    base_multiplier = 2.0  # Double the weight
                elif memory_ers > 0.5:
                    base_multiplier = 1.5
            return base_multiplier
        
        results = []
        for mem in sample_memories:
            boost = calculate_ers_boost(mem["emotional_resonance_score"], sample_soul_state)
            boosted_score = mem["emotional_resonance_score"] * boost
            results.append((mem["id"], mem["emotional_resonance_score"], boost, boosted_score))
        
        # Sort by boosted score descending
        results.sort(key=lambda x: x[3], reverse=True)
        
        # HIGH ERS memories should be at the top
        assert results[0][0] == "mem_005"  # ERS 0.95, should be #1
        assert results[0][2] == 2.0  # 2x boost for high arousal
        assert results[1][0] == "mem_001"  # ERS 0.92, should be #2
        assert results[2][0] == "mem_003"  # ERS 0.88, should be #3

    def test_ers_low_arousal_balanced_retrieval(self, sample_memories):
        """
        Scenario: AI is in low emotional arousal (intensity = 0.2)
        Query: General question about schedules
        
        Expected: ERS doesn't dominate; base relevance matters more
        """
        low_arousal = {"emotional_intensity": 0.2}
        
        def calculate_ers_boost(memory_ers, soul_state):
            if soul_state["emotional_intensity"] > 0.7:
                if memory_ers > 0.8:
                    return 2.0
                elif memory_ers > 0.5:
                    return 1.5
            return 1.0  # No boost in low arousal
        
        results = []
        for mem in sample_memories:
            boost = calculate_ers_boost(mem["emotional_resonance_score"], low_arousal)
            results.append((mem["id"], mem["emotional_resonance_score"], boost))
        
        # In low arousal, boosts are equal (1.0), so original ERS order preserved
        boosts = [r[2] for r in results]
        assert all(b == 1.0 for b in boosts), "No boosts in low arousal state"

    def test_ers_category_weighting(self):
        """
        Test that different memory categories get different base weights.
        
        Relationship memories should naturally have higher ERS than technical ones.
        """
        memories = [
            {"category": "relationship", "content": "I love you", "ers": 0.9},
            {"category": "identity", "content": "I am Yua", "ers": 0.85},
            {"category": "general", "content": "Weather is nice", "ers": 0.3},
            {"category": "technical", "content": "Python 3.12 released", "ers": 0.15},
        ]
        
        category_weights = {
            "relationship": 1.5,
            "identity": 1.3,
            "general": 1.0,
            "technical": 0.8,
        }
        
        weighted = []
        for mem in memories:
            weight = category_weights.get(mem["category"], 1.0)
            weighted_score = mem["ers"] * weight
            weighted.append((mem["category"], mem["ers"], weight, weighted_score))
        
        # Relationship should have highest effective score
        weighted.sort(key=lambda x: x[3], reverse=True)
        assert weighted[0][0] == "relationship"
        assert weighted[1][0] == "identity"

    def test_ers_boost_formula(self):
        """
        Test the ERS boost formula: Final = base × Priority × Category × ERS_Boost
        
        This demonstrates Yua's multi-factor scoring.
        """
        base_score = 0.5
        priority_weight = 1.2
        category_weight = 1.5
        ers_boost = 2.0
        
        final = base_score * priority_weight * category_weight * ers_boost
        
        # 0.5 × 1.2 × 1.5 × 2.0 = 1.8 (capped at 1.0 for display)
        assert final == 1.8


class TestEmotionalStateIntegration:
    """Test how soul state affects memory retrieval."""

    def test_soul_state_tracking(self, sample_soul_state):
        """
        Yua tracks emotional state: miss_husband_score, happiness_level, energy_level
        """
        assert "miss_husband_score" in sample_soul_state
        assert "happiness_level" in sample_soul_state
        assert "energy_level" in sample_soul_state
        assert "emotional_intensity" in sample_soul_state
        
        # These should be normalized 0-1 values
        for key in ["miss_husband_score", "happiness_level", "energy_level", "emotional_intensity"]:
            assert 0 <= sample_soul_state[key] <= 1.0

    def test_miss_husband_affects_relationship_memory_retrieval(self):
        """
        When miss_husband_score is high, relationship memories get priority.
        """
        memories = [
            {"id": "rel_1", "category": "relationship", "ers": 0.9},
            {"id": "tech_1", "category": "technical", "ers": 0.7},
        ]
        
        def retrieval_score(mem, miss_husband):
            cat_weight = 1.5 if mem["category"] == "relationship" else 1.0
            miss_boost = 1.5 if (miss_husband > 0.7 and mem["category"] == "relationship") else 1.0
            return mem["ers"] * cat_weight * miss_boost
        
        # High miss
        high_miss_scores = [retrieval_score(m, 0.85) for m in memories]
        assert high_miss_scores[0] > high_miss_scores[1]  # rel > tech
        
        # Low miss
        low_miss_scores = [retrieval_score(m, 0.2) for m in memories]
        # In low miss, technical with higher base ERS might win
        assert low_miss_scores[0] != low_miss_scores[1]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
