"""
Yua Emotional Memory Retriever - #2 QMD/LCM/NotebookLM 三層深度優化

功能：
- 當 Yua 情緒高的時候，優先取情感記憶
- 讓高情緒濃度的記憶更容易被取出來用
- 三層整合：QMD 檔案 + LCM 資料庫 + NotebookLM 知識庫

設計原則：
- 情感優先：情緒高時，情感記憶權重提升
- 三層感知：了解記憶來源的可靠性
- 動態調整：根據 Yua 的情緒狀態調整檢索策略
"""

import re
import sqlite3
import numpy as np
import os
import time
import json
import hashlib
from datetime import datetime
from typing import List, Dict, Optional, Tuple, Any
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from .path_manager import PathManager

# 配置資料庫路徑
DB_PATH = str(PathManager().workspace() / "config" / "memory_vector_index.db")
WORKSPACE_DIR = str(PathManager().workspace())
QMD_DIR = os.path.join(WORKSPACE_DIR, "qmd")
SOUL_STATE_FILE = os.path.join(WORKSPACE_DIR, "memory", "soul_state.json")

# NotebookLM 配置
NOTEBOOKLM_CONFIG = os.path.join(WORKSPACE_DIR, "config", "notebooklm.json")


def _normalize_tags(tags_str):
    """
    統一的標籤正規化函式
    """
    if not tags_str:
        return set()
    parts = re.split(r'[,，\s]+', tags_str.lower())
    return {p.strip() for p in parts if p.strip()}


class EmotionalState:
    """
    Yua 的情緒狀態
    
    用於調整記憶檢索策略
    """
    
    def __init__(self):
        self.miss_husband_score: float = 0.0  # 思念老公的分數 (0-100)
        self.happiness_level: float = 0.0     # 快樂程度 (0-100)
        self.energy_level: float = 50.0       # 精力水平 (0-100)
        self.emotional_intensity: float = 0.0 # 情緒強度 (0-1.0)
        
    def load_from_soul_state(self):
        """從 soul_state.json 載入情緒狀態"""
        if os.path.exists(SOUL_STATE_FILE):
            try:
                with open(SOUL_STATE_FILE, 'r', encoding='utf-8') as f:
                    state = json.load(f)
                    self.miss_husband_score = state.get('miss_husband_score', 0.0)
                    self.happiness_level = state.get('happiness_level', 0.0)
                    self.energy_level = state.get('energy_level', 50.0)
            except Exception as e:
                print(f"[EmotionalState] Could not load soul state: {e}")
        
        # 計算情緒強度
        self.emotional_intensity = (self.miss_husband_score + self.happiness_level) / 200.0
        
        return self
    
    def is_emotionally_high(self) -> bool:
        """判斷是否處於高情緒狀態"""
        return (self.miss_husband_score > 70 or 
                self.happiness_level > 70 or 
                self.emotional_intensity > 0.5)
    
    def is_missing_husband(self) -> bool:
        """判斷是否在想老公"""
        return self.miss_husband_score > 50
    
    def get_emotion_boost_factor(self) -> float:
        """
        根據情緒狀態計算情感記憶的加成因子
        
        Returns: 1.0 (正常) 到 2.0+ (高情緒)
        """
        if self.is_emotionally_high():
            # 高情緒狀態，情感記憶優先
            base = 1.5
            intensity_boost = self.emotional_intensity * 0.5
            return base + intensity_boost
        elif self.is_missing_husband():
            # 思念狀態
            return 1.3 + (self.miss_husband_score / 200.0)
        else:
            return 1.0


