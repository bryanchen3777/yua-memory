import os
import re
import sqlite3
import yaml
import asyncio
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional, Dict, Any
from .path_manager import PathManager

# 配置
WORKSPACE_DIR = str(PathManager().workspace())
QMD_DIR = os.path.join(WORKSPACE_DIR, "qmd")
DB_PATH = os.path.join(WORKSPACE_DIR, "config", "memory_vector_index.db")
ARCHIVE_DIR = os.path.join(QMD_DIR, "archive")

# Ombre-Brain Emotion Label Prompt
EMOTION_LABEL_PROMPT = """
分析以下記憶片段的情緒維度，回傳 JSON。

記憶內容：
{content}

回傳格式（僅回傳 JSON，不要其他文字）：
{{
  "valence": <-1.0 到 +1.0，正值=正面情緒>,
  "arousal": <0.0 到 1.0，高值=高激活>,
  "quadrant": <"pleasant-active"|"pleasant-calm"|"unpleasant-active"|"unpleasant-calm">,
  "confidence": <0.0 到 1.0，標籤信心度>
}}
"""


def _validate_emotion_label(label: dict) -> dict:
    """
    驗證並規範化 LLM 回傳的情緒標籤。
    永遠回傳有效 schema。
    """
    try:
        valence = max(-1.0, min(1.0, float(label.get("valence", 0.0))))
        arousal = max(0.0, min(1.0, float(label.get("arousal", 0.3))))
        confidence = max(0.0, min(1.0, float(label.get("confidence", 0.0))))

        quadrant = label.get("quadrant", "pleasant-calm")
        valid_quadrants = ["pleasant-active", "pleasant-calm",
                          "unpleasant-active", "unpleasant-calm"]
        if quadrant not in valid_quadrants:
            quadrant = "pleasant-calm"

        return {
            "valence": valence,
            "arousal": arousal,
            "quadrant": quadrant,
            "confidence": confidence
        }
    except (ValueError, TypeError):
        return {"valence": 0.0, "arousal": 0.3,
                "quadrant": "pleasant-calm", "confidence": 0.0}


async def llm_generate_emotion_label(content: str) -> Dict[str, Any]:
    """
    使用 LLM 生成情緒標籤（valence, arousal, quadrant, confidence）。
    需要環境中有 LLM API 配置。
    """
    try:
        import os
        # Try to use OpenAI-compatible API via environment or config
        api_key = os.getenv("OPENAI_API_KEY") or os.getenv("DEEPSEEK_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL") or os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")

        if not api_key:
            return {"valence": 0.0, "arousal": 0.3, "quadrant": "pleasant-calm", "confidence": 0.0}

        try:
            import httpx
            client = httpx.AsyncClient(timeout=30.0)
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "deepseek-chat",
                    "messages": [
                        {"role": "system", "content": EMOTION_LABEL_PROMPT},
                        {"role": "user", "content": content[:1000]}
                    ],
                    "max_tokens": 256,
                    "temperature": 0.1
                }
            )
            await client.aclose()

            if response.status_code == 200:
                result = response.json()
                raw = result["choices"][0]["message"]["content"]
                # Parse JSON from response
                import json
                # Handle markdown code blocks
                cleaned = raw.strip()
                if cleaned.startswith("```"):
                    cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0]
                parsed = json.loads(cleaned)
                # 驗證並規範化
                return _validate_emotion_label(parsed)
        except Exception as e:
            print(f"[Emotion Label Error] LLM call failed: {e}")

    except Exception as e:
        print(f"[Emotion Label Error] {e}")

    return {"valence": 0.0, "arousal": 0.3, "quadrant": "pleasant-calm", "confidence": 0.0}


async def maybe_hold_memory(content: str, importance: int = 5) -> Optional[Dict[str, Any]]:
    """
    嘗試將記憶寫入 Ombre-Brain。

    如果 LLM 生成的 confidence < 0.4，表示情緒特徵不明顯，跳過寫入。

    Returns:
        Ombre bucket result if successful, None if skipped or failed.
    """
    try:
        from ombre_bridge import get_ombre_bridge, OmbreUnavailable

        label = await llm_generate_emotion_label(content)

        if label.get("confidence", 0) < 0.4:
            # 結構化 log：可 grep 的 key-value 格式
            print(
                f"[Ombre][skip_low_confidence] "
                f"confidence={label.get('confidence', 0):.2f} "
                f"valence={label.get('valence', 0):.2f} "
                f"arousal={label.get('arousal', 0):.2f} "
                f"content_preview={content[:50]!r}"
            )
            return None

        bridge = get_ombre_bridge()
        result = await bridge.hold(
            content=content,
            importance=importance,
            valence=label.get("valence"),
            arousal=label.get("arousal")
        )
        return result

    except OmbreUnavailable:
        # Ombre 不可用，跳過
        return None
    except Exception as e:
        print(f"[maybe_hold_memory Error] {e}")
        return None


