"""
Yua Memory Archive Manager - #6 WAL + Archive-as-Code

功能：
- 讓 Yua 可以「回滾」記憶
- 類似 Git 的概念，可以回到之前的版本
- Archive-as-Code：每次修改都有記錄，可以撤銷

設計原則：
- 所有修改都有版本歷史
- 可以隨時回滾到任意版本
- 類似 Git 的 commit/rollback 概念
"""

import os
import re
import sqlite3
import json
import shutil
import hashlib
from datetime import datetime
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field, asdict
from enum import Enum
from .path_manager import PathManager

# 配置
WORKSPACE_DIR = str(PathManager().workspace())
ARCHIVE_BASE = os.path.join(WORKSPACE_DIR, "qmd", "archive")
ARCHIVE_META = os.path.join(ARCHIVE_BASE, "_archive_meta")
DB_PATH = os.path.join(WORKSPACE_DIR, "config", "memory_vector_index.db")

# Archive metadata DB (tracks all changes)
ARCHIVE_DB = os.path.join(ARCHIVE_META, "archive_index.db")


class OperationType(Enum):
    """操作類型枚舉"""
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    MERGE = "merge"
    RESTORE = "restore"  # 回滾恢復


@dataclass
class ArchiveEntry:
    """歸檔條目"""
    archive_id: str          # 唯一歸檔ID (UUID-like)
    memory_id: str           # 原始記憶ID
    operation: OperationType # 操作類型
    timestamp: str           # 操作時間
    content_before: str      # 操作前的內容
    content_after: str       # 操作後的內容
    tags_before: str         # 操作前的標籤
    tags_after: str          # 操作後的標籤
    category_before: str     # 操作前的分類
    category_after: str      # 操作後的分類
    priority_before: str     # 操作前的優先級
    priority_after: str      # 操作後的優先級
    file_path: str           # QMD 檔案路徑
    checksum_before: str      # 操作前的校驗和
    checksum_after: str       # 操作後的校驗和
    reason: str = ""          # 操作原因/備註
    rollback_available: bool = True  # 是否可以回滾


@dataclass
class RollbackResult:
    """回滾結果"""
    success: bool
    message: str
    restored_entry: Optional[Dict] = None
    affected_archives: int = 0