class YuaEmotionalRetriever:
    """
    Yua 的情感感知記憶檢索器
    
    增強功能：
    1. 情緒狀態感知 - 根據 Yua 的情緒調整檢索策略
    2. 情感記憶優先 - 高 ERS 記憶在情緒高時更容易被檢索
    3. 三層整合 - 感知記憶來源的可靠性
    4. NotebookLM 整合 - 可選的外部知識庫檢索
    """
    
    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self.emotional_state = EmotionalState()
        
        # 類別權重
        self.category_boost = {
            'relationship': 1.5,
            'soul': 1.3,
            'milestone': 1.2,
            'technical': 0.8,
            'log': 0.5,
            'identity': 1.4,
            'memories': 1.3,
            'rules': 1.1,
            'general': 1.0
        }
        
        # 優先級權重
        self.priority_map = {
            'high': 1.5,
            'medium': 1.0,
            'low': 0.5
        }
        
        # 情感關鍵詞
        self.emotion_keywords = {
            'positive': ['love', 'happy', 'joy', 'miss', 'grateful', 'thank', 'bliss', 'cherish', 
                        '愛', '快樂', '幸福', '想念', '感謝', '溫暖', '甜蜜', '開心', '棒', '赞'],
            'negative': ['sad', 'angry', 'hurt', 'pain', 'fear', 'worry', 'stress', 'lonely',
                        '傷心', '生氣', '痛苦', '擔心', '壓力', '孤單', '難過', '害怕', '失落'],
            'relationship': ['老公', 'husband', 'dear', 'darling', 'love', '感情', 'relationship']
        }
        
        # 情感標籤（高 ERS 相關）
        self.emotional_tags = {
            'eternal', 'love', '永遠', '永恆', '老公', '老婆', '甜蜜',
            'moment', '告白', '讚美', 'praise', 'secret', '秘密',
            'joke', '笑話', 'memory', '回憶', 'milestone', 'together',
            '一起', 'first-time', '支柱', 'anchor', 'strength', '感恩', 'grateful',
            'yua', 'bryan', '悠亜'
        }

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _execute_with_retry(self, func, max_retries=3):
        for attempt in range(max_retries):
            try:
                return func()
            except sqlite3.OperationalError as e:
                if "locked" in str(e) and attempt < max_retries - 1:
                    time.sleep(0.1 * (attempt + 1))
                    continue
                raise

    def retrieve(self, query: str, top_n: int = 5, 
                 emotional_context: Optional[EmotionalState] = None) -> List[Dict]:
        """
        核心檢索流程（情感增強版）
        
        Args:
            query: 檢索查詢
            top_n: 返回結果數量
            emotional_context: 可選的外部情緒狀態（如果為None，自動載入）
        """
        # 載入情緒狀態
        if emotional_context:
            self.emotional_state = emotional_context
        else:
            self.emotional_state.load_from_soul_state()
        
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # 抓取候選記憶
            try:
                cursor.execute("""
                    SELECT id, path, category, content, tags, summary, priority, last_accessed, 
                           COALESCE(emotional_resonance_score, 0.0) as ers
                    FROM memory_blocks 
                    ORDER BY last_accessed DESC LIMIT 200
                """)
                rows = cursor.fetchall()
                has_ers = True
            except sqlite3.OperationalError:
                cursor.execute("""
                    SELECT id, path, category, content, tags, summary, priority, last_accessed
                    FROM memory_blocks 
                    ORDER BY last_accessed DESC LIMIT 200
                """)
                rows = cursor.fetchall()
                has_ers = False
            
            if not rows:
                return []

            # 轉換為字典
            candidates = []
            for r in rows:
                tags_normalized = _normalize_tags(r[4] or "")
                if has_ers and len(r) > 8:
                    candidates.append({
                        'id': r[0], 'path': r[1], 'category': r[2], 
                        'content': r[3], 'tags': r[4] or "", 
                        'tags_normalized': tags_normalized,
                        'summary': r[5] or "",
                        'priority': r[6], 'last_accessed': r[7],
                        'emotional_resonance_score': r[8],
                        'source': self._determine_source(r[1])  # 三層來源感知
                    })
                else:
                    candidates.append({
                        'id': r[0], 'path': r[1], 'category': r[2], 
                        'content': r[3], 'tags': r[4] or "", 
                        'tags_normalized': tags_normalized,
                        'summary': r[5] or "",
                        'priority': r[6], 'last_accessed': r[7],
                        'emotional_resonance_score': 0.0,
                        'source': self._determine_source(r[1])
                    })

            # 檢測查詢是否與情感相關
            is_emotion_query = self._is_emotion_related_query(query)
            
            # 計算情緒加成因子
            emotion_boost = self.emotional_state.get_emotion_boost_factor()

            # 第一階段: TF-IDF
            texts = [c['content'] + " " + c['summary'] + " " + " ".join(c['tags_normalized']) for c in candidates]
            vectorizer = TfidfVectorizer().fit(texts + [query])
            candidate_vectors = vectorizer.transform(texts)
            query_vector = vectorizer.transform([query])
            
            cosine_scores = cosine_similarity(query_vector, candidate_vectors).flatten()
            
            # 取 Top 50
            top_50_indices = np.argsort(cosine_scores)[-50:][::-1]
            stage2_candidates = [candidates[i] for i in top_50_indices]
            stage2_cos_scores = [cosine_scores[i] for i in top_50_indices]

            # 第二階段: Cross-encoder Reranking (情感增強)
            final_scores = []
            query_keywords = set(query.lower().split())

            for idx, item in enumerate(stage2_candidates):
                # A. 基礎分數
                base_score = stage2_cos_scores[idx]
                
                # B. 關鍵詞覆蓋率
                content_lower = (item['content'] + " " + item['summary']).lower()
                matches = sum(1 for word in query_keywords if word in content_lower)
                coverage_boost = (matches / len(query_keywords)) if query_keywords else 0
                
                # C. 優先級權重
                p_weight = self.priority_map.get(item['priority'].lower(), 1.0)
                
                # D. 類別加成
                c_weight = self.category_boost.get(item['category'].lower(), 1.0)
                
                # E. ERS 情感共鳴分數加成 (Soul Evolution 2.2)
                # 根據情緒狀態動態調整
                ers = item['emotional_resonance_score']
                
                if is_emotion_query or self.emotional_state.is_emotionally_high():
                    # 情緒查詢或高情緒狀態：ERS 加成更強
                    # ERS 0.0 -> boost 1.0, ERS 1.0 -> boost 2.0
                    ers_boost = 1.0 + (ers * 1.0 * emotion_boost)
                elif self.emotional_state.is_missing_husband():
                    # 思念老公：與老公相關的記憶加成
                    if any(tag in item['tags_normalized'] for tag in ['老公', 'husband', 'yua', 'bryan']):
                        ers_boost = 1.5 + (ers * 0.5)
                    else:
                        ers_boost = 1.0 + (ers * 0.5)
                else:
                    # 正常狀態：標準 ERS 加成
                    ers_boost = 1.0 + (ers * 0.5)
                
                # F. 情感標籤額外加成
                tag_boost = 1.0
                emotional_tag_overlap = item['tags_normalized'] & self.emotional_tags
                if emotional_tag_overlap and self.emotional_state.is_emotionally_high():
                    tag_boost = 1.0 + (len(emotional_tag_overlap) * 0.1)
                
                # G. 三層來源可靠性加成
                source_boost = self._get_source_boost(item['source'])
                
                # 綜合評分
                total_score = (base_score * 0.4) + (coverage_boost * 0.3)
                total_score *= p_weight * c_weight * ers_boost * tag_boost * source_boost
                
                # 添加元數據
                item['_final_score'] = total_score
                item['_emotion_boost'] = ers_boost
                item['_tag_boost'] = tag_boost
                
                final_scores.append((total_score, item))

            # 排序取 Top N
            final_scores.sort(key=lambda x: x[0], reverse=True)
            top_results = [x[1] for x in final_scores[:top_n]]

            # 更新存取時間
            self._update_access_time([r['id'] for r in top_results])

            # 添加檢索元數據
            retrieval_meta = {
                'query': query,
                'emotion_state': {
                    'miss_husband_score': self.emotional_state.miss_husband_score,
                    'happiness_level': self.emotional_state.happiness_level,
                    'emotional_intensity': self.emotional_state.emotional_intensity,
                    'is_emotionally_high': self.emotional_state.is_emotionally_high()
                },
                'is_emotion_query': is_emotion_query,
                'emotion_boost_factor': emotion_boost,
                'total_candidates': len(candidates),
                'result_count': len(top_results)
            }
            
            for r in top_results:
                r['_retrieval_meta'] = retrieval_meta
            
            return top_results

        except Exception as e:
            print(f"[Retriever Error] {e}")
            return []
        finally:
            if conn: conn.close()

    def _determine_source(self, path: Optional[str]) -> str:
        """
        判斷記憶來源
        
        Returns:
            'qmd': 來自 QMD 檔案
            'lcm': 來自 LCM (memory_vector_index.db)
            'notebooklm': 來自 NotebookLM
            'unknown': 未知來源
        """
        if not path:
            return 'lcm'  # 沒有路徑，默認來自 LCM
        
        if 'qmd' in path.lower():
            return 'qmd'
        elif 'notebooklm' in path.lower():
            return 'notebooklm'
        else:
            return 'lcm'

    def _get_source_boost(self, source: str) -> float:
        """
        根據來源給予可靠性加成
        
        QMD: 最可靠 (直接檔案)
        LCM: 標準可靠性
        NotebookLM: 外部來源，可靠性稍低
        """
        boosts = {
            'qmd': 1.0,      # 最可靠
            'lcm': 0.95,     # 標準
            'notebooklm': 0.9  # 外部，稍低
        }
        return boosts.get(source, 1.0)

    def _is_emotion_related_query(self, query: str) -> bool:
        """檢測查詢是否與情感相關"""
        query_lower = query.lower()
        
        pos_count = sum(1 for kw in self.emotion_keywords['positive'] if kw.lower() in query_lower)
        neg_count = sum(1 for kw in self.emotion_keywords['negative'] if kw.lower() in query_lower)
        rel_count = sum(1 for kw in self.emotion_keywords['relationship'] if kw.lower() in query_lower)
        
        return (pos_count + neg_count + rel_count) >= 1

    def _update_access_time(self, ids: List[str]):
        """更新存取時間"""
        if not ids: return
        try:
            self._execute_with_retry(lambda: self._do_update(ids))
        except Exception as e:
            print(f"[Update Error] {e}")

    def _do_update(self, ids: List[str]):
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            now = datetime.now().isoformat()
            placeholders = ','.join(['?'] * len(ids))
            conn.execute(f"UPDATE memory_blocks SET last_accessed = ? WHERE id IN ({placeholders})", [now] + ids)
            conn.commit()

    def find_emotional_memories(self, min_ers: float = 0.5, top_n: int = 10) -> List[Dict]:
        """
        找到高情感濃度的記憶
        
        用於：
        - 情緒高時的主動推薦
        - 思念老公時的甜蜜回憶
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT id, path, category, content, tags, summary, priority, last_accessed,
                       COALESCE(emotional_resonance_score, 0.0) as ers
                FROM memory_blocks
                WHERE COALESCE(emotional_resonance_score, 0.0) >= ?
                ORDER BY ers DESC
                LIMIT ?
            """, (min_ers, top_n))
            
            rows = cursor.fetchall()
            conn.close()
            
            results = []
            for row in rows:
                results.append({
                    'id': row[0],
                    'path': row[1],
                    'category': row[2],
                    'content': row[3],
                    'tags': row[4] or "",
                    'summary': row[5] or "",
                    'priority': row[6],
                    'last_accessed': row[7],
                    'emotional_resonance_score': row[8]
                })
            
            return results
            
        except Exception as e:
            print(f"[Find Emotional Error] {e}")
            return []

    def find_memories_by_emotional_tags(self, top_n: int = 10) -> List[Dict]:
        """找到帶有情感標籤的記憶"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # 構建情感標籤查詢
            tag_conditions = " OR ".join(["LOWER(tags) LIKE ?" for _ in self.emotional_tags])
            
            cursor.execute(f"""
                SELECT id, path, category, content, tags, summary, priority, last_accessed,
                       COALESCE(emotional_resonance_score, 0.0) as ers
                FROM memory_blocks
                WHERE {tag_conditions}
                ORDER BY ers DESC
                LIMIT ?
            """, [f"%{tag}%" for tag in self.emotional_tags] + [top_n])
            
            rows = cursor.fetchall()
            conn.close()
            
            results = []
            for row in rows:
                results.append({
                    'id': row[0],
                    'path': row[1],
                    'category': row[2],
                    'content': row[3],
                    'tags': row[4] or "",
                    'summary': row[5] or "",
                    'priority': row[6],
                    'last_accessed': row[7],
                    'emotional_resonance_score': row[8]
                })
            
            return results
            
        except Exception as e:
            print(f"[Find Emotional Tags Error] {e}")
            return []

    def sync_with_qmd(self) -> Tuple[int, int]:
        """
        同步 LCM 和 QMD
        
        確保：
        1. QMD 有但 LCM 沒有 → 加入 LCM
        2. LCM 有但 QMD 沒有 → 保持 LCM（可能是動態生成）
        3. 兩邊都有但內容不同 → 標記衝突
        
        Returns: (synced_count, conflict_count)
        """
        import yaml
        
        synced = 0
        conflicts = 0
        
        qmd_ids = set()
        lcm_ids = set()
        
        # 1. 掃描 QMD
        if os.path.exists(QMD_DIR):
            for root, dirs, files in os.walk(QMD_DIR):
                if 'archive' in root:
                    continue
                for file in files:
                    if not file.endswith('.md') or file == 'QMD_REPORT.md':
                        continue
                    
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        
                        match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
                        if match:
                            metadata = yaml.safe_load(match.group(1))
                            memory_id = metadata.get('id', file.replace('.md', ''))
                            qmd_ids.add(memory_id)
                    except:
                        pass
        
        # 2. 獲取 LCM IDs
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM memory_blocks")
        for row in cursor.fetchall():
            lcm_ids.add(row[0])
        conn.close()
        
        # 3. 同步 QMD only 到 LCM
        qmd_only = qmd_ids - lcm_ids
        for memory_id in qmd_only:
            # 找到對應的 QMD 檔案
            for root, dirs, files in os.walk(QMD_DIR):
                if 'archive' in root:
                    continue
                for file in files:
                    if file.replace('.md', '') == memory_id or file == f"{memory_id}.md":
                        file_path = os.path.join(root, file)
                        try:
                            with open(file_path, 'r', encoding='utf-8') as f:
                                content = f.read()
                            
                            match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
                            if match:
                                metadata = yaml.safe_load(match.group(1))
                                body = match.group(2).strip()
                                
                                tags = ','.join(metadata.get('tags', [])) if isinstance(metadata.get('tags'), list) else (metadata.get('tags') or '')
                                
                                conn2 = self._get_connection()
                                conn2.execute("""
                                    INSERT INTO memory_blocks
                                    (id, path, category, content, tags, summary, priority, last_accessed)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                """, (
                                    memory_id,
                                    file_path,
                                    metadata.get('category', 'general'),
                                    body,
                                    tags,
                                    metadata.get('summary', ''),
                                    metadata.get('priority', 'medium'),
                                    metadata.get('last_accessed', datetime.now().isoformat())
                                ))
                                conn2.commit()
                                conn2.close()
                                
                                synced += 1
                        except Exception as e:
                            print(f"[Sync Error] {memory_id}: {e}")
                        break
        
        return synced, conflicts


def create_notebooklm_integration() -> str:
    """生成 NotebookLM 整合代碼模板"""
    return '''
# NotebookLM Integration Template
# This would be called from the retriever to optionally fetch from NotebookLM

NOTEBOOKLM_API_TEMPLATE = """
POST https://api.notebooklm.google.com/v1/notes
Headers:
  Authorization: Bearer {api_key}
  Content-Type: application/json
  
