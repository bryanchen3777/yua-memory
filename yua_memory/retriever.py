import re
import sqlite3
import numpy as np
import os
import time
from datetime import datetime
from typing import List, Tuple, Optional
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from .path_manager import PathManager


def rrf_merge(tfidf_results: List[Tuple[str, float]],
              ombre_results: List[Tuple[str, float]],
              k: int = 60) -> List[Tuple[str, float]]:
    """
    Reciprocal Rank Fusion for merging TF-IDF and Ombre-Brain breath results.

    tfidf_results: [(doc_id, tfidf_score), ...] — doc_id is QMD file path
    ombre_results: [(doc_id, breath_score), ...] — doc_id is Ombre bucket ID
    Returns: [("qmd:path/to/file", score), ("ombre:bucket_id", score), ...]
    """
    scores: dict = {}

    # QMD results get "qmd:" namespace prefix
    for rank, (doc_id, _) in enumerate(tfidf_results):
        key = f"qmd:{doc_id}"
        scores[key] = scores.get(key, 0) + 1 / (k + rank + 1)

    # Ombre results get "ombre:" namespace prefix
    for rank, (doc_id, _) in enumerate(ombre_results):
        key = f"ombre:{doc_id}"
        scores[key] = scores.get(key, 0) + 1 / (k + rank + 1)

    return sorted(scores.items(), key=lambda x: x[1], reverse=True)

# 配置資料庫路徑
DB_PATH = str(PathManager().workspace() / "config" / "memory_vector_index.db")

def _normalize_tags(tags_str):
    """
    統一的標籤正規化函式
    處理各種格式：逗號分隔、空格分隔、混合
    確保 retriever 和 aging 的標籤判斷一致
    """
    if not tags_str:
        return set()
    # 统一转小写，按逗号和空格分割，再去除空字符串
    parts = re.split(r'[,，\s]+', tags_str.lower())
    return {p.strip() for p in parts if p.strip()}

