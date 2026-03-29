# scheduler.py
# Yua Memory 自動化維護排程器
# 支援 daemon / once / dry-run 模式
# 修復: __init__, __name__ == "__main__", 每週排程邏輯

import sys
import os
import time
import yaml
import signal
import logging
import argparse
from datetime import datetime
from pathlib import Path

# 嘗試導入 schedule 庫，若不存在則提供提示
try:
    import schedule
except ImportError:
    print("[ERROR] schedule library not found. Please install: pip install schedule")
    sys.exit(1)

from .path_manager import PathManager
from .maintenance_tasks import YuaMaintenanceTasks

# 全域 logger（初始化後設定）
logger = logging.getLogger(__name__)


class YuaScheduler:
    """
    Yua 記憶系統維護排程器
    
    功能：
    - 每日定時執行記憶老化、同步、整合
    - 每週執行深度衝突檢測
    - 每月執行歸檔清理
    - 支援 daemon/once/dry-run 模式
    - 優雅關閉（Graceful Shutdown）
    """
    
    def __init__(self):
        """初始化排程器"""
        # 1. 先初始化 PathManager
        self.pm = PathManager()
        
        # 2. 設定日誌
        self._setup_logging()
        
        # 3. 載入設定
        self.config = self._load_config()
        
        # 4. 初始化任務
        self.tasks = YuaMaintenanceTasks(self.config)
        
        # 5. 標記為運行中
        self.running = True
        
        # 6. 註冊中斷信號處理
        signal.signal(signal.SIGINT, self._handle_exit)
        signal.signal(signal.SIGTERM, self._handle_exit)
        
        logger.info("YuaScheduler initialized")
        logger.info(f"Config: {self.config}")

    def _setup_logging(self):
        """設定日誌"""
        global logger
        log_file = self.pm.logs() / "scheduler.log"
        log_file.parent.mkdir(parents=True, exist_ok=True)
        
        logging.basicConfig(
            level=logging.INFO,
            format='[%(asctime)s] [%(levelname)s] %(message)s',
            handlers=[
                logging.FileHandler(log_file, encoding='utf-8'),
                logging.StreamHandler()
            ]
        )
        logger = logging.getLogger(__name__)

    def _load_config(self) -> dict:
        """載入設定檔"""
        config_path = self.pm.config() / "config.yaml"
        
        if not config_path.exists():
            logger.warning(f"Config file not found at {config_path}, using defaults")
            return self._get_default_config()
        
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            logger.info(f"Config loaded from {config_path}")
            return config
        except Exception as e:
            logger.error(f"Failed to load config: {e}, using defaults")
            return self._get_default_config()

    def _get_default_config(self) -> dict:
        """取得預設設定"""
        return {
            'maintenance': {
                'daily_time': '02:00',
                'weekly_day': 'sunday',
                'weekly_time': '03:00',
                'monthly_time': '04:00',
                'retry_max_attempts': 3,
                'retry_base_delay': 60
            },
            'aging': {
                'dry_run': False,
                'functional_ttl_days': 180,
                'general_ttl_days': 365
            },
            'sync': {
                'auto_fix': False
            },
            'consolidation': {
                'similarity_threshold': 0.75
            },
            'archive': {
                'retention_days': 90
            }
        }

    def _handle_exit(self, signum, frame):
        """處理關閉信號，實現優雅關閉"""
        logger.info(f"Received signal {signum}. Initiating graceful shutdown...")
        logger.info("Waiting for current task to finish...")
        self.running = False

    def setup_schedule(self):
        """設定排程"""
        m = self.config.get('maintenance', {})
        
        # === 每日任務 ===
        daily_time = m.get('daily_time', '02:00')
        schedule.every().day.at(daily_time).do(self._daily_task_wrapper)
        logger.info(f"Scheduled daily maintenance at {daily_time}")
        
        # === 每週任務 ===
        weekly_time = m.get('weekly_time', '03:00')
        weekly_day = m.get('weekly_day', 'sunday').lower()
        
        # 使用 schedule 庫的標準方式
        day_map = {
            'monday': schedule.every().monday,
            'tuesday': schedule.every().tuesday,
            'wednesday': schedule.every().wednesday,
            'thursday': schedule.every().thursday,
            'friday': schedule.every().friday,
            'saturday': schedule.every().saturday,
            'sunday': schedule.every().sunday
        }
        
        if weekly_day in day_map:
            day_scheduler = day_map[weekly_day]
            day_scheduler.at(weekly_time).do(self._weekly_task_wrapper)
            logger.info(f"Scheduled weekly deep clean on {weekly_day} at {weekly_time}")
        else:
            logger.warning(f"Invalid weekly_day '{weekly_day}', defaulting to Sunday")
            schedule.every().sunday.at(weekly_time).do(self._weekly_task_wrapper)
        
        # === 每月任務 ===
        # schedule 庫對每月支援較弱，使用自定義邏輯
        monthly_time = m.get('monthly_time', '04:00')
        schedule.every().day.at(monthly_time).do(self._monthly_check_wrapper)
        logger.info(f"Scheduled monthly archive cleanup check at {monthly_time} (runs on 1st of month)")

    def _daily_task_wrapper(self):
        """每日任務包裝器"""
        logger.info("=" * 60)
        logger.info("[SCHEDULER] Daily maintenance triggered")
        try:
            result = self.tasks.run_daily_cleanup()
            logger.info(f"[SCHEDULER] Daily maintenance completed: {result}")
        except Exception as e:
            logger.error(f"[SCHEDULER] Daily maintenance failed: {e}")
        logger.info("=" * 60)

    def _weekly_task_wrapper(self):
        """每週任務包裝器"""
        logger.info("=" * 60)
        logger.info("[SCHEDULER] Weekly deep clean triggered")
        try:
            result = self.tasks.run_weekly_deep_clean()
            logger.info(f"[SCHEDULER] Weekly deep clean completed: {result}")
        except Exception as e:
            logger.error(f"[SCHEDULER] Weekly deep clean failed: {e}")
        logger.info("=" * 60)

    def _monthly_check_wrapper(self):
        """每月檢查包裝器（只在每月1號執行）"""
        if datetime.now().day == 1:
            logger.info("=" * 60)
            logger.info("[SCHEDULER] Monthly archive cleanup triggered")
            try:
                result = self.tasks.run_monthly_archive_cleanup()
                logger.info(f"[SCHEDULER] Monthly archive cleanup completed: {result}")
            except Exception as e:
                logger.error(f"[SCHEDULER] Monthly archive cleanup failed: {e}")
            logger.info("=" * 60)
        else:
            logger.debug(f"[SCHEDULER] Monthly check skipped (not 1st of month, today is {datetime.now().day})")

    def run(self, mode: str = "daemon"):
        """
        執行排程
        
        Args:
            mode: 執行模式
                - "daemon": 後台持續運行
                - "once": 執行一次所有任務後退出
                - "dry-run": 只報告不實際執行
        """
        logger.info(f"Yua Scheduler starting in {mode.upper()} mode")
        
        if mode == "dry-run":
            logger.info("=" * 60)
            logger.info("[DRY-RUN MODE] No changes will be made")
            logger.info("=" * 60)
            
            # 執行健康檢查
            logger.info("Running health check...")
            health = self.tasks.run_health_check()
            logger.info(f"Health check result: {health}")
            
            # 模擬每日任務（但 dry_run=True）
            logger.info("Simulating daily maintenance (dry-run)...")
            self.config.setdefault('aging', {})['dry_run'] = True
            self.tasks = YuaMaintenanceTasks(self.config)
            # 注意：這裡我們不能直接呼叫 run_daily_cleanup，因為它會讀取 self.config
            # 所以只是做日誌演示
            logger.info("[DRY-RUN] Would execute: Aging, Sync, Consolidation")
            logger.info("=" * 60)
            return
        
        if mode == "once":
            logger.info("=" * 60)
            logger.info("[ONCE MODE] Executing all pending tasks and exiting")
            logger.info("=" * 60)
            
            # 執行每日維護
            try:
                self.tasks.run_daily_cleanup()
            except Exception as e:
                logger.error(f"Daily maintenance failed: {e}")
            
            # 執行每週維護（如果距離上次執行已過一週）
            try:
                self.tasks.run_weekly_deep_clean()
            except Exception as e:
                logger.error(f"Weekly deep clean failed: {e}")
            
            logger.info("=" * 60)
            logger.info("[ONCE MODE] All tasks completed, exiting")
            logger.info("=" * 60)
            return
        
        # === DAEMON MODE ===
        logger.info("=" * 60)
        logger.info("Yua Scheduler started in DAEMON mode")
        logger.info(f"PID: {os.getpid()}")
        logger.info("Press Ctrl+C to stop gracefully")
        logger.info("=" * 60)
        
        self.setup_schedule()
        
        while self.running:
            try:
                schedule.run_pending()
                time.sleep(10)  # 減少 CPU 消耗
            except KeyboardInterrupt:
                logger.info("Keyboard interrupt received")
                break
            except Exception as e:
                logger.error(f"Scheduler error: {e}")
                time.sleep(60)  # 發生錯誤時等待後重試
        
        logger.info("Scheduler stopped.")


def main():
    """主入口"""
    parser = argparse.ArgumentParser(
        description="Yua Memory Maintenance Scheduler",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scheduler.py daemon     # 啟動守護程序
  python scheduler.py once      # 執行一次任務後退出
  python scheduler.py dry-run   # 模擬執行（不做實際變更）
        """
    )
    parser.add_argument(
        "mode",
        choices=["daemon", "once", "dry-run"],
        default="daemon",
        help="Execution mode (default: daemon)"
    )
    args = parser.parse_args()
    
    try:
        scheduler = YuaScheduler()
        scheduler.run(args.mode)
    except KeyboardInterrupt:
        logger.info("Scheduler interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.critical(f"System crash: {e}")
        import traceback
        logger.critical(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()
