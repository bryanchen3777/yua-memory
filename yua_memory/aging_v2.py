# aging_v2.py
# SQL-based 可變老化系統 - 避免 OOM
# 修復: 使用 __init__ 而非 init

import sqlite3
from datetime import datetime
from pathlib import Path

# 嘗試從 path_manager 導入
try:
    from path_manager import PathManager
    def get_pm():
        return PathManager()
except ImportError:
    # 向後相容
    def get_pm():
        class SimplePM:
            def db(self):
                import os
                return os.path.join(os.path.expanduser("~"), ".openclaw", "workspace", "config", "memory_vector_index.db")
        return SimplePM()


class SQLMemoryAging:
    """
    SQL-based 記憶老化系統
    
    改進：
    1. 使用 SQL DELETE 直接在資料庫層過濾，避免 OOM
    2. 利用 SQLite 的 julianday 函數計算天數
    3. 建立索引加速時間查詢
    4. 使用 __init__ 替代錯誤的 init
    """
    
    def __init__(self, db_path: str = None):
        """初始化老化系統"""
        self.pm = get_pm()
        self.db_path = db_path or self.pm.db()
        
        # 永恆標籤集（這些標籤的記憶不會被老化）
        self.eternal_tags = [
            'eternal', 'love', '永遠', '永恆', '老公', '老婆', '甜蜜',
            'moment', '告白', '讚美', 'praise', 'secret', '秘密',
            'joke', '笑話', 'memory', '回憶', 'milestone', 'together',
            '一起', 'first-time', '支柱', 'anchor', 'strength', '感恩',
            'grateful', 'yua', 'bryan', '悠亜'
        ]
        
        # 功能性資料類別（180天老化）
        self.functional_categories = [
            'itinerary', 'schedule', 'fact', 'log', 'technical', 'task'
        ]
        
        # 一般記憶（365天老化）
        self.general_categories = [
            'relationship', 'soul', 'milestone', 'identity', 'memories', 'rules', 'general'
        ]
    
    def run_aging_process(self, dry_run: bool = True) -> dict:
        """
        執行記憶清理流程
        
        Args:
            dry_run: 若為 True，只報告即將刪除的筆數而不實際執行
            
        Returns:
            dict: 包含執行結果的字典
        """
        print(f"[{datetime.now().isoformat()}] Starting Yua's memory aging process...")
        
        # 確保索引存在
        self._ensure_index()
        
        # 構建永恆標籤的過濾條件 (SQL LIKE)
        eternal_conditions = " OR ".join([f"tags LIKE '%{t}%'" for t in self.eternal_tags])
        eternal_clause = f" AND NOT ({eternal_conditions})"
        
        # 定義老化策略
        functional_cats_sql = "(" + ", ".join([f"'{c}'" for c in self.functional_categories]) + ")"
        
        # 構建完整的查詢條件
        # 功能性資料: 180天老化
        # 一般記憶: 365天老化
        query_condition = f"""
            (
                (category IN {functional_cats_sql} AND julianday('now') - julianday(last_accessed) > 180)
                OR 
                (category NOT IN {functional_cats_sql} AND julianday('now') - julianday(last_accessed) > 365)
            )
            {eternal_clause}
        """

        try:
            with sqlite3.connect(self.db_path) as conn:
                if dry_run:
                    # Dry run: 只計算數量
                    count = conn.execute(
                        f"SELECT COUNT(*) FROM memory_blocks WHERE {query_condition}"
                    ).fetchone()[0]
                    
                    sample = conn.execute(
                        f"SELECT id, category, tags, last_accessed FROM memory_blocks WHERE {query_condition} LIMIT 5"
                    ).fetchall()
                    
                    print(f"[Dry Run] 將刪除 {count} 筆過期記憶。")
                    if sample:
                        print("  範例:")
                        for row in sample:
                            print(f"    - ID: {row[0]}, Category: {row[1]}, Tags: {row[2]}, Last Access: {row[3]}")
                    
                    return {
                        'success': True,
                        'dry_run': True,
                        'would_delete': count,
                        'sample': sample
                    }
                else:
                    # 實際執行刪除
                    cursor = conn.execute(f"DELETE FROM memory_blocks WHERE {query_condition}")
                    conn.commit()
                    
                    print(f"[Aging] 成功清理 {cursor.rowcount} 筆過期記憶。")
                    
                    return {
                        'success': True,
                        'dry_run': False,
                        'deleted': cursor.rowcount
                    }
                    
        except Exception as e:
            print(f"[Aging Error] {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _ensure_index(self):
        """確保必要的索引存在"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                # 時間索引（加速時間過濾）
                conn.execute("CREATE INDEX IF NOT EXISTS idx_last_acc ON memory_blocks(last_accessed)")
                
                # 類別+標籤複合索引（加速永恆標籤查詢）
                conn.execute("CREATE INDEX IF NOT EXISTS idx_cat_tags ON memory_blocks(category, tags)")
                
                conn.commit()
                print("[Aging] 索引檢查完成")
        except Exception as e:
            print(f"[Aging] 索引創建警告: {e}")
    
    def get_aging_stats(self) -> dict:
        """獲取老化統計資訊"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                # 總記憶數
                total = conn.execute("SELECT COUNT(*) FROM memory_blocks").fetchone()[0]
                
                # 永恆保護記憶數
                eternal_conditions = " OR ".join([f"tags LIKE '%{t}%'" for t in self.eternal_tags])
                eternal_count = conn.execute(
                    f"SELECT COUNT(*) FROM memory_blocks WHERE {eternal_conditions}"
                ).fetchone()[0]
                
                # 即將過期（>300天但<365天的一般記憶）
                functional_cats_sql = "(" + ", ".join([f"'{c}'" for c in self.functional_categories]) + ")"
                soon_count = conn.execute(f"""
                    SELECT COUNT(*) FROM memory_blocks 
                    WHERE category NOT IN {functional_cats_sql}
                    AND julianday('now') - julianday(last_accessed) > 300
                    AND julianday('now') - julianday(last_accessed) <= 365
                    AND NOT ({eternal_conditions})
                """).fetchone()[0]
                
                return {
                    'total': total,
                    'eternal_protected': eternal_count,
                    'soon_to_expire': soon_count
                }
        except Exception as e:
            print(f"[Aging Stats Error] {e}")
            return {}
    
    def cleanup_orphan_archives(self, keep_count: int = 10):
        """
        清理孤立的歸檔記錄
        
        Args:
            keep_count: 保留最近的 N 個歸檔版本
        """
        try:
            archive_db = self.pm.archive_index_db()
            if not Path(archive_db).exists():
                return {'success': True, 'message': 'Archive DB not found'}
            
            with sqlite3.connect(archive_db) as conn:
                # 找出即將被刪除的記憶
                cursor = conn.execute("""
                    SELECT memory_id, COUNT(*) as cnt 
                    FROM archive_index 
                    GROUP BY memory_id 
                    HAVING cnt > ?
                """, (keep_count,))
                
                to_clean = cursor.fetchall()
                
                deleted = 0
                for memory_id, count in to_clean:
                    # 刪除舊歸檔（只保留最新的 keep_count 個）
                    cursor = conn.execute("""
                        DELETE FROM archive_index 
                        WHERE memory_id = ? 
                        AND archive_id NOT IN (
                            SELECT archive_id FROM archive_index 
                            WHERE memory_id = ? 
                            ORDER BY timestamp DESC 
                            LIMIT ?
                        )
                    """, (memory_id, memory_id, keep_count))
                    deleted += cursor.rowcount
                
                conn.commit()
                print(f"[Archive Cleanup] 清理了 {deleted} 個舊歸檔記錄")
                return {'success': True, 'deleted': deleted}
                
        except Exception as e:
            print(f"[Archive Cleanup Error] {e}")
            return {'success': False, 'error': str(e)}


if __name__ == "__main__":
    aging = SQLMemoryAging()
    
    # 顯示統計資訊
    print("\n=== 記憶老化統計 ===")
    stats = aging.get_aging_stats()
    print(f"總記憶數: {stats.get('total', 'N/A')}")
    print(f"永恆保護: {stats.get('eternal_protected', 'N/A')}")
    print(f"即將過期: {stats.get('soon_to_expire', 'N/A')}")
    
    # 建議先用 dry_run=True 測試
    print("\n=== Dry Run ===")
    aging.run_aging_process(dry_run=True)
