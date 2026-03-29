"""
Yua Memory Sync Monitor - #8 三層數據同步 (Three-tier Data Sync)

功能：
- 每24小時同步心跳，防止「幽靈記憶」
- 幽靈記憶：系統認為存在但實際已經損壞/遺失的記憶
- 三層：QMD、LCM、NotebookLM 之間要保持同步

三層架構：
1. QMD (文件層) - 原始 Markdown 文件
2. LCM (邏輯層) - memory_vector_index.db 邏輯索引
3. NotebookLM (外部層) - Google NotebookLM 知識庫

設計原則：
- 主動發現不一致
- 防止單點故障
- 自動修復小問題，報告大問題
"""

import os
import re
import sqlite3
import json
import hashlib
import shutil
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional, Set
from dataclasses import dataclass, field
from enum import Enum
from .path_manager import PathManager

# 配置
WORKSPACE_DIR = str(PathManager().workspace())
QMD_DIR = os.path.join(WORKSPACE_DIR, "qmd")
DB_PATH = os.path.join(WORKSPACE_DIR, "config", "memory_vector_index.db")
SYNC_STATE_FILE = os.path.join(WORKSPACE_DIR, "memory", "sync_state.json")
SYNC_LOG_PATH = os.path.join(WORKSPACE_DIR, "logs", "sync_report.log")
NOTEBOOKLM_API_URL = "https://api.notebooklm.google.com/v1"  # 假設的 API


class SyncStatus(Enum):
    """同步狀態枚舉"""
    IN_SYNC = "in_sync"           # 完全同步
    LCM_ONLY = "lcm_only"         # 只在 LCM 中存在 (QMD 缺失)
    QMD_ONLY = "qmd_only"          # 只在 QMD 中存在 (LCM 缺失)
    GHOST = "ghost"               # 幽靈記憶 (DB 存在但檔案缺失)
    ORPHAN = "orphan"             # 孤兒檔案 (LCM 不認識)
    CORRUPTED = "corrupted"       # 檔案損壞
    CONFLICT = "conflict"         # 衝突 (內容不一致)
    UNKNOWN = "unknown"           # 未知狀態


@dataclass
class MemoryEntity:
    """記憶實體"""
    memory_id: str
    path: Optional[str]
    category: str
    content: str
    tags: str
    checksum: str
    last_modified: str
    status: SyncStatus = SyncStatus.UNKNOWN


@dataclass
class SyncReport:
    """同步報告"""
    timestamp: str
    total_qmd: int = 0
    total_lcm: int = 0
    total_notebooklm: int = 0
    in_sync: int = 0
    ghosts: int = 0
    orphans: int = 0
    corrupted: int = 0
    conflicts: int = 0
    lcm_only: int = 0
    qmd_only: int = 0
    errors: List[str] = field(default_factory=list)
    actions_taken: List[str] = field(default_factory=list)


