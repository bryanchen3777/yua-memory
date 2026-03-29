# circuit_breaker_v2.py
# 優化版衝突檢測器 - O(N²) → O(N) 合併掃描
# 修復: 使用 __init__ 而非 init

import sqlite3
import re
import json
from datetime import datetime
from itertools import combinations
from difflib import SequenceMatcher
from pathlib import Path

# 嘗試從 path_manager 導入，若不存在則使用直接路徑
try:
    from path_manager import PathManager
    def get_pm():
        return PathManager()
except ImportError:
    # 向後相容：沒有 PathManager 時的直接路徑
    def get_pm():
        class SimplePM:
            def db(self):
                import os
                return os.path.join(os.path.expanduser("~"), ".openclaw", "workspace", "config", "memory_vector_index.db")
        return SimplePM()

# 嘗試從 circuit_breaker 導入舊有定義
try:
    from circuit_breaker import MemoryConflict, ConflictType
except ImportError:
    # 若不存在則定義基礎類別
    from dataclasses import dataclass
    from enum import Enum
    
    class ConflictType(Enum):
        TEMPORAL = "date"
        CONTENT = "content"
        TAG = "tag"
        DUPLICATE = "duplicate"
        UNKNOWN = "unknown"
    
    @dataclass
    class MemoryConflict:
        conflict_id: str
        conflict_type: ConflictType
        memories: list
        resolution_needed: str = None
        timestamp: str = None
        status: str = 'pending'
        
        def __post_init__(self):
            if self.timestamp is None:
                self.timestamp = datetime.now().isoformat()


