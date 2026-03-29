# path_manager.py
# 統一路徑管理 - 解決所有模組的硬編碼路徑問題
# 使用方式: pm = PathManager(); db_path = pm.db()

import os
from pathlib import Path
from threading import Lock

class PathManager:
    """
    執行緒安全的單例模式 PathManager
    
    優先從環境變數讀取 workspace 路徑，若無則使用預設路徑。
    提供流暢的 pathlib 介面。
    """
    _instance = None
    _lock = Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(PathManager, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        
        # 優先從環境變數讀取，若無則使用預設路徑
        default_ws = Path.home() / ".openclaw" / "workspace"
        ws_env = os.getenv("OPENCLAW_WORKSPACE", str(default_ws))
        self._workspace = Path(ws_env)
        self._initialized = True
        
        # 確保基礎目錄存在
        self._ensure_dirs()

    def _ensure_dirs(self):
        """確保基礎目錄存在"""
        self.qmd().mkdir(parents=True, exist_ok=True)
        self.archive().mkdir(parents=True, exist_ok=True)
        self.logs().mkdir(parents=True, exist_ok=True)
        self.config().mkdir(parents=True, exist_ok=True)
        self.memory().mkdir(parents=True, exist_ok=True)

    # === 路徑屬性 ===
    
    def workspace(self) -> Path:
        """工作區根目錄"""
        return self._workspace

    def qmd(self) -> Path:
        """QMD 文件目錄"""
        return self._workspace / "qmd"

    def archive(self) -> Path:
        """歸檔目錄"""
        return self.qmd() / "archive"

    def config(self) -> Path:
        """配置目錄"""
        return self._workspace / "config"

    def logs(self) -> Path:
        """日誌目錄"""
        return self._workspace / "logs"

    def memory(self) -> Path:
        """記憶數據目錄"""
        return self._workspace / "memory"

    # === 路徑字串（向後相容） ===
    
    def db(self) -> str:
        """記憶向量索引資料庫路徑"""
        return str(self.config() / "memory_vector_index.db")

    def soul_state(self) -> str:
        """靈魂狀態檔案路徑"""
        return str(self.memory() / "soul_state.json")

    def sync_state(self) -> str:
        """同步狀態檔案路徑"""
        return str(self.memory() / "sync_state.json")

    def archive_meta(self) -> str:
        """歸檔元數據目錄路徑"""
        return str(self.archive() / "_archive_meta")

    def archive_index_db(self) -> str:
        """歸檔索引資料庫路徑"""
        return str(self.archive_meta() / "archive_index.db")

    def conflict_log(self) -> str:
        """衝突日誌檔案路徑"""
        return str(self.logs() / "memory_conflicts.json")

    def sync_report_log(self) -> str:
        """同步報告日誌檔案路徑"""
        return str(self.logs() / "sync_report.log")


# 工廠函數（簡化調用）
def get_path_manager() -> PathManager:
    """取得 PathManager 單例"""
    return PathManager()


# 使用範例
if __name__ == "__main__":
    pm = PathManager()
    print(f"Workspace: {pm.workspace()}")
    print(f"DB: {pm.db()}")
    print(f"QMD: {pm.qmd()}")