class MemorySyncMonitor:
    """
    Yua 的三層記憶同步監控器
    
    功能：
    1. 發現 QMD 和 LCM 不一致
    2. 檢測幽靈記憶 (ghost memories)
    3. 檢測孤兒檔案 (orphan files)
    4. 計算內容校驗和驗證完整性
    5. 每24小時心跳自動檢查
    6. NotebookLM 同步 (可選)
    
    使用方式：
    python sync_monitor.py --check  # 執行同步檢查
    python sync_monitor.py --report  # 生成同步報告
    python sync_monitor.py --fix     # 自動修復小問題
    """

    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self._ensure_directories()
        
    def _ensure_directories(self):
        """確保必要目錄存在"""
        os.makedirs(os.path.dirname(SYNC_STATE_FILE), exist_ok=True)
        os.makedirs(os.path.dirname(SYNC_LOG_PATH), exist_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _compute_checksum(self, content: str) -> str:
        """計算內容的 MD5 校驗和"""
        return hashlib.md5(content.encode('utf-8')).hexdigest()[:16]

    def scan_qmd(self) -> Dict[str, MemoryEntity]:
        """
        掃描 QMD 目錄，建立檔案列表
        
        Returns: Dict of memory_id -> MemoryEntity
        """
        qmd_entities = {}
        
        if not os.path.exists(QMD_DIR):
            return qmd_entities
        
        for root, dirs, files in os.walk(QMD_DIR):
            # 跳過歸檔目錄
            if 'archive' in root:
                continue
            
            for file in files:
                if not file.endswith('.md') or file == 'QMD_REPORT.md':
                    continue
                
                file_path = os.path.join(root, file)
                
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # 解析 frontmatter
                    match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
                    if match:
                        import yaml
                        try:
                            metadata = yaml.safe_load(match.group(1))
                            body = match.group(2).strip()
                        except:
                            metadata = {}
                            body = content
                    else:
                        metadata = {}
                        body = content
                    
                    memory_id = metadata.get('id', file.replace('.md', ''))
                    category = metadata.get('category', os.path.basename(root))
                    tags = ','.join(metadata.get('tags', [])) if isinstance(metadata.get('tags'), list) else (metadata.get('tags') or '')
                    
                    qmd_entities[memory_id] = MemoryEntity(
                        memory_id=memory_id,
                        path=file_path,
                        category=category,
                        content=body,
                        tags=tags,
                        checksum=self._compute_checksum(body),
                        last_modified=metadata.get('last_accessed', datetime.now().isoformat()),
                        status=SyncStatus.UNKNOWN
                    )
                    
                except Exception as e:
                    # 檔案損壞
                    qmd_entities[file] = MemoryEntity(
                        memory_id=file.replace('.md', ''),
                        path=file_path,
                        category='unknown',
                        content='',
                        tags='',
                        checksum='',
                        last_modified=datetime.now().isoformat(),
                        status=SyncStatus.CORRUPTED
                    )
        
        return qmd_entities

    def scan_lcm(self) -> Dict[str, MemoryEntity]:
        """
        掃描 LCM (memory_vector_index.db)，建立記憶列表
        
        Returns: Dict of memory_id -> MemoryEntity
        """
        lcm_entities = {}
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT id, path, category, content, tags, summary, priority, last_accessed
                FROM memory_blocks
            ''')
            
            for row in cursor.fetchall():
                memory_id, path, category, content, tags, summary, priority, last_accessed = row
                content = content or ''
                tags = tags or ''
                
                lcm_entities[memory_id] = MemoryEntity(
                    memory_id=memory_id,
                    path=path,
                    category=category or 'unknown',
                    content=content,
                    tags=tags,
                    checksum=self._compute_checksum(content),
                    last_modified=last_accessed or datetime.now().isoformat(),
                    status=SyncStatus.UNKNOWN
                )
                
        except Exception as e:
            print(f"[Sync] Error scanning LCM: {e}")
        finally:
            conn.close()
        
        return lcm_entities

    def compare_layers(self, qmd_entities: Dict[str, MemoryEntity],
                       lcm_entities: Dict[str, MemoryEntity]) -> SyncReport:
        """
        比較 QMD 和 LCM 兩層，生成同步報告
        """
        report = SyncReport(timestamp=datetime.now().isoformat())
        
        qmd_ids = set(qmd_entities.keys())
        lcm_ids = set(lcm_entities.keys())
        
        report.total_qmd = len(qmd_ids)
        report.total_lcm = len(lcm_ids)
        
        # 完全同步的記憶
        in_sync_ids = qmd_ids & lcm_ids
        report.in_sync = len(in_sync_ids)
        
        # 只在 QMD 中存在
        qmd_only_ids = qmd_ids - lcm_ids
        report.qmd_only = len(qmd_only_ids)
        
        # 只在 LCM 中存在
        lcm_only_ids = lcm_ids - qmd_ids
        report.lcm_only = len(lcm_only_ids)
        
        # 設置狀態
        for memory_id in in_sync_ids:
            qmd = qmd_entities[memory_id]
            lcm = lcm_entities[memory_id]
            
            # 檢查內容是否一致
            if qmd.checksum == lcm.checksum:
                qmd.status = SyncStatus.IN_SYNC
                lcm.status = SyncStatus.IN_SYNC
            else:
                # 內容不一致，可能是衝突
                qmd.status = SyncStatus.CONFLICT
                lcm.status = SyncStatus.CONFLICT
                report.conflicts += 1
                report.errors.append(f"Content conflict in {memory_id}: QMD vs LCM differ")
        
        # QMD 只存在 → 可能是孤兒檔案
        for memory_id in qmd_only_ids:
            entity = qmd_entities[memory_id]
            if entity.status == SyncStatus.CORRUPTED:
                report.corrupted += 1
            else:
                entity.status = SyncStatus.ORPHAN
                report.orphans += 1
        
        # LCM 只存在 → 可能是幽靈記憶
        for memory_id in lcm_only_ids:
            entity = lcm_entities[memory_id]
            
            # 檢查檔案是否真的不存在
            if entity.path and os.path.exists(entity.path):
                # 路徑存在但 ID 不匹配，可能是檔案被移動過
                entity.status = SyncStatus.LCM_ONLY
            else:
                # 真正的幽靈記憶
                entity.status = SyncStatus.GHOST
                report.ghosts += 1
                report.errors.append(f"Ghost memory: {memory_id} in DB but file missing")
        
        return report

    def check_file_integrity(self, entity: MemoryEntity) -> bool:
        """檢查檔案完整性"""
        if not entity.path or not os.path.exists(entity.path):
            return False
        
        try:
            with open(entity.path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
            if match:
                body = match.group(2).strip()
            else:
                body = content
            
            return self._compute_checksum(body) == entity.checksum
        except:
            return False

    def auto_fix(self, report: SyncReport, qmd_entities: Dict[str, MemoryEntity],
                 lcm_entities: Dict[str, MemoryEntity]) -> SyncReport:
        """
        自動修復可以修復的問題
        
        修復策略：
        1. 孤兒檔案 (QMD only) → 加入 LCM
        2. LCM only (檔案存在但ID不匹配) → 更新 LCM ID
        3. 小衝突 → 報告而不是自動修復
        """
        
        # 1. 處理孤兒檔案 - 索引到 LCM
        for memory_id, entity in qmd_entities.items():
            if entity.status == SyncStatus.ORPHAN:
                try:
                    conn = self._get_connection()
                    cursor = conn.cursor()
                    
                    cursor.execute('''
                        INSERT OR REPLACE INTO memory_blocks
                        (id, path, category, content, tags, summary, priority, last_accessed)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        entity.memory_id,
                        entity.path,
                        entity.category,
                        entity.content,
                        entity.tags,
                        '',
                        'medium',
                        entity.last_modified
                    ))
                    
                    conn.commit()
                    conn.close()
                    
                    report.actions_taken.append(f"Indexed orphan file: {entity.memory_id}")
                    entity.status = SyncStatus.IN_SYNC
                    
                except Exception as e:
                    report.errors.append(f"Failed to index {entity.memory_id}: {e}")
        
        # 2. 處理幽靈記憶 - 警告用戶
        for memory_id, entity in lcm_entities.items():
            if entity.status == SyncStatus.GHOST:
                # 不自動刪除，但報告
                report.errors.append(f"Ghost memory requires attention: {memory_id}")
        
        # 3. 衝突不自動修復，需要人工判斷
        if report.conflicts > 0:
            report.errors.append(f"{report.conflicts} conflicts require manual resolution")
        
        return report

    def run_sync_check(self, auto_fix: bool = False) -> SyncReport:
        """
        執行完整的同步檢查
        
        Args:
            auto_fix: 是否自動修復小問題
        """
        print(f"[{datetime.now().isoformat()}] Starting memory sync check...")
        
        # 1. 掃描兩層
        print("[1/4] Scanning QMD layer...")
        qmd_entities = self.scan_qmd()
        print(f"  Found {len(qmd_entities)} QMD files")
        
        print("[2/4] Scanning LCM layer...")
        lcm_entities = self.scan_lcm()
        print(f"  Found {len(lcm_entities)} LCM entries")
        
        # 2. 比較
        print("[3/4] Comparing layers...")
        report = self.compare_layers(qmd_entities, lcm_entities)
        
        # 3. 自動修復
        if auto_fix:
            print("[4/4] Auto-fixing issues...")
            report = self.auto_fix(report, qmd_entities, lcm_entities)
        else:
            print("[4/4] Skipping auto-fix (dry-run mode)")
        
        # 4. 記錄狀態
        self._save_sync_state(report)
        self._log_report(report)
        
        # 5. 打印摘要
        self._print_report(report)
        
        return report

    def _save_sync_state(self, report: SyncReport):
        """保存同步狀態"""
        state = {
            'last_sync': report.timestamp,
            'in_sync': report.in_sync,
            'ghosts': report.ghosts,
            'orphans': report.orphans,
            'conflicts': report.conflicts
        }
        
        with open(SYNC_STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=2, ensure_ascii=False)

    def _log_report(self, report: SyncReport):
        """寫入同步日誌"""
        os.makedirs(os.path.dirname(SYNC_LOG_PATH), exist_ok=True)
        
        with open(SYNC_LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(f"\n=== Sync Report: {report.timestamp} ===\n")
            f.write(f"QMD: {report.total_qmd} | LCM: {report.total_lcm}\n")
            f.write(f"In Sync: {report.in_sync}\n")
            f.write(f"Ghosts: {report.ghosts} | Orphans: {report.orphans}\n")
            f.write(f"Corrupted: {report.corrupted} | Conflicts: {report.conflicts}\n")
            
            if report.errors:
                f.write("\nErrors:\n")
                for err in report.errors:
                    f.write(f"  - {err}\n")
            
            if report.actions_taken:
                f.write("\nActions:\n")
                for action in report.actions_taken:
                    f.write(f"  + {action}\n")

    def _print_report(self, report: SyncReport):
        """打印同步報告"""
        print(f"\n=== Sync Report: {report.timestamp} ===")
        print(f"QMD: {report.total_qmd} | LCM: {report.total_lcm} | In Sync: {report.in_sync}")
        
        issues = report.ghosts + report.orphans + report.corrupted + report.conflicts
        if issues == 0:
            print("[OK] All layers in sync!")
        else:
            print(f"[!] Found {issues} issues:")
            if report.ghosts:
                print(f"    - Ghost memories: {report.ghosts}")
            if report.orphans:
                print(f"    - Orphan files: {report.orphans}")
            if report.corrupted:
                print(f"    - Corrupted files: {report.corrupted}")
            if report.conflicts:
                print(f"    - Conflicts: {report.conflicts}")
        
        if report.errors:
            print("\nErrors:")
            for err in report.errors[:5]:  # 只顯示前5個
                print(f"  ! {err}")
        
        if report.actions_taken:
            print("\nActions Taken:")
            for action in report.actions_taken[:5]:
                print(f"  + {action}")

    def get_sync_heartbeat(self) -> bool:
        """
        檢查是否需要執行同步心跳 (每24小時)
        
        Returns: True if sync should run
        """
        if not os.path.exists(SYNC_STATE_FILE):
            return True
        
        try:
            with open(SYNC_STATE_FILE, 'r', encoding='utf-8') as f:
                state = json.load(f)
            
            last_sync = datetime.fromisoformat(state.get('last_sync', '2000-01-01'))
            hours_since = (datetime.now() - last_sync).total_seconds() / 3600
            
            return hours_since >= 24
        except:
            return True

    def sync_notebooklm(self) -> Tuple[bool, str]:
        """
        同步到 NotebookLM (如果配置了)
        
        這是一個可選功能，需要 NotebookLM API
        目前是佔位實現
        
        Returns: (success, message)
        """
        # 檢查是否有 NotebookLM 配置
        notebooklm_config = os.path.join(WORKSPACE_DIR, "config", "notebooklm.json")
        
        if not os.path.exists(notebooklm_config):
            return False, "NotebookLM not configured"
        
        try:
            with open(notebooklm_config, 'r', encoding='utf-8') as f:
                config = json.load(f)
            
            api_key = config.get('api_key')
            notebook_id = config.get('notebook_id')
            
            if not api_key or not notebook_id:
                return False, "NotebookLM config incomplete"
            
            # TODO: 實現實際的 NotebookLM API 調用
            # 這需要實現：
            # 1. 認證
            # 2. 獲取現有內容
            # 3. 上傳/更新記憶
            # 4. 處理同步衝突
            
            return True, "NotebookLM sync would run here (API not implemented)"
            
        except Exception as e:
            return False, f"NotebookLM sync error: {e}"

    def generate_detailed_report(self, qmd_entities: Dict[str, MemoryEntity],
                                  lcm_entities: Dict[str, MemoryEntity]) -> str:
        """生成詳細的同步報告"""
        lines = [f"=== Detailed Memory Sync Report ==="]
        lines.append(f"Generated: {datetime.now().isoformat()}\n")
        
        lines.append(f"## Summary")
        lines.append(f"- QMD files: {len(qmd_entities)}")
        lines.append(f"- LCM entries: {len(lcm_entities)}")
        
        # 按狀態分組
        by_status = {}
        for entity in qmd_entities.values():
            status = entity.status.value
            if status not in by_status:
                by_status[status] = []
            by_status[status].append(entity)
        
        for entity in lcm_entities.values():
            status = entity.status.value
            if status not in by_status:
                by_status[status] = []
            by_status[status].append(entity)
        
        lines.append(f"\n## By Status")
        for status, entities in sorted(by_status.items()):
            lines.append(f"- {status}: {len(entities)}")
        
        # 詳細問題列表
        issues = []
        for entity in qmd_entities.values():
            if entity.status != SyncStatus.IN_SYNC:
                issues.append(f"QMD [{entity.memory_id}] {entity.status.value}")
        
        for entity in lcm_entities.values():
            if entity.status != SyncStatus.IN_SYNC:
                issues.append(f"LCM [{entity.memory_id}] {entity.status.value}")
        
        if issues:
            lines.append(f"\n## Issues ({len(issues)})")
            for issue in issues[:50]:  # 限制輸出
                lines.append(f"- {issue}")
        
        return "\n".join(lines)


def create_cron_script() -> str:
    """生成 crontab/計劃任務腳本"""
    
    if os.name == 'nt':  # Windows
        return '''# Memory Sync Heartbeat - Windows Task Scheduler
# Run every 24 hours
schtasks /create /tn "Yua Memory Sync" /tr "python sync_monitor.py --check --fix" /sc daily /st 02:00
'''
    else:  # Unix/Linux
        return '''# Memory Sync Heartbeat - Cron
# Run every 24 hours at 2 AM
0 2 * * * cd /path/to/workspace && python sync_monitor.py --check --fix >> logs/sync_cron.log 2>&1
'''


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Memory Sync Monitor - Three-tier Data Sync')
    parser.add_argument('--check', action='store_true', help='Run sync check')
    parser.add_argument('--fix', action='store_true', help='Auto-fix issues')
    parser.add_argument('--report', action='store_true', help='Generate detailed report')
    parser.add_argument('--heartbeat', action='store_true', help='Check if heartbeat needed')
    parser.add_argument('--notebooklm', action='store_true', help='Sync to NotebookLM')
    
    args = parser.parse_args()
    
    monitor = MemorySyncMonitor()
    
    if args.heartbeat:
        needed = monitor.get_sync_heartbeat()
        print(f"Sync heartbeat needed: {needed}")
    
    elif args.check:
        report = monitor.run_sync_check(auto_fix=args.fix)
        exit(0 if (report.ghosts + report.orphans + report.conflicts + report.corrupted) == 0 else 1)
    
    elif args.report:
        qmd = monitor.scan_qmd()
        lcm = monitor.scan_lcm()
        print(monitor.generate_detailed_report(qmd, lcm))
    
    elif args.notebooklm:
        success, msg = monitor.sync_notebooklm()
        print(f"NotebookLM sync: {msg}")
    
    else:
        print("Memory Sync Monitor - Three-tier Data Sync")
        print("\nUsage:")
        print("  --check     Run sync check")
        print("  --fix       Auto-fix issues after check")
        print("  --report    Generate detailed report")
        print("  --heartbeat Check if sync heartbeat is needed")
        print("  --notebooklm Sync to NotebookLM")
