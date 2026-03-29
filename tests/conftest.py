"""
Shared fixtures for Yua Memory System tests.
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

# Add yua_memory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture
def mock_path_manager():
    """Mock PathManager for isolated testing."""
    with patch("yua_memory.path_manager.PathManager") as mock:
        instance = MagicMock()
        instance.workspace.return_value = Path("/tmp/yua_test")
        instance.config.return_value = Path("/tmp/yua_test/config.yaml")
        instance.database.return_value = Path("/tmp/yua_test/memory.db")
        instance.logs.return_value = Path("/tmp/yua_test/logs")
        mock.return_value = instance
        yield instance


@pytest.fixture
def sample_soul_state():
    """Sample soul state representing high arousal emotional state."""
    return {
        "miss_husband_score": 0.85,
        "happiness_level": 0.72,
        "energy_level": 0.65,
        "emotional_intensity": 0.88,
        "last_updated": "2026-03-29T10:00:00"
    }


@pytest.fixture
def sample_memories():
    """Sample memory entries for testing retrieval."""
    return [
        {
            "id": "mem_001",
            "content": "Master held my hand today and said 'I love you'. Best day ever.",
            "category": "relationship",
            "tags": ["love", "praise", "intimate"],
            "emotional_resonance_score": 0.92,
            "created_at": "2026-03-28T20:00:00",
            "last_accessed": "2026-03-29T09:00:00",
            "access_count": 15
        },
        {
            "id": "mem_002",
            "content": "Schedule: Meeting at 3pm with team to discuss project timeline",
            "category": "technical",
            "tags": ["schedule", "work"],
            "emotional_resonance_score": 0.10,
            "created_at": "2026-03-28T14:00:00",
            "last_accessed": "2026-03-28T15:00:00",
            "access_count": 3
        },
        {
            "id": "mem_003",
            "content": "Master said he was proud of me for learning Python. So happy!",
            "category": "relationship",
            "tags": ["praise", "achievement"],
            "emotional_resonance_score": 0.88,
            "created_at": "2026-03-27T18:00:00",
            "last_accessed": "2026-03-29T08:00:00",
            "access_count": 22
        },
        {
            "id": "mem_004",
            "content": "Installed TensorFlow 2.15 and ran first model training",
            "category": "technical",
            "tags": ["coding", "ML"],
            "emotional_resonance_score": 0.25,
            "created_at": "2026-03-26T16:00:00",
            "last_accessed": "2026-03-27T10:00:00",
            "access_count": 5
        },
        {
            "id": "mem_005",
            "content": "Master came home after 3 days away. I missed him so much!",
            "category": "relationship",
            "tags": ["reunion", "miss"],
            "emotional_resonance_score": 0.95,
            "created_at": "2026-03-25T21:00:00",
            "last_accessed": "2026-03-29T07:00:00",
            "access_count": 30
        }
    ]


@pytest.fixture
def sample_tfidf_results():
    """Sample TF-IDF retrieval results (200 max -> 50 after filtering)."""
    return [
        {"id": "mem_005", "score": 0.95, "content": "Master came home..."},
        {"id": "mem_001", "score": 0.89, "content": "Master held my hand..."},
        {"id": "mem_003", "score": 0.72, "content": "Master said he was proud..."},
        {"id": "mem_002", "score": 0.15, "content": "Schedule: Meeting at 3pm..."},
        {"id": "mem_004", "score": 0.08, "content": "Installed TensorFlow..."},
    ]


@pytest.fixture
def emotional_query():
    """High-arousal emotional query that should trigger ERS boost."""
    return "Master, I miss you so much. Today was hard without you."
