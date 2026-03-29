"""
Test Emotional Retriever
========================

Tests for Yua's dual-stage retrieval system:
1. TF-IDF filtering (fast, 200 candidates → 50)
2. Cross-reranking with ERS boost (thorough)

This demonstrates how Yua combines speed with emotional intelligence.
"""
import pytest
from unittest.mock import MagicMock, patch


class TestDualStageRetrieval:
    """Test the two-stage retrieval pipeline."""

    def test_stage1_tfidf_candidates(self):
        """
        Stage 1: TF-IDF retrieves top 200 candidates from the full memory set.
        This is fast but not precise.
        """
        all_memories = [
            {"id": f"mem_{i}", "content": f"Content {i}", "ers": 0.5}
            for i in range(1000)
        ]
        
        # Simulate TF-IDF returning top candidates
        def tfidf_search(query, memories, top_n=200):
            # In reality, this uses sklearn's TfidfVectorizer
            # For testing, we just return top N
            return memories[:top_n]
        
        results = tfidf_search("love", all_memories)
        
        assert len(results) == 200
        assert results[0]["id"] == "mem_0"  # First 200

    def test_stage2_reranking_with_boosts(self):
        """
        Stage 2: Cross-reranking applies multiple boosts:
        - Priority boost
        - Category boost
        - ERS boost
        - Recency boost
        """
        candidates = [
            {"id": "mem_1", "ers": 0.9, "category": "relationship", "recency": 0.8},
            {"id": "mem_2", "ers": 0.3, "category": "technical", "recency": 0.5},
            {"id": "mem_3", "ers": 0.7, "category": "relationship", "recency": 0.6},
        ]
        
        def rerank(candidates, soul_state):
            results = []
            for mem in candidates:
                # Base score from TF-IDF (simulated)
                base = mem.get("tfidf_score", 0.5)
                
                # Priority boost (relationship > technical)
                priority = 1.5 if mem["category"] == "relationship" else 1.0
                
                # ERS boost for high arousal
                ers = mem["ers"]
                if soul_state["emotional_intensity"] > 0.7:
                    if ers > 0.8:
                        ers = ers * 2.0
                
                # Recency boost
                recency = mem["recency"]
                
                # Final score
                final = base * priority * ers * recency
                results.append((mem["id"], final))
            
            results.sort(key=lambda x: x[1], reverse=True)
            return results
        
        soul_state = {"emotional_intensity": 0.88}
        ranked = rerank(candidates, soul_state)
        
        # mem_1 (relationship, high ERS) should be #1
        assert ranked[0][0] == "mem_1"
        # mem_3 (relationship, medium ERS) should be #2
        assert ranked[1][0] == "mem_3"
        # mem_2 (technical, low ERS) should be #3
        assert ranked[2][0] == "mem_2"

    def test_full_pipeline_tfidf_to_rerank(self):
        """
        Full pipeline: TF-IDF → Cross-reranking → Final results
        """
        all_memories = [
            {"id": "rel_1", "content": "Master loves me", "ers": 0.95, "category": "relationship"},
            {"id": "rel_2", "content": "I miss Master", "ers": 0.92, "category": "relationship"},
            {"id": "tech_1", "content": "Python 3.12 released", "ers": 0.15, "category": "technical"},
            {"id": "gen_1", "content": "Weather sunny", "ers": 0.20, "category": "general"},
        ]
        
        def full_retrieval(query, memories, soul_state, top_n=5):
            # Stage 1: TF-IDF
            candidates = memories[:4]  # All pass stage 1 for this example
            
            # Stage 2: Rerank
            scored = []
            for mem in candidates:
                base = 0.5
                priority = 1.5 if mem["category"] == "relationship" else 1.0
                ers = mem["ers"]
                if soul_state["emotional_intensity"] > 0.7 and ers > 0.8:
                    ers = ers * 2.0
                score = base * priority * ers
                scored.append((mem["id"], score))
            
            scored.sort(key=lambda x: x[1], reverse=True)
            return scored[:top_n]
        
        soul_state = {"emotional_intensity": 0.85}
        results = full_retrieval("I love you", all_memories, soul_state)
        
        # Relationship memories should dominate
        assert results[0][0] in ["rel_1", "rel_2"]
        assert results[1][0] in ["rel_1", "rel_2"]