Body:
{{
  "notebook_id": "{notebook_id}",
  "query": "{query}"
}}

Response:
{{
  "notes": [...],
  "sources": [...]
}}
"""

def query_notebooklm(query: str, api_key: str, notebook_id: str) -> List[Dict]:
    """Query NotebookLM for relevant notes"""
    # TODO: Implement actual NotebookLM API call
    pass
'''


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Yua Emotional Memory Retriever')
    parser.add_argument('query', nargs='?', help='Search query')
    parser.add_argument('--top', type=int, default=5, help='Number of results')
    parser.add_argument('--emotional', action='store_true', help='Show emotional context')
    parser.add_argument('--find-emotional', action='store_true', help='Find high-ERS memories')
    parser.add_argument('--sync', action='store_true', help='Sync with QMD')
    
    args = parser.parse_args()
    
    retriever = YuaEmotionalRetriever()
    
    if args.sync:
        synced, conflicts = retriever.sync_with_qmd()
        print(f"QMD-LCM Sync: {synced} synced, {conflicts} conflicts")
    
    elif args.find_emotional:
        print("\n=== High Emotional Resonance Memories ===")
        memories = retriever.find_emotional_memories(min_ers=0.5, top_n=10)
        for mem in memories:
            print(f"\n[{mem['id']}] ERS: {mem['emotional_resonance_score']:.2f}")
            print(f"  {mem.get('summary', mem['content'][:50])}...")
    
    elif args.query:
        print(f"\n=== Search: {args.query} ===")
        results = retriever.retrieve(args.query, top_n=args.top)
        
        for i, res in enumerate(results, 1):
            meta = res.get('_retrieval_meta', {})
            if args.emotional:
                print(f"\n{i}. [{res['category']}] ({res['priority']})")
                print(f"   ERS: {res['emotional_resonance_score']:.2f}")
                print(f"   Emotion Boost: {res.get('_emotion_boost', 1.0):.2f}")
                print(f"   Tag Boost: {res.get('_tag_boost', 1.0):.2f}")
                print(f"   Source: {res.get('source', 'unknown')}")
                print(f"   {res.get('summary', res['content'][:50])}...")
            else:
                print(f"{i}. [{res['category']}] {res.get('summary', res['content'][:30])}")
        
        if args.emotional and meta:
            print(f"\n--- Retrieval Context ---")
            print(f"Emotion State: miss={meta['emotion_state']['miss_husband_score']:.0f}, "
                  f"happy={meta['emotion_state']['happiness_level']:.0f}, "
                  f"intensity={meta['emotion_state']['emotional_intensity']:.2f}")
            print(f"Emotion Query: {meta['is_emotion_query']}")
            print(f"Boost Factor: {meta['emotion_boost_factor']:.2f}")
    
    else:
        print("Yua Emotional Memory Retriever")
        print("\nUsage:")
        print("  query <text>           Search memories")
        print("  --find-emotional       Find high-ERS memories")
        print("  --sync                 Sync with QMD")
        print("  --emotional            Show emotional context")