def get_ombre_frontmatter(valence: float, arousal: float, quadrant: str,
                          weight: float = 1.0, resolved: bool = False) -> Dict[str, Any]:
    """
    生成 Ombre-Brain 情緒元資料的 frontmatter 字典。

    Args:
        valence: -1.0 到 +1.0
        arousal: 0.0 到 1.0
        quadrant: Russell 四象限標籤
        weight: 衰減後的當前權重
        resolved: 是否已解決

    Returns:
        Frontmatter 字典，包含 ombre_* 欄位
    """
    return {
        "ombre_valence": round(valence, 2),
        "ombre_arousal": round(arousal, 2),
        "ombre_quadrant": quadrant,
        "ombre_weight": round(weight, 3),
        "ombre_resolved": resolved,
        "ombre_tagged_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    }


def enrich_qmd_frontmatter(frontmatter: Dict[str, Any],
                           ombre_result: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    將 Ombre-Brain 元資料加入 QMD frontmatter。

    Args:
        frontmatter: 現有的 frontmatter 字典
        ombre_result: Ombre hold() 返回的結果（可選）

    Returns:
         enriched frontmatter 字典
    """
    if ombre_result:
        frontmatter["ombre_valence"] = ombre_result.get("valence", 0.0)
        frontmatter["ombre_arousal"] = ombre_result.get("arousal", 0.3)
        frontmatter["ombre_quadrant"] = ombre_result.get("quadrant", "pleasant-calm")
        frontmatter["ombre_weight"] = ombre_result.get("weight", 1.0)
        frontmatter["ombre_resolved"] = False
        frontmatter["ombre_tagged_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    return frontmatter

class MemoryConsolidator:
    """
    #1 Consolidation Layer - 記憶整合層
    
    功能：
    1. 檢測孤立項目（資料庫有但檔案不存在）
    2. 檢測未索引檔案（QMD 檔案不在資料庫中）
    3. 檢測相似/碎片化記憶（可合併的相似記憶）
    4. 清理碎片化資料
    
    設計原則：
    - 保守合併：只合併高度相似的記憶（相似度 > 0.85）
    - 保留所有原始內容：合併時不丟失資訊
    - 記錄操作日誌：所有合併/刪除操作都可追溯
    """

    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self.consolidation_log = []
        
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _execute_with_retry(self, func, max_retries=3):
        """帶重試的資料庫操作"""
        for attempt in range(max_retries):
            try:
                return func()
            except sqlite3.OperationalError as e:
                if "locked" in str(e) and attempt < max_retries - 1:
                    import time
                    time.sleep(0.1 * (attempt + 1))
                    continue
                raise

    def _normalize_tags(self, tags_str):
        """統一的標籤正規化"""
        if not tags_str:
            return set()
        parts = re.split(r'[,，\s]+', tags_str.lower())
        return {p.strip() for p in parts if p.strip()}

    def check_orphaned_entries(self):
        """
        檢測孤立項目（DB有記錄但檔案不存在）
        返回：list of orphaned entry dicts
        """
        orphaned = []
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT id, path, category FROM memory_blocks")
            entries = cursor.fetchall()
            
            for entry_id, path, category in entries:
                if path and not os.path.exists(path):
                    orphaned.append({
                        'id': entry_id,
                        'path': path,
                        'category': category,
                        'issue': 'file_not_found'
                    })
                    self.consolidation_log.append({
                        'timestamp': datetime.now().isoformat(),
                        'action': 'orphan_detected',
                        'entry_id': entry_id,
                        'path': path
                    })
                    
        finally:
            conn.close()
            
        return orphaned

    def check_unindexed_files(self):
        """
        檢測未索引檔案（QMD檔案存在但DB沒有記錄）
        返回：list of unindexed file dicts
        """
        unindexed = []
        indexed_paths = set()
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            # 取得所有已索引的路徑
            cursor.execute("SELECT path FROM memory_blocks WHERE path IS NOT NULL")
            for row in cursor.fetchall():
                if row[0]:
                    indexed_paths.add(row[0])
            
            # 掃描 QMD 目錄
            for root, dirs, files in os.walk(QMD_DIR):
                # 跳過 archive 目錄
                if 'archive' in root:
                    continue
                    
                for file in files:
                    if not file.endswith('.md') or file == 'QMD_REPORT.md':
                        continue
                        
                    file_path = os.path.join(root, file)
                    
                    if file_path not in indexed_paths:
                        # 嘗試讀取 frontmatter
                        metadata = self._read_qmd_metadata(file_path)
                        unindexed.append({
                            'path': file_path,
                            'filename': file,
                            'category': metadata.get('category', os.path.basename(root)),
                            'tags': metadata.get('tags', []),
                            'id': metadata.get('id', file.replace('.md', ''))
                        })
                        self.consolidation_log.append({
                            'timestamp': datetime.now().isoformat(),
                            'action': 'unindexed_detected',
                            'path': file_path
                        })
                        
        finally:
            conn.close()
            
        return unindexed

    def _read_qmd_metadata(self, file_path):
        """讀取 QMD 檔案的 frontmatter"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
            if match:
                try:
                    metadata = yaml.safe_load(match.group(1))
                    if metadata:
                        return metadata
                except:
                    pass
        except Exception as e:
            print(f"[Consolidation] Error reading {file_path}: {e}")
            
        return {}

    def find_similar_memories(self, similarity_threshold=0.75):
        """
        檢測相似/碎片化記憶
        
        演算法：
        1. 按 category 分組
        2. 在同 category 內計算內容相似度
        3. 找出相似度 > threshold 的記憶對
        
        Returns: list of similar memory groups
        """
        similar_groups = []
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT id, category, content, tags, summary 
                FROM memory_blocks 
                WHERE content IS NOT NULL AND content != ''
            """)
            entries = cursor.fetchall()
            
            # 按 category 分組
            by_category = {}
            for entry in entries:
                cat = entry[1] or 'general'
                if cat not in by_category:
                    by_category[cat] = []
                by_category[cat].append({
                    'id': entry[0],
                    'content': entry[2] or '',
                    'tags': entry[3] or '',
                    'summary': entry[4] or ''
                })
            
            # 在同 category 內找相似記憶
            for category, items in by_category.items():
                for i in range(len(items)):
                    for j in range(i + 1, len(items)):
                        item1 = items[i]
                        item2 = items[j]
                        
                        # 計算相似度
                        similarity = self._calculate_similarity(item1, item2)
                        
                        if similarity >= similarity_threshold:
                            similar_groups.append({
                                'category': category,
                                'memory1': item1,
                                'memory2': item2,
                                'similarity': similarity
                            })
                            self.consolidation_log.append({
                                'timestamp': datetime.now().isoformat(),
                                'action': 'similarity_detected',
                                'memory1_id': item1['id'],
                                'memory2_id': item2['id'],
                                'similarity': similarity
                            })
                            
        finally:
            conn.close()
            
        return similar_groups

    def _calculate_similarity(self, item1, item2):
        """
        計算兩個記憶項目的相似度
        
        考量因素：
        1. 內容相似度（TF-IDF 風格）
        2. 標籤重疊度
        3. 摘要相似度
        """
        # 內容相似度
        content1 = (item1.get('content') or '').lower()
        content2 = (item2.get('content') or '').lower()
        
        if content1 and content2:
            content_sim = SequenceMatcher(None, content1, content2).ratio()
        else:
            content_sim = 0.0
            
        # 標籤重疊度
        tags1 = self._normalize_tags(item1.get('tags') or '')
        tags2 = self._normalize_tags(item2.get('tags') or '')
        
        if tags1 and tags2:
            overlap = len(tags1 & tags2)
            union = len(tags1 | tags2)
            tag_sim = overlap / union if union > 0 else 0.0
        else:
            tag_sim = 0.0
            
        # 摘要相似度
        summary1 = (item1.get('summary') or '').lower()
        summary2 = (item2.get('summary') or '').lower()
        
        if summary1 and summary2:
            summary_sim = SequenceMatcher(None, summary1, summary2).ratio()
        else:
            summary_sim = 0.0
        
        # 加權平均（內容為主）
        return (content_sim * 0.5) + (tag_sim * 0.3) + (summary_sim * 0.2)

    def merge_memories(self, memory_id1, memory_id2, strategy='keep_newer'):
        """
        合併兩個相似的記憶
        
        策略：
        - keep_newer: 保留較新的，標記舊的為已合併
        - keep_older: 保留較舊的
        - keep_both: 都保留但建立連結
        - merge_content: 合併內容到一個條目
        
        Returns: (success, message)
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            # 取得兩個記憶的詳細資訊
            cursor.execute("""
                SELECT id, path, content, tags, summary, last_accessed, 
                       emotional_resonance_score
                FROM memory_blocks WHERE id IN (?, ?)
            """, (memory_id1, memory_id2))
            rows = cursor.fetchall()
            
            if len(rows) != 2:
                return False, "One or both memories not found"
            
            mem1 = {
                'id': rows[0][0], 'path': rows[0][1],
                'content': rows[0][2], 'tags': rows[0][3],
                'summary': rows[0][4], 'last_accessed': rows[0][5],
                'ers': rows[0][6] or 0.0
            }
            mem2 = {
                'id': rows[1][0], 'path': rows[1][1],
                'content': rows[1][2], 'tags': rows[1][3],
                'summary': rows[1][4], 'last_accessed': rows[1][5],
                'ers': rows[1][6] or 0.0
            }
            
            # 比較時間，決定保留哪個
            if strategy == 'keep_newer':
                newer = mem1 if mem1['last_accessed'] > mem2['last_accessed'] else mem2
                older = mem2 if mem1['last_accessed'] > mem2['last_accessed'] else mem1
            elif strategy == 'keep_older':
                older = mem1 if mem1['last_accessed'] > mem2['last_accessed'] else mem2
                newer = mem2 if mem1['last_accessed'] > mem2['last_accessed'] else mem1
            else:
                newer = mem1
                older = mem2
            
            # 標記舊的為已合併（實際刪除或移動到archive）
            if older['path'] and os.path.exists(older['path']):
                # 移動到 archive 目錄
                archive_path = os.path.join(ARCHIVE_DIR, os.path.basename(older['path']))
                os.makedirs(ARCHIVE_DIR, exist_ok=True)
                
                # 如果 archive 也有同名檔案，加時間戳
                if os.path.exists(archive_path):
                    base, ext = os.path.splitext(archive_path)
                    archive_path = f"{base}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
                
                os.rename(older['path'], archive_path)
            
            # 刪除舊的 DB 記錄
            cursor.execute("DELETE FROM memory_blocks WHERE id = ?", (older['id'],))
            conn.commit()
            
            self.consolidation_log.append({
                'timestamp': datetime.now().isoformat(),
                'action': 'memories_merged',
                'kept_id': newer['id'],
                'merged_id': older['id'],
                'archive_path': archive_path if older['path'] else None
            })
            
            return True, f"Merged {older['id']} into {newer['id']}"
            
        except Exception as e:
            conn.rollback()
            return False, str(e)
        finally:
            conn.close()

    def index_unindexed_files(self, unindexed_files):
        """
        將未索引的檔案加入資料庫
        
        Returns: (count, errors)
        """
        indexed_count = 0
        errors = []
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for file_info in unindexed_files:
                try:
                    file_path = file_info['path']
                    
                    # 讀取內容
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
                    if match:
                        try:
                            metadata = yaml.safe_load(match.group(1))
                            body = match.group(2).strip()
                        except:
                            metadata = {}
                            body = content
                    else:
                        metadata = {}
                        body = content
                    
                    tags = ",".join(metadata.get('tags', [])) if isinstance(metadata.get('tags'), list) else (metadata.get('tags') or '')
                    
                    cursor.execute("""
                        INSERT OR REPLACE INTO memory_blocks 
                        (id, path, category, content, tags, summary, priority, last_accessed)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        file_info['id'],
                        file_path,
                        file_info['category'],
                        body,
                        tags,
                        metadata.get('summary', ''),
                        metadata.get('priority', 'medium'),
                        metadata.get('last_accessed', datetime.now().isoformat())
                    ))
                    
                    indexed_count += 1
                    self.consolidation_log.append({
                        'timestamp': datetime.now().isoformat(),
                        'action': 'file_indexed',
                        'path': file_path
                    })
                    
                except Exception as e:
                    errors.append({'file': file_info['path'], 'error': str(e)})
                    
            conn.commit()
            
        finally:
            conn.close()
            
        return indexed_count, errors

    def remove_orphaned_entries(self, orphaned_entries, move_to_archive=True):
        """
        移除孤立項目（DB有記錄但檔案不存在）
        
        Returns: (count, errors)
        """
        removed_count = 0
        errors = []
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for entry in orphaned_entries:
                try:
                    entry_id = entry['id']
                    
                    # 如果有路徑但檔案不存在，移動到 archive（如果選擇）
                    if entry.get('path') and move_to_archive:
                        archive_path = os.path.join(ARCHIVE_DIR, os.path.basename(entry['path']))
                        os.makedirs(ARCHIVE_DIR, exist_ok=True)
                        
                        if os.path.exists(archive_path):
                            base, ext = os.path.splitext(archive_path)
                            archive_path = f"{base}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
                        
                        # 創建一個 stub 檔案記錄曾經存在
                        try:
                            with open(archive_path, 'w', encoding='utf-8') as f:
                                f.write(f"""---
category: {entry.get('category', 'unknown')}
id: {entry_id}
archived: {datetime.now().isoformat()}
reason: orphaned_file
original_path: {entry.get('path', 'unknown')}
---

# Archived Memory: {entry_id}

This memory was archived because the original file no longer exists.
Original path: {entry.get('path', 'unknown')}
Archived at: {datetime.now().isoformat()}
""")
                        except:
                            pass
                    
                    # 從 DB 刪除
                    cursor.execute("DELETE FROM memory_blocks WHERE id = ?", (entry_id,))
                    removed_count += 1
                    
                    self.consolidation_log.append({
                        'timestamp': datetime.now().isoformat(),
                        'action': 'orphan_removed',
                        'entry_id': entry_id
                    })
                    
                except Exception as e:
                    errors.append({'entry': entry['id'], 'error': str(e)})
                    
            conn.commit()
            
        finally:
            conn.close()
            
        return removed_count, errors

    def run_consolidation(self, dry_run=True, similarity_threshold=0.75):
        """
        執行完整的整合流程
        
        dry_run: 若為 True，只報告問題不實際執行修改
        """
        report = {
            'timestamp': datetime.now().isoformat(),
            'dry_run': dry_run,
            'orphaned_entries': [],
            'unindexed_files': [],
            'similar_memories': [],
            'actions_taken': [],
            'errors': []
        }
        
        print(f"[{datetime.now().isoformat()}] Starting Memory Consolidation (dry_run={dry_run})...")
        
        # 1. 檢測孤立項目
        print("[1/4] Checking for orphaned entries...")
        orphaned = self.check_orphaned_entries()
        report['orphaned_entries'] = orphaned
        print(f"  Found {len(orphaned)} orphaned entries")
        
        # 2. 檢測未索引檔案
        print("[2/4] Checking for unindexed files...")
        unindexed = self.check_unindexed_files()
        report['unindexed_files'] = unindexed
        print(f"  Found {len(unindexed)} unindexed files")
        
        # 3. 檢測相似記憶
        print("[3/4] Checking for similar memories...")
        similar = self.find_similar_memories(similarity_threshold)
        report['similar_memories'] = similar
        print(f"  Found {len(similar)} similar memory groups")
        
        # 4. 執行操作（如果非 dry_run）
        if not dry_run:
            print("[4/4] Executing consolidation actions...")
            
            # 索引未索引的檔案
            if unindexed:
                indexed, errors = self.index_unindexed_files(unindexed)
                report['actions_taken'].append(f"Indexed {indexed} files")
                report['errors'].extend(errors)
            
            # 移除孤立項目
            if orphaned:
                removed, errors = self.remove_orphaned_entries(orphaned)
                report['actions_taken'].append(f"Removed {removed} orphaned entries")
                report['errors'].extend(errors)
        else:
            print("[4/4] Dry run - no changes made")
            
        print(f"\n[Consolidation Summary]")
        print(f"  Orphaned entries: {len(orphaned)}")
        print(f"  Unindexed files: {len(unindexed)}")
        print(f"  Similar memory groups: {len(similar)}")
        
        if dry_run:
            print(f"\n  Run with dry_run=False to execute changes")
            
        return report

    def get_consolidation_log(self):
        """取得整合日誌"""
        return self.consolidation_log

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Memory Consolidation Layer')
    parser.add_argument('--execute', action='store_true', help='Execute changes (default is dry-run)')
    parser.add_argument('--threshold', type=float, default=0.75, help='Similarity threshold (0.0-1.0)')
    parser.add_argument('--merge', nargs=2, metavar=('ID1', 'ID2'), help='Merge two memories')
    parser.add_argument('--strategy', choices=['keep_newer', 'keep_older', 'keep_both', 'merge_content'], 
                       default='keep_newer', help='Merge strategy')
    
    args = parser.parse_args()
    
    consolidator = MemoryConsolidator()
    
    if args.merge:
        success, msg = consolidator.merge_memories(args.merge[0], args.merge[1], args.strategy)
        print(f"Merge result: {msg}")
    else:
        consolidator.run_consolidation(dry_run=not args.execute, similarity_threshold=args.threshold)