class MemoryArchiveManager:
    """
    Yua 的記憶歸檔管理器 (Archive-as-Code)
    
    功能：
    1. 記錄所有記憶修改（類似 Git commit）
    2. 支持回滾到任意版本（git reset / git revert）
    3. 維護完整的變更歷史（git log）
    4. 校驗和驗證（防止資料損壞）
    
    概念對應：
    - Archive Entry = Git Commit
    - Rollback = Git Reset/Revert
    - Archive ID = Git Commit Hash
    - Memory ID = File Path
    """

    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self._ensure_archive_dirs()
        self._init_archive_db()

    def _ensure_archive_dirs(self):
        """確保歸檔目錄存在"""
        os.makedirs(ARCHIVE_META, exist_ok=True)
        os.makedirs(ARCHIVE_BASE, exist_ok=True)

    def _init_archive_db(self):
        """初始化歸檔索引資料庫"""
        conn = sqlite3.connect(ARCHIVE_DB, timeout=10)
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS archive_index (
                archive_id TEXT PRIMARY KEY,
                memory_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                content_before TEXT,
                content_after TEXT,
                tags_before TEXT,
                tags_after TEXT,
                category_before TEXT,
                category_after TEXT,
                priority_before TEXT,
                priority_after TEXT,
                file_path TEXT,
                checksum_before TEXT,
                checksum_after TEXT,
                reason TEXT DEFAULT '',
                rollback_available INTEGER DEFAULT 1,
                FOREIGN KEY(memory_id) REFERENCES memory_blocks(id)
            )
        ''')
        
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_memory_id ON archive_index(memory_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_timestamp ON archive_index(timestamp)')
        
        conn.commit()
        conn.close()

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _get_archive_connection(self):
        return sqlite3.connect(ARCHIVE_DB, timeout=10)

    def _compute_checksum(self, content: str) -> str:
        """計算內容的校驗和 (SHA256)"""
        return hashlib.sha256(content.encode('utf-8')).hexdigest()[:16]

    def _generate_archive_id(self) -> str:
        """生成唯一的歸檔ID"""
        import uuid
        return f"arc_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"

    def record_change(self, memory_id: str, operation: OperationType,
                      content_before: str, content_after: str,
                      tags_before: str = "", tags_after: str = "",
                      category_before: str = "", category_after: str = "",
                      priority_before: str = "", priority_after: str = "",
                      file_path: str = "", reason: str = "") -> str:
        """
        記錄一次記憶變更（類似 Git Commit）
        
        調用時機：
        - 記憶被創建時 (CREATE)
        - 記憶被更新時 (UPDATE)
        - 記憶被刪除時 (DELETE)
        - 記憶被合併時 (MERGE)
        
        Returns: archive_id
        """
        archive_id = self._generate_archive_id()
        
        entry = ArchiveEntry(
            archive_id=archive_id,
            memory_id=memory_id,
            operation=operation,
            timestamp=datetime.now().isoformat(),
            content_before=content_before,
            content_after=content_after,
            tags_before=tags_before,
            tags_after=tags_after,
            category_before=category_before,
            category_after=category_after,
            priority_before=priority_before,
            priority_after=priority_after,
            file_path=file_path,
            checksum_before=self._compute_checksum(content_before),
            checksum_after=self._compute_checksum(content_after),
            reason=reason,
            rollback_available=True
        )
        
        # 保存歸檔索引
        conn = self._get_archive_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO archive_index 
            (archive_id, memory_id, operation, timestamp, content_before, content_after,
             tags_before, tags_after, category_before, category_after, priority_before, priority_after,
             file_path, checksum_before, checksum_after, reason, rollback_available)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            entry.archive_id, entry.memory_id, entry.operation.value, entry.timestamp,
            entry.content_before, entry.content_after,
            entry.tags_before, entry.tags_after,
            entry.category_before, entry.category_after,
            entry.priority_before, entry.priority_after,
            entry.file_path, entry.checksum_before, entry.checksum_after,
            entry.reason, 1 if entry.rollback_available else 0
        ))
        
        conn.commit()
        conn.close()
        
        # 如果有檔案路徑，也歸檔檔案本身
        if file_path and os.path.exists(file_path):
            self._archive_file_copy(file_path, memory_id, archive_id)
        
        return archive_id

    def _archive_file_copy(self, original_path: str, memory_id: str, archive_id: str):
        """將檔案歸檔（類似 Git Blob）"""
        # 組織歸檔目錄結構: archive_base/memory_id/YYYY-MM/
        mem_dir = os.path.join(ARCHIVE_BASE, memory_id)
        os.makedirs(mem_dir, exist_ok=True)
        
        # 複製原始檔案
        dest_path = os.path.join(mem_dir, f"{archive_id}.md")
        try:
            shutil.copy2(original_path, dest_path)
        except Exception as e:
            print(f"[Archive] Failed to copy file: {e}")

    def get_history(self, memory_id: str, limit: int = 50) -> List[Dict]:
        """
        獲取記憶的歷史記錄（類似 Git Log）
        
        Returns: List of archive entries (newest first)
        """
        conn = self._get_archive_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT archive_id, memory_id, operation, timestamp, 
                   content_before, content_after,
                   tags_before, tags_after,
                   category_before, category_after,
                   priority_before, priority_after,
                   checksum_before, checksum_after,
                   reason, rollback_available
            FROM archive_index
            WHERE memory_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        ''', (memory_id, limit))
        
        rows = cursor.fetchall()
        conn.close()
        
        history = []
        for row in rows:
            history.append({
                'archive_id': row[0],
                'memory_id': row[1],
                'operation': row[2],
                'timestamp': row[3],
                'content_before': row[4],
                'content_after': row[5],
                'tags_before': row[6],
                'tags_after': row[7],
                'category_before': row[8],
                'category_after': row[9],
                'priority_before': row[10],
                'priority_after': row[11],
                'checksum_before': row[12],
                'checksum_after': row[13],
                'reason': row[14],
                'rollback_available': bool(row[15])
            })
        
        return history

    def get_last_valid_state(self, memory_id: str) -> Optional[Dict]:
        """
        獲取記憶的最後有效狀態
        
        查找最新的非DELETE操作
        """
        history = self.get_history(memory_id, limit=100)
        for entry in history:
            if entry['operation'] != OperationType.DELETE.value and entry['rollback_available']:
                return entry
        return None

    def rollback_to(self, memory_id: str, target_archive_id: str, 
                    reason: str = "User requested rollback") -> RollbackResult:
        """
        回滾記憶到指定的歸檔版本（類似 Git Reset）
        
        這會：
        1. 創建一個新的 RESTORE 歸檔條目
        2. 恢復目標歸檔的內容到記憶
        3. 標記中間的歸檔為不可回滾
        """
        conn = self._get_archive_connection()
        cursor = conn.cursor()
        
        # 查找目標歸檔
        cursor.execute('''
            SELECT * FROM archive_index 
            WHERE archive_id = ? AND memory_id = ?
        ''', (target_archive_id, memory_id))
        
        target_row = cursor.fetchone()
        if not target_row:
            conn.close()
            return RollbackResult(
                success=False,
                message=f"Archive {target_archive_id} not found for memory {memory_id}"
            )
        
        target_entry = {
            'archive_id': target_row[0],
            'memory_id': target_row[1],
            'operation': target_row[2],
            'timestamp': target_row[3],
            'content_before': target_row[4],
            'content_after': target_row[5],
            'tags_before': target_row[6],
            'tags_after': target_row[7],
            'category_before': target_row[8],
            'category_after': target_row[9],
            'priority_before': target_row[10],
            'priority_after': target_row[11],
            'file_path': target_row[12],
            'checksum_before': target_row[13],
            'checksum_after': target_row[14],
            'reason': target_row[15],
            'rollback_available': bool(target_row[16])
        }
        
        # 獲取當前記憶的內容
        mem_conn = self._get_connection()
        mem_cursor = mem_conn.cursor()
        
        mem_cursor.execute('''
            SELECT id, path, category, content, tags, summary, priority
            FROM memory_blocks WHERE id = ?
        ''', (memory_id,))
        
        current_row = mem_cursor.fetchone()
        current_content = current_row[3] if current_row else ""
        current_tags = current_row[4] if current_row else ""
        current_category = current_row[2] if current_row else ""
        current_priority = current_row[6] if current_row else ""
        current_path = current_row[1] if current_row else ""
        
        mem_conn.close()
        
        # 決定要恢復的內容
        # 如果目標是 UPDATE，恢復 content_before
        # 如果目標是 CREATE，恢復 content_after（創建後的內容）
        if target_entry['operation'] == OperationType.CREATE.value:
            restore_content = target_entry['content_after']
            restore_tags = target_entry['tags_after']
            restore_category = target_entry['category_after']
            restore_priority = target_entry['priority_after']
        else:
            restore_content = target_entry['content_before']
            restore_tags = target_entry['tags_before']
            restore_category = target_entry['category_before']
            restore_priority = target_entry['priority_before']
        
        # 執行回滾
        try:
            # 如果記憶存在，更新它
            if current_row:
                mem_conn2 = self._get_connection()
                mem_conn2.execute('''
                    UPDATE memory_blocks 
                    SET content = ?, tags = ?, category = ?, priority = ?,
                        last_accessed = ?
                    WHERE id = ?
                ''', (restore_content, restore_tags, restore_category, restore_priority,
                      datetime.now().isoformat(), memory_id))
                mem_conn2.commit()
                mem_conn2.close()
            else:
                # 記憶不存在，創建它
                mem_conn2 = self._get_connection()
                mem_conn2.execute('''
                    INSERT INTO memory_blocks 
                    (id, path, category, content, tags, summary, priority, last_accessed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (memory_id, current_path, restore_category, restore_content,
                      restore_tags, '', restore_priority, datetime.now().isoformat()))
                mem_conn2.commit()
                mem_conn2.close()
            
            # 更新歸檔檔案（如果有的話）
            if current_path and os.path.exists(current_path):
                # 備份當前檔案
                backup_path = current_path + f".backup_{datetime.now().strftime('%Y%m%d%H%M%S')}"
                shutil.copy2(current_path, backup_path)
                
                # 寫入恢復後的內容
                import yaml
                metadata = {
                    'id': memory_id,
                    'category': restore_category,
                    'tags': restore_tags.split(',') if restore_tags else [],
                    'priority': restore_priority,
                    'restored_from': target_archive_id,
                    'restored_at': datetime.now().isoformat()
                }
                with open(current_path, 'w', encoding='utf-8') as f:
                    f.write("---\n")
                    f.write(yaml.dump(metadata, allow_unicode=True))
                    f.write("---\n\n")
                    f.write(restore_content)
            
            # 標記中間的歸檔為不可回滾
            cursor.execute('''
                UPDATE archive_index 
                SET rollback_available = 0
                WHERE memory_id = ? 
                AND timestamp > ?
            ''', (memory_id, target_entry['timestamp']))
            
            # 記錄這次回滾操作
            rollback_archive_id = self.record_change(
                memory_id=memory_id,
                operation=OperationType.RESTORE,
                content_before=current_content,
                content_after=restore_content,
                tags_before=current_tags,
                tags_after=restore_tags,
                category_before=current_category,
                category_after=restore_category,
                priority_before=current_priority,
                priority_after=restore_priority,
                file_path=current_path,
                reason=f"Rollback to {target_archive_id}: {reason}"
            )
            
            conn.commit()
            conn.close()
            
            return RollbackResult(
                success=True,
                message=f"Successfully rolled back to archive {target_archive_id}",
                restored_entry={
                    'memory_id': memory_id,
                    'content': restore_content,
                    'tags': restore_tags,
                    'category': restore_category,
                    'priority': restore_priority
                },
                affected_archives=1
            )
            
        except Exception as e:
            conn.close()
            return RollbackResult(
                success=False,
                message=f"Rollback failed: {str(e)}"
            )

    def list_rollback_points(self, memory_id: str) -> List[Dict]:
        """
        列出可以回滾的版本點（類似 Git Reflog）
        
        Returns: List of rollback points
        """
        history = self.get_history(memory_id)
        
        rollback_points = []
        for entry in history:
            if entry['rollback_available']:
                # 構建描述
                op = entry['operation']
                if op == OperationType.CREATE.value:
                    desc = f"Created: {entry['content_after'][:50]}..."
                elif op == OperationType.UPDATE.value:
                    desc = f"Updated: {entry['content_after'][:50]}..."
                elif op == OperationType.DELETE.value:
                    desc = "Deleted"
                elif op == OperationType.RESTORE.value:
                    desc = f"Restored: {entry['reason']}"
                else:
                    desc = entry['content_after'][:50]
                
                rollback_points.append({
                    'archive_id': entry['archive_id'],
                    'timestamp': entry['timestamp'],
                    'operation': op,
                    'description': desc,
                    'tags_after': entry['tags_after']
                })
        
        return rollback_points

    def verify_integrity(self, memory_id: str) -> Tuple[bool, List[str]]:
        """
        驗證記憶的完整性（校驗和檢查）
        
        Returns: (is_valid, list_of_issues)
        """
        issues = []
        
        history = self.get_history(memory_id)
        if not history:
            return True, []  # 沒有歷史，默認有效
        
        # 檢查校驗和
        for entry in history:
            if entry['content_after']:
                expected = self._compute_checksum(entry['content_after'])
                if expected != entry['checksum_after']:
                    issues.append(f"Checksum mismatch at {entry['archive_id']}")
        
        return len(issues) == 0, issues

    def cleanup_old_archives(self, memory_id: str, keep_count: int = 10):
        """
        清理舊的歸檔（保留最近的 N 個版本）
        
        警告：這是危險操作，會永久刪除歸檔
        """
        history = self.get_history(memory_id)
        
        if len(history) <= keep_count:
            return 0
        
        deleted = 0
        conn = self._get_archive_connection()
        cursor = conn.cursor()
        
        # 保留最新的 N 個
        to_delete = history[keep_count:]
        for entry in to_delete:
            if not entry['rollback_available']:
                # 只刪除不可回滾的舊歸檔
                cursor.execute('DELETE FROM archive_index WHERE archive_id = ?',
                             (entry['archive_id'],))
                deleted += 1
        
        conn.commit()
        conn.close()
        
        return deleted


def integrate_with_consolidation(consolidator_class):
    """
    將 Archive Manager 集成到 Consolidation 模組
    
    在合併記憶時自動記錄歸檔
    """
    original_merge = consolidator_class.merge_memories
    
    def new_merge(self, memory_id1, memory_id2, strategy='keep_newer'):
        # 調用原有合併邏輯
        result, msg = original_merge(self, memory_id1, memory_id2, strategy)
        
        if result:
            # 記錄歸檔
            archive = MemoryArchiveManager()
            
            # 獲取兩個記憶的內容
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT id, content, tags, category, priority FROM memory_blocks WHERE id IN (?, ?)",
                         (memory_id1, memory_id2))
            rows = cursor.fetchall()
            conn.close()
            
            if len(rows) == 1:
                # 合併後只剩下一個
                merged_content = rows[0][1]
                merged_tags = rows[0][2]
                
                # 記錄兩個原始記憶的內容
                for row in rows:
                    archive.record_change(
                        memory_id=row[0],
                        operation=OperationType.MERGE,
                        content_before=row[1],
                        content_after=merged_content,
                        tags_before=row[2],
                        tags_after=merged_tags,
                        category_before=row[3],
                        category_after=merged_tags,  # 簡化
                        priority_before=row[4],
                        priority_after=row[4],
                        reason=f"Merged {memory_id1} and {memory_id2} using strategy {strategy}"
                    )
        
        return result, msg
    
    consolidator_class.merge_memories = new_merge
    return consolidator_class


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Memory Archive Manager - WAL + Archive-as-Code')
    parser.add_argument('--list', metavar='MEMORY_ID', help='List archive history for memory')
    parser.add_argument('--rollback-points', metavar='MEMORY_ID', 
                       help='List available rollback points')
    parser.add_argument('--rollback', nargs=2, metavar=('MEMORY_ID', 'ARCHIVE_ID'),
                       help='Rollback memory to specific archive')
    parser.add_argument('--verify', metavar='MEMORY_ID', help='Verify memory integrity')
    parser.add_argument('--record', nargs=3, metavar=('MEMORY_ID', 'OP', 'CONTENT'),
                       help='Record a change (CREATE/UPDATE/DELETE)')
    
    args = parser.parse_args()
    
    archive = MemoryArchiveManager()
    
    if args.list:
        history = archive.get_history(args.list)
        print(f"\n=== Archive History for {args.list} ===")
        for h in history:
            print(f"\n[{h['archive_id']}] {h['operation']} at {h['timestamp']}")
            print(f"  Before: {h['content_before'][:50] if h['content_before'] else '(empty)'}...")
            print(f"  After: {h['content_after'][:50] if h['content_after'] else '(empty)'}...")
    
    elif args.rollback_points:
        points = archive.list_rollback_points(args.rollback_points)
        print(f"\n=== Rollback Points for {args.rollback_points} ===")
        for p in points:
            print(f"\n[{p['archive_id']}] {p['timestamp']}")
            print(f"  {p['description']}")
    
    elif args.rollback:
        memory_id, archive_id = args.rollback
        result = archive.rollback_to(memory_id, archive_id)
        print(f"\n{'[SUCCESS]' if result.success else '[FAILED]'} {result.message}")
        if result.restored_entry:
            print(f"  Restored content: {result.restored_entry['content'][:50]}...")
    
    elif args.verify:
        valid, issues = archive.verify_integrity(args.verify)
        print(f"\n=== Integrity Check for {args.verify} ===")
        print(f"Valid: {valid}")
        if issues:
            for issue in issues:
                print(f"  Issue: {issue}")
    
    elif args.record:
        memory_id, op, content = args.record
        try:
            op_type = OperationType[op.upper()]
        except KeyError:
            print(f"Unknown operation: {op}")
            exit(1)
        
        archive_id = archive.record_change(
            memory_id=memory_id,
            operation=op_type,
            content_before="",
            content_after=content,
            reason="Manual record"
        )
        print(f"\n[OK] Recorded change: {archive_id}")
    
    else:
        print("\nMemory Archive Manager - WAL + Archive-as-Code")
        print("\nUsage:")
        print("  --list MEMORY_ID              Show archive history")
        print("  --rollback-points MEMORY_ID   Show available rollback points")
        print("  --rollback MEMORY_ID ARCHIVE_ID   Rollback to specific version")
        print("  --verify MEMORY_ID            Verify memory integrity")
        print("  --record MEMORY_ID OP CONTENT Record a change (CREATE/UPDATE/DELETE)")