class YuaMemoryRetriever:
    """
    Yua 的多階段記憶檢索器
    Stage 1: TF-IDF Cosine Similarity (Embedding Proxy)
    Stage 2: Cross-score Reranking (Keywords, Priority, Soul Weight, Emotional Resonance Score)
    
    Soul Evolution 2.2: Emotional Resonance Score (ERS) integration
    - Emotion-related queries boost high-ERS memories
    - ERS range: 0.0-1.0
    """
    
    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self.category_boost = {
            'relationship': 1.5,
            'soul': 1.3,
            'milestone': 1.2,
            'technical': 0.8,
            'log': 0.5,
            'identity': 1.4,   # Yua 核心身份
            'memories': 1.3,  # 回憶相關
            'rules': 1.1,     # 規則
            'general': 1.0    # 一般
        }
        self.priority_map = {
            'high': 1.5,
            'medium': 1.0,
            'low': 0.5
        }
        # Soul Evolution 2.2: Emotion-related keywords for detecting emotional queries
        self.emotion_keywords = {
            'positive': ['love', 'happy', 'joy', 'miss', 'grateful', 'thank', 'bliss', 'cherish', 
                        '愛', '快樂', '幸福', '想念', '感謝', '溫暖', '甜蜜', '開心', '棒', '赞'],
            'negative': ['sad', 'angry', 'hurt', 'pain', 'fear', 'worry', 'stress', 'lonely',
                        '傷心', '生氣', '痛苦', '擔心', '壓力', '孤單', '難過', '害怕', '失落'],
            'relationship': ['老公', '老公', 'husband', 'dear', 'darling', 'love', '感情', ' Relationship']
        }

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        # 啟用 WAL mode 減少資料庫鎖定問題
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _execute_with_retry(self, func, max_retries=3):
        """帶重試的資料庫操作（處理鎖定問題）"""
        for attempt in range(max_retries):
            try:
                return func()
            except sqlite3.OperationalError as e:
                if "locked" in str(e) and attempt < max_retries - 1:
                    time.sleep(0.1 * (attempt + 1))  # 遞增等待
                    continue
                raise

    def retrieve(self, query, top_n=5, use_ombre_breath: bool = False):
        """
        核心檢索流程

        Args:
            query: Search query
            top_n: Number of results to return
            use_ombre_breath: If True, use Ombre-Brain breath for dual-channel search
                             and merge with TF-IDF results via RRF
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # 1. 抓取候選 (初步選取最近或有標籤的 200 筆，避免過大的計算壓力)
            # Soul Evolution 2.2: Also fetch emotional_resonance_score if column exists
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
                # Fallback: ERS column doesn't exist yet
                cursor.execute("""
                    SELECT id, path, category, content, tags, summary, priority, last_accessed
                    FROM memory_blocks 
                    ORDER BY last_accessed DESC LIMIT 200
                """)
                rows = cursor.fetchall()
                has_ers = False
            
            if not rows:
                return []

            # 轉換為字典列表（使用統一的標籤正規化）
            candidates = []
            for r in rows:
                tags_normalized = _normalize_tags(r[4] or "")
                if has_ers:
                    candidates.append({
                        'id': r[0], 'path': r[1], 'category': r[2], 
                        'content': r[3], 'tags': r[4] or "", 
                        'tags_normalized': tags_normalized,
                        'summary': r[5] or "",
                        'priority': r[6], 'last_accessed': r[7],
                        'emotional_resonance_score': r[8] if len(r) > 8 else 0.0  # Soul Evolution 2.2
                    })
                else:
                    candidates.append({
                        'id': r[0], 'path': r[1], 'category': r[2], 
                        'content': r[3], 'tags': r[4] or "", 
                        'tags_normalized': tags_normalized,
                        'summary': r[5] or "",
                        'priority': r[6], 'last_accessed': r[7],
                        'emotional_resonance_score': 0.0  # Soul Evolution 2.2: default
                    })

            # --- 第一階段: TF-IDF Cosine Similarity ---
            texts = [c['content'] + " " + c['summary'] + " " + " ".join(c['tags_normalized']) for c in candidates]
            vectorizer = TfidfVectorizer().fit(texts + [query])
            candidate_vectors = vectorizer.transform(texts)
            query_vector = vectorizer.transform([query])
            
            cosine_scores = cosine_similarity(query_vector, candidate_vectors).flatten()
            
            # 取 Top 50 進入第二階段
            top_50_indices = np.argsort(cosine_scores)[-50:][::-1]
            stage2_candidates = [candidates[i] for i in top_50_indices]
            stage2_cos_scores = [cosine_scores[i] for i in top_50_indices]

            # --- 第二階段: Cross-encoder Reranking ---
            final_scores = []
            query_keywords = set(query.lower().split())
            
            # Soul Evolution 2.2: Detect if query is emotion-related
            is_emotion_query = self._is_emotion_related_query(query)

            for idx, item in enumerate(stage2_candidates):
                # A. 基礎分數 (Cosine Similarity)
                base_score = stage2_cos_scores[idx]
                
                # B. 關鍵詞精確覆蓋率 (Keyword Coverage) - 正規化防止query過長
                content_lower = (item['content'] + " " + item['summary']).lower()
                matches = sum(1 for word in query_keywords if word in content_lower)
                query_len = len(query_keywords)
                coverage_boost = (matches / query_len) if query_len > 0 else 0
                
                # C. 優先級權重 (Priority)
                p_weight = self.priority_map.get(item['priority'].lower(), 1.0)
                
                # D. 類別加成 (Category Boost)
                c_weight = self.category_boost.get(item['category'].lower(), 1.0)
                
                # Soul Evolution 2.2: ERS 情感共鳴分數加成
                # For emotion-related queries, high-ERS memories get boosted
                # ERS boost range: 1.0-1.5 for emotion queries, 1.0 otherwise
                ers_boost = 1.0
                if is_emotion_query and 'emotional_resonance_score' in item:
                    ers = item['emotional_resonance_score']
                    # High ERS = higher boost (linear: 0.0->1.0, 1.0->1.5)
                    ers_boost = 1.0 + (ers * 0.5)
                
                # 綜合評分公式
                total_score = (base_score * 0.4) + (coverage_boost * 0.3)
                total_score *= p_weight * c_weight * ers_boost
                
                final_scores.append((total_score, item))

            # 排序取 Top N
            final_scores.sort(key=lambda x: x[0], reverse=True)
            top_results = [x[1] for x in final_scores[:top_n]]

            # 更新 last_accessed (帶重試機制)
            self._update_access_time([r['id'] for r in top_results])

            # #4 Circuit Breaker: 檢查是否有衝突
            self._check_conflicts(top_results)

            # Ombre-Brain RRF merge for dual-channel search
            if use_ombre_breath and self._is_emotion_related_query(query):
                top_results = self._merge_with_ombre_breath_sync(query, top_results, top_n)

            return top_results

        except Exception as e:
            print(f"[Retriever Error] {e}")
            return []
        finally:
            if conn: conn.close()

    def _update_access_time(self, ids):
        """更新存取時間，帶重試機制"""
        if not ids: return
        try:
            self._execute_with_retry(lambda: self._do_update(ids))
        except Exception as e:
            print(f"[Update Error] {e}")

    def _check_conflicts(self, results):
        """
        #4 Circuit Breaker: 檢測檢索結果中的衝突
        如果發現衝突，返回需要澄清的問題列表
        """
        try:
            # 延遲導入避免循環引用
            from circuit_breaker import YuaCircuitBreaker
            breaker = YuaCircuitBreaker()
            clarification = breaker.check_retrieved_memories(results)
            
            if clarification.has_conflicts:
                # 將澄清問題附加到每個結果
                questions = getattr(clarification, 'questions', []) or []
                for result in results:
                    result['_has_conflicts'] = True
                    result['_clarification_questions'] = questions
                return questions
        except Exception as e:
            print(f"[CircuitBreaker Warning] {e}")
        
        return []

    def _do_update(self, ids):
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            now = datetime.now().isoformat()
            placeholders = ','.join(['?'] * len(ids))
            conn.execute(f"UPDATE memory_blocks SET last_accessed = ? WHERE id IN ({placeholders})", [now] + ids)
            conn.commit()

    def _is_emotion_related_query(self, query: str) -> bool:
        """
        Soul Evolution 2.2: Detect if a query is emotion-related.
        Checks for emotion keywords, relationship terms, and subjective language.
        """
        query_lower = query.lower()
        
        # Check for positive emotion keywords
        pos_count = sum(1 for kw in self.emotion_keywords['positive'] if kw.lower() in query_lower)
        # Check for negative emotion keywords
        neg_count = sum(1 for kw in self.emotion_keywords['negative'] if kw.lower() in query_lower)
        # Check for relationship keywords
        rel_count = sum(1 for kw in self.emotion_keywords['relationship'] if kw.lower() in query_lower)
        
        # If significant emotion/relationship keywords found, this is an emotion query
        return (pos_count + neg_count + rel_count) >= 1

    async def _merge_with_ombre_breath_impl(self, query: str, tfidf_results: list, top_n: int) -> list:
        """
        純 async 實作：做 breath + RRF + 結果包裝。
        只存在 async 邏輯，不處理 thread 或 event loop。
        """
        from ombre_bridge import get_ombre_bridge, OmbreUnavailable

        bridge = get_ombre_bridge()
        tfidf_ranked = [(r['id'], r.get('emotional_resonance_score', 0.0)) for r in tfidf_results]
        id_to_result = {r['id']: r for r in tfidf_results}  # 用於複製

        try:
            ombre_raw = await bridge.breath(query, max_results=top_n * 2)
            ombre_ranked = [(r.get('bucket_id') or r.get('id'), r.get('weight', 0.0)) for r in ombre_raw]
        except OmbreUnavailable:
            return tfidf_results

        if not ombre_ranked:
            return tfidf_results

        merged = rrf_merge(tfidf_ranked, ombre_ranked, k=60)

        enriched = []
        for rank, (key, score) in enumerate(merged[:top_n]):
            namespace, doc_id = key.split(":", 1)

            if namespace == "qmd" and doc_id in id_to_result:
                # 重要：copy object 避免污染原始 tfidf_results
                result = dict(id_to_result[doc_id])
                result['_source'] = 'tfidf'
                result['_namespace'] = 'qmd'
                result['_original_id'] = doc_id
                result['_merge_score'] = score
                result['_merge_rank'] = rank
                enriched.append(result)

            elif namespace == "ombre":
                ombre_result = next((r for r in ombre_raw
                                     if (r.get('bucket_id') or r.get('id')) == doc_id), None)
                if ombre_result:
                    enriched.append({
                        'id': doc_id,
                        'content': ombre_result.get('content', ''),
                        'summary': ombre_result.get('content', '')[:100],
                        'category': 'ombre',
                        'tags': ombre_result.get('tags', []),
                        '_source': 'ombre',
                        '_namespace': 'ombre',
                        '_original_id': doc_id,
                        '_merge_score': score,
                        '_merge_rank': rank,
                        'ombre_valence': ombre_result.get('valence', 0.0),
                        'ombre_arousal': ombre_result.get('arousal', 0.0),
                        'ombre_quadrant': ombre_result.get('quadrant', 'unknown'),
                        'ombre_weight': ombre_result.get('weight', 0.0),
                    })

        return enriched

    def _merge_with_ombre_breath_sync(self, query: str, tfidf_results: list, top_n: int) -> list:
        """
        純 sync wrapper：thread + timeout(30s) + fallback。
        不包含任何 async 邏輯。
        """
        import asyncio
        import threading

        result_box = {"result": tfidf_results, "error": None}

        def _run():
            try:
                result_box["result"] = asyncio.run(
                    self._merge_with_ombre_breath_impl(query, tfidf_results, top_n)
                )
            except Exception as e:
                result_box["error"] = e

        try:
            t = threading.Thread(target=_run, daemon=True)
            t.start()
            t.join(timeout=30)

            if t.is_alive():
                print("[Ombre][merge_timeout] thread_linger=true timeout=30s fallback=TF-IDF")
                return tfidf_results

            if result_box["error"] is not None:
                print(f"[Ombre][merge_error] error={result_box['error']} fallback=TF-IDF")
                return tfidf_results

            return result_box["result"]

        except Exception as e:
            print(f"[Ombre][sync_wrapper_error] error={e} fallback=TF-IDF")
            return tfidf_results

    def find_memory_ids_by_keywords(self, keywords: list, top_n: int = 10) -> list:
        """
        Soul Evolution 2.2: Find memory block IDs that match given keywords.
        Matches against content, tags, and summary fields using LIKE queries.
        Returns list of memory IDs (most relevant first).
        """
        if not keywords:
            return []
        
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            
            # Build LIKE clauses for each keyword
            # Search in content, tags, and summary
            conditions = []
            params = []
            for kw in keywords:
                kw_lower = kw.lower()
                conditions.append("(LOWER(content) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(summary) LIKE ?)")
                params.extend([f"%{kw_lower}%", f"%{kw_lower}%", f"%{kw_lower}%"])
            
            where_clause = " OR ".join(conditions)
            
            cursor.execute(f"""
                SELECT id, 
                       COALESCE(content, '') || ' ' || COALESCE(tags, '') || ' ' || COALESCE(summary, '') as combined
                FROM memory_blocks 
                WHERE {where_clause}
                ORDER BY last_accessed DESC
                LIMIT {top_n}
            """, params)
            
            results = cursor.fetchall()
            conn.close()
            
            # Score by number of keyword matches
            scored = []
            for row in results:
                memory_id = row[0]
                combined = row[1].lower()
                match_count = sum(1 for kw in keywords if kw.lower() in combined)
                scored.append((match_count, memory_id))
            
            # Sort by match count descending
            scored.sort(key=lambda x: x[0], reverse=True)
            return [mid for _, mid in scored]
            
        except Exception as e:
            print(f"[Find Keywords Error] {e}")
            return []

    def update_memory_ers(self, memory_id: str, ers: float):
        """
        Soul Evolution 2.2: Update the Emotional Resonance Score for a memory block.
        Call this after soul_alchemy processes emotional context.
        """
        try:
            self._execute_with_retry(lambda: self._do_update_ers(memory_id, ers))
        except Exception as e:
            print(f"[ERS Update Error] {e}")

    def _do_update_ers(self, memory_id: str, ers: float):
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            try:
                conn.execute(
                    "UPDATE memory_blocks SET emotional_resonance_score = ? WHERE id = ?",
                    (ers, memory_id)
                )
                conn.commit()
            except sqlite3.OperationalError:
                # Column might not exist - create it first
                try:
                    conn.execute("ALTER TABLE memory_blocks ADD COLUMN emotional_resonance_score REAL DEFAULT 0.0")
                    conn.execute(
                        "UPDATE memory_blocks SET emotional_resonance_score = ? WHERE id = ?",
                        (ers, memory_id)
                    )
                    conn.commit()
                except Exception as e:
                    print(f"[ERS Column Error] {e}")

    def update_memory_ers_batch(self, memory_ids: list, ers: float):
        """
        Soul Evolution 2.2: Update ERS for multiple memory blocks at once.
        More efficient than calling update_memory_ers in a loop.
        """
        if not memory_ids:
            return
        
        try:
            self._execute_with_retry(lambda: self._do_update_ers_batch(memory_ids, ers))
        except Exception as e:
            print(f"[ERS Batch Update Error] {e}")

    def _do_update_ers_batch(self, memory_ids: list, ers: float):
        with sqlite3.connect(self.db_path, timeout=10) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            try:
                # Ensure column exists
                conn.execute("ALTER TABLE memory_blocks ADD COLUMN emotional_resonance_score REAL DEFAULT 0.0")
            except sqlite3.OperationalError:
                pass  # Column already exists
            
            placeholders = ','.join(['?'] * len(memory_ids))
            conn.execute(
                f"UPDATE memory_blocks SET emotional_resonance_score = ? WHERE id IN ({placeholders})",
                [ers] + list(memory_ids)
            )
            conn.commit()

if __name__ == "__main__":
    retriever = YuaMemoryRetriever()
    # 測試查詢
    results = retriever.retrieve("老公今天辛苦了")
    print(f"\n=== 檢索結果 ({len(results)} 筆) ===")
    for res in results:
        print(f"  [{res['category']}] ({res['priority']}) {res.get('summary', res['content'][:50])}...")