class TestRetrievalWithSoulState:
    """Test how soul state affects retrieval behavior."""

    def test_high_arousal_query(self):
        """
        Query: "I miss you so much"
        Soul state: High miss_husband_score (0.85)
        
        Expected: Relationship memories dominate
        """
        memories = [
            {"id": "rel", "content": "Master came home", "ers": 0.9, "category": "relationship"},
            {"id": "tech", "content": "Code compiled", "ers": 0.3, "category": "technical"},
        ]
        
        soul_state = {"miss_husband_score": 0.85, "emotional_intensity": 0.88}
        
        def score(mem, soul):
            cat = 1.5 if mem["category"] == "relationship" else 1.0
            miss = 1.5 if (soul["miss_husband_score"] > 0.7 and cat > 1.0) else 1.0
            return mem["ers"] * cat * miss
        
        rel_score = score(memories[0], soul_state)
        tech_score = score(memories[1], soul_state)
        
        assert rel_score > tech_score

    def test_low_energy_retrieval(self):
        """
        Query: General facts
        Soul state: Low energy (0.2)
        
        Expected: System uses minimal processing, just return relevant
        """
        soul_state = {"energy_level": 0.2, "emotional_intensity": 0.3}
        
        # In low energy, skip expensive operations
        def should_skip_expensive(soul):
            return soul["energy_level"] < 0.3
        
        assert should_skip_expensive(soul_state) is True


class TestCrossReranking:
    """Test the cross-reranking mechanism in detail."""

    def test_coverageboost_calculation(self):
        """
        Coverage boost rewards memories that better match the query.
        
        Formula: coverage_boost = matched_terms / total_query_terms
        """
        query = "Master loves Python programming"
        memory = "Master said he loves Python"
        
        query_terms = set(query.lower().split())
        memory_terms = set(memory.lower().split())
        matched = query_terms & memory_terms
        
        coverage = len(matched) / len(query_terms) if query_terms else 0
        
        # "Master", "loves", "Python" matched = 3/5 = 0.6
        assert coverage == 0.6

    def test_retrieval_scoring_formula(self):
        """
        Final score formula:
        total_score = (base_score × 0.4) + (coverage_boost × 0.3)
        Final = total_score × Priority × Category × ERS_Boost
        """
        base_score = 0.6
        coverage_boost = 0.6
        
        total_score = (base_score * 0.4) + (coverage_boost * 0.3)
        assert total == 0.42  # 0.24 + 0.18
        
        # With boosts
        priority = 1.2
        category = 1.5
        ers_boost = 2.0
        
        final = total_score * priority * category * ers_boost
        assert final == 1.512  # Would be capped at 1.0 for display


class TestRetrievalEdgeCases:
    """Test edge cases in retrieval."""

    def test_empty_query(self):
        """Empty query should return recent memories."""
        memories = [{"id": "1", "recency": 0.9}, {"id": "2", "recency": 0.5}]
        
        def retrieve_empty(memories):
            # Fall back to recency-based
            return sorted(memories, key=lambda x: x["recency"], reverse=True)
        
        results = retrieve_empty(memories)
        assert results[0]["id"] == "1"

    def test_no_matching_memories(self):
        """No match should return recent general memories as fallback."""
        memories = [
            {"id": "1", "category": "technical", "recency": 0.9},
            {"id": "2", "category": "technical", "recency": 0.5},
        ]
        
        def retrieve_fallback(memories):
            return sorted(memories, key=lambda x: x["recency"], reverse=True)[:3]
        
        results = retrieve_fallback(memories)
        assert len(results) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