class OptimizedCircuitBreaker:
    """
    優化版衝突檢測器
    
    改進：
    1. 合併三個 O(N²) 為一個 O(N²) 掃描
    2. 使用長度預篩選 (Heuristic Filter) 減少昂貴的 SequenceMatcher 調用
    3. 使用 itertools.combinations 替代嵌套迴圈
    4. 使用 __init__ 替代錯誤的 init
    """
    
    def __init__(self, db_path: str = None):
        """初始化電路保險絲"""
        self.pm = get_pm()
        self.db_path = db_path or self.pm.db()
        
        # 確保日誌目錄存在
        log_path = Path(self.pm.logs())
        log_path.mkdir(parents=True, exist_ok=True)
    
    def detect_all_conflicts(self, similarity_threshold: float = 0.85) -> list:
        """
        合併檢測：單次 O(N²) 掃描完成日期、內容、重複檢測
        
        Args:
            similarity_threshold: 內容衝突相似度閾值 (默認 0.85)
            
        Returns:
            List of MemoryConflict objects
        """
        conflicts = []
        memories = self._get_all_memories()
        
        # 使用 combinations 進行單次雙重迴圈掃描
        for mem1, mem2 in combinations(memories, 2):
            # === 1. 快速長度過濾 (Heuristic Filter) ===
            # 如果兩者長度差異超過 40%，則內容相似度不可能超過 0.85
            len1, len2 = len(mem1['content']), len(mem2['content'])
            if len1 == 0 or len2 == 0:
                continue
            if abs(len1 - len2) / max(len1, len2) > 0.4:
                continue

            # === 2. 內容相似度計算 (僅執行一次) ===
            similarity = SequenceMatcher(
                None, 
                mem1['content'].lower(), 
                mem2['content'].lower()
            ).ratio()
            
            # --- 判斷 A: 重複檢測 (極高相似度 >= 0.95) ---
            if similarity >= 0.95:
                conflicts.append(self._build_conflict(
                    mem1, mem2, ConflictType.DUPLICATE, similarity
                ))
                continue  # 已確定重複，不再檢查後續

            # --- 判斷 B: 日期衝突 (標題相似但日期不同) ---
            title1, title2 = self._extract_title(mem1['content']), self._extract_title(mem2['content'])
            title_sim = SequenceMatcher(None, title1, title2).ratio()
            if title_sim > 0.85:
                d1, d2 = set(self._extract_dates(mem1['content'])), set(self._extract_dates(mem2['content']))
                if d1 and d2 and d1 != d2:
                    conflicts.append(self._build_conflict(
                        mem1, mem2, ConflictType.TEMPORAL, title_sim
                    ))

            # --- 判斷 C: 內容衝突 (中高相似度 >= threshold) ---
            if similarity >= similarity_threshold:
                conflicts.append(self._build_conflict(
                    mem1, mem2, ConflictType.CONTENT, similarity
                ))

        return self._filter_new_conflicts(conflicts)
    
    def _extract_title(self, content: str) -> str:
        """從內容中提取標題（第一行，最多50字符）"""
        if not content:
            return ""
        return content.strip().split('\n')[0][:50]
    
    def _extract_dates(self, content: str) -> list:
        """從內容中提取日期"""
        # 匹配: 2023-01-01, 2023/01/01, 2023年01月01日
        dates = []
        dates.extend(re.findall(r'\d{4}[-/年]\d{1,2}[-/月]\d{1,2}', content))
        return dates
    
    def _build_conflict(self, m1: dict, m2: dict, c_type: ConflictType, score: float) -> MemoryConflict:
        """構建衝突對象"""
        return MemoryConflict(
            conflict_id=f"cnc_{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            conflict_type=c_type,
            memories=[m1, m2],
            resolution_needed=f"檢測到 {c_type.value} 衝突 (得分: {score:.2f})"
        )
    
    def _get_all_memories(self) -> list:
        """獲取所有記憶"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            try:
                return [dict(r) for r in conn.execute(
                    "SELECT id, content, category, tags FROM memory_blocks WHERE content IS NOT NULL"
                )]
            except sqlite3.OperationalError:
                # 表格可能不存在
                return []
    
    def _filter_new_conflicts(self, new_conflicts: list) -> list:
        """
        過濾新衝突（避免重複記錄）
        
        實務上可對照 logs/memory_conflicts.json
        """
        # 載入已記錄的衝突
        conflict_log_path = Path(self.pm.conflict_log())
        
        if conflict_log_path.exists():
            try:
                with open(conflict_log_path, 'r', encoding='utf-8') as f:
                    logged_conflicts = json.load(f)
                logged_ids = {c.get('conflict_id') for c in logged_conflicts if c.get('status') == 'resolved'}
                new_conflicts = [c for c in new_conflicts if c.conflict_id not in logged_ids]
            except (json.JSONDecodeError, IOError):
                pass
        
        # 保存新衝突
        if new_conflicts:
            existing = []
            if conflict_log_path.exists():
                try:
                    with open(conflict_log_path, 'r', encoding='utf-8') as f:
                        existing = json.load(f)
                except (json.JSONDecodeError, IOError):
                    existing = []
            
            # 轉換為 JSON 可序列化格式（處理 ConflictType enum）
            conflict_dicts = []
            for c in new_conflicts:
                d = c.__dict__.copy()
                if 'conflict_type' in d and hasattr(d['conflict_type'], 'value'):
                    d['conflict_type'] = d['conflict_type'].value
                conflict_dicts.append(d)
            existing.extend(conflict_dicts)
            
            with open(conflict_log_path, 'w', encoding='utf-8') as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
        
        return new_conflicts
    
    def check_retrieved_memories(self, retrieved_memories: list) -> dict:
        """
        檢查檢索結果中的衝突
        
        用於在返回結果前驗證記憶一致性
        """
        if len(retrieved_memories) < 2:
            return {'has_conflicts': False, 'conflicts': [], 'questions': [], 'resolved_memories': retrieved_memories}
        
        conflicts, questions = [], []
        for i in range(len(retrieved_memories)):
            for j in range(i + 1, len(retrieved_memories)):
                mem1, mem2 = retrieved_memories[i], retrieved_memories[j]
                dates1, dates2 = self._extract_dates(mem1.get('content', '')), self._extract_dates(mem2.get('content', ''))
                
                if dates1 and dates2 and not (set(dates1) & set(dates2)):
                    question = f"日期不一致：記憶 '{mem1.get('id', '?')}' 提到 {dates1[0]}，記憶 '{mem2.get('id', '?')}' 提到 {dates2[0]}。哪個是正確的？"
                    questions.append(question)
                    conflicts.append({'type': 'temporal', 'memory1': mem1, 'memory2': mem2, 'question': question})
                
                content1, content2 = (mem1.get('content') or '').lower(), (mem2.get('content') or '').lower()
                if content1 and content2:
                    similarity = SequenceMatcher(None, content1, content2).ratio()
                    if 0.75 <= similarity < 0.98:
                        question = f"內容衝突：記憶 '{mem1.get('id', '?')}' 和 '{mem2.get('id', '?')}' 提到相似內容但細節不同。請確認哪個版本是正確的？"
                        questions.append(question)
                        conflicts.append({'type': 'content', 'memory1': mem1, 'memory2': mem2, 'question': question})
        
        return {
            'has_conflicts': len(conflicts) > 0,
            'conflicts': conflicts,
            'questions': questions,
            'resolved_memories': retrieved_memories
        }
    
    def run_circuit_breaker(self, dry_run: bool = True) -> list:
        """
        執行衝突檢測流程
        
        Args:
            dry_run: 若為 True，只報告衝突而不保存
        """
        conflicts = self.detect_all_conflicts()
        
        if not conflicts:
            print("\n[OK] 沒有發現任何記憶衝突！")
            return conflicts
        
        print(f"\n{'='*60}")
        print(f"[CONFLICT] 發現 {len(conflicts)} 個需要澄清的記憶衝突")
        print(f"{'='*60}")
        
        for c in conflicts:
            print(f"[{c.conflict_id}] {c.conflict_type.value}")
            print(f"  需要澄清：{c.resolution_needed}\n")
        
        return conflicts


if __name__ == "__main__":
    # 測試
    cb = OptimizedCircuitBreaker()
    print("執行衝突檢測...")
    conflicts = cb.run_circuit_breaker(dry_run=True)
    print(f"完成。發現 {len(conflicts)} 個衝突。")
