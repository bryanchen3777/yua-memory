# maintenance_tasks.py
# Yua Memory 維護任務集合
# 修復: __init__, os import, 2**attempt, func.__name__

import os
import time
import logging
import functools
from datetime import datetime, timedelta
from .path_manager import PathManager

# 導入各個維護模組
from .aging_v2 import SQLMemoryAging
from .sync_monitor import MemorySyncMonitor
from .consolidation import MemoryConsolidator
from .circuit_breaker_v2 import OptimizedCircuitBreaker
from .notifications import TelegramNotifier

# 設定日誌
pm = PathManager()
log_file = pm.logs() / "maintenance.log"
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


def retry_on_failure(max_attempts=3, base_delay=60):
    """
    指數退避重試裝飾器
    
    Args:
        max_attempts: 最大重試次數
        base_delay: 基礎延遲秒數，指數退避計算為 base_delay * 2^attempt
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    delay = base_delay * (2 ** attempt)
                    logger.error(
                        f"Task {func.__name__} failed: {e}. "
                        f"Retrying in {delay}s... ({attempt + 1}/{max_attempts})"
                    )
                    if attempt < max_attempts - 1:
                        time.sleep(delay)
                    else:
                        logger.critical(
                            f"Task {func.__name__} failed after {max_attempts} attempts."
                        )
                        raise e
            return None
        return wrapper
    return decorator


class YuaMaintenanceTasks:
    """
    Yua 記憶系統維護任務集合
    
    封裝所有維護操作的調用，提供統一的錯誤處理和日誌介面
    """
    
    def __init__(self, config: dict):
        """
        初始化維護任務
        
        Args:
            config: 從 config.yaml 載入的設定字典
        """
        self.config = config
        self.pm = PathManager()
        self.notifier = TelegramNotifier(config)  # 初始化通知器
        logger.info("YuaMaintenanceTasks initialized")

    @retry_on_failure(max_attempts=3, base_delay=60)
    def run_daily_cleanup(self) -> dict:
        """
        每日維護任務
        
        執行內容：
        1. Aging (記憶老化清理)
        2. Sync (三層同步檢查)
        3. Consolidation (孤立檢測)
        
        Returns:
            dict: 執行結果摘要
        """
        logger.info("=" * 60)
        logger.info("Starting Daily Maintenance Task...")
        start_time = time.time()
        
        results = {
            'aging': None,
            'sync': None,
            'consolidation': None,
            'duration': 0,
            'success': True
        }
        
        # 發送開始通知
        self.notifier.notify_maintenance_start("每日維護 (老化/同步/整合)")
        
        try:
            # === 1. Aging ===
            logger.info("[1/3] Running Aging...")
            aging = SQLMemoryAging()
            aging_result = aging.run_aging_process(
                dry_run=self.config.get('aging', {}).get('dry_run', False)
            )
            results['aging'] = aging_result
            logger.info(f"[Aging] Result: {aging_result}")
            
            # === 2. Sync ===
            logger.info("[2/3] Running Sync Monitor...")
            sync = MemorySyncMonitor()
            sync_report = sync.run_sync_check(
                auto_fix=self.config.get('sync', {}).get('auto_fix', False)
            )
            results['sync'] = sync_report
            
            if hasattr(sync_report, 'conflicts') and sync_report.conflicts > 0:
                logger.warning(f"[Sync] Found {sync_report.conflicts} conflicts in memory layers.")
            else:
                logger.info("[Sync] No conflicts detected.")
            
            # === 3. Consolidation ===
            logger.info("[3/3] Running Consolidation...")
            con = MemoryConsolidator()
            con_result = con.run_consolidation(
                dry_run=self.config.get('aging', {}).get('dry_run', False)
            )
            results['consolidation'] = con_result
            logger.info(f"[Consolidation] Result: {con_result}")
            
        except Exception as e:
            logger.error(f"Daily maintenance error: {e}")
            results['success'] = False
            results['error'] = str(e)
            # 發送失敗通知
            self.notifier.notify_maintenance_failure("每日維護", str(e))
            raise
        
        duration = time.time() - start_time
        results['duration'] = duration
        
        # 生成摘要
        aging_deleted = results['aging'].get('deleted', 0) if results.get('aging') else 0
        sync_in_sync = results['sync'].in_sync if hasattr(results.get('sync'), 'in_sync') else 'N/A'
        con_orphaned = len(results['consolidation'].get('orphaned_entries', [])) if results.get('consolidation') else 0
        
        summary = f"老化清理: {aging_deleted} 筆 | 同步: {sync_in_sync} 筆正常 | 孤立: {con_orphaned} 筆"
        
        logger.info(f"Daily Maintenance completed in {duration:.2f}s")
        logger.info(f"Results: {results}")
        logger.info("=" * 60)
        
        # 發送成功通知
        self.notifier.notify_maintenance_success("每日維護 (老化/同步/整合)", summary)
        
        return results

    @retry_on_failure(max_attempts=3, base_delay=60)
    def run_weekly_deep_clean(self) -> dict:
        """
        每週深度衝突檢測
        
        使用 OptimizedCircuitBreaker 進行全量衝突掃描
        
        Returns:
            dict: 衝突檢測結果
        """
        logger.info("=" * 60)
        logger.info("Starting Weekly Deep Conflict Detection...")
        start_time = time.time()
        
        # 發送開始通知
        self.notifier.notify_maintenance_start("每週深度衝突檢測")
        
        try:
            cb = OptimizedCircuitBreaker()
            threshold = self.config.get('consolidation', {}).get('similarity_threshold', 0.75)
            conflicts = cb.detect_all_conflicts(similarity_threshold=threshold)
            
            result = {
                'success': True,
                'conflicts_found': len(conflicts),
                'duration': time.time() - start_time,
                'threshold': threshold
            }
            
            if conflicts:
                logger.warning(f"Weekly check found {len(conflicts)} potential conflicts:")
                for c in conflicts[:10]:  # 只顯示前10個
                    conflict_info = f"  - [{c.conflict_type.value if hasattr(c.conflict_type, 'value') else c.conflict_type}] {c.resolution_needed}"
                    logger.warning(conflict_info)
                if len(conflicts) > 10:
                    logger.warning(f"  ... and {len(conflicts) - 10} more")
            else:
                logger.info("Weekly check complete. No conflicts found.")
            
            logger.info(f"Weekly Deep Clean completed in {result['duration']:.2f}s")
            logger.info("=" * 60)
            
            # 發送成功通知
            summary = f"發現 {len(conflicts)} 筆潛在衝突"
            self.notifier.notify_maintenance_success("每週深度衝突檢測", summary)
            
            return result
            
        except Exception as e:
            logger.error(f"Weekly deep clean error: {type(e).__name__}: {str(e)}")
            # 發送失敗通知
            self.notifier.notify_maintenance_failure("每週深度衝突檢測", str(e))
            raise

    @retry_on_failure(max_attempts=3, base_delay=60)
    def run_monthly_archive_cleanup(self) -> dict:
        """
        每月歸檔清理
        
        刪除超過保留期限的歸檔檔案
        
        Returns:
            dict: 清理結果
        """
        logger.info("=" * 60)
        logger.info("Starting Monthly Archive Cleanup...")
        start_time = time.time()
        
        # 發送開始通知
        self.notifier.notify_maintenance_start("每月歸檔清理")
        
        try:
            archive_dir = self.pm.archive()
            retention_days = self.config.get('archive', {}).get('retention_days', 90)
            cutoff_date = datetime.now() - timedelta(days=retention_days)
            
            logger.info(f"Archive dir: {archive_dir}")
            logger.info(f"Retention: {retention_days} days (cutoff: {cutoff_date.date()})")
            
            if not archive_dir.exists():
                logger.info("Archive directory does not exist, skipping cleanup")
                return {
                    'success': True,
                    'cleaned_count': 0,
                    'message': 'Archive dir not found'
                }
            
            cleaned_count = 0
            cleaned_size = 0
            
            for root, dirs, files in os.walk(archive_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    try:
                        mtime = os.path.getmtime(file_path)
                        if datetime.fromtimestamp(mtime) < cutoff_date:
                            size = os.path.getsize(file_path)
                            os.remove(file_path)
                            cleaned_count += 1
                            cleaned_size += size
                            logger.debug(f"Removed: {file_path} ({size} bytes)")
                    except Exception as e:
                        logger.warning(f"Failed to remove {file_path}: {e}")
            
            result = {
                'success': True,
                'cleaned_count': cleaned_count,
                'cleaned_size_bytes': cleaned_size,
                'duration': time.time() - start_time
            }
            
            logger.info(
                f"Archive cleanup done. "
                f"Removed {cleaned_count} files "
                f"({cleaned_size / 1024 / 1024:.2f} MB)"
            )
            logger.info(f"Monthly Archive Cleanup completed in {result['duration']:.2f}s")
            logger.info("=" * 60)
            
            # 發送成功通知
            summary = f"清理 {cleaned_count} 個檔案 ({cleaned_size / 1024 / 1024:.2f} MB)"
            self.notifier.notify_maintenance_success("每月歸檔清理", summary)
            
            return result
            
        except Exception as e:
            logger.error(f"Monthly archive cleanup error: {e}")
            # 發送失敗通知
            self.notifier.notify_maintenance_failure("每月歸檔清理", str(e))
            raise

    def run_health_check(self) -> dict:
        """
        健康檢查（不執行任何修改）
        
        Returns:
            dict: 系統健康狀態
        """
        logger.info("Running system health check...")
        
        try:
            aging = SQLMemoryAging()
            stats = aging.get_aging_stats()
            
            return {
                'success': True,
                'memory_stats': stats,
                'config': {
                    'aging_dry_run': self.config.get('aging', {}).get('dry_run', False),
                    'sync_auto_fix': self.config.get('sync', {}).get('auto_fix', False)
                }
            }
        except Exception as e:
            logger.error(f"Health check error: {e}")
            return {
                'success': False,
                'error': str(e)
            }


if __name__ == "__main__":
    # 測試模式
    import yaml
    
    pm = PathManager()
    config_path = pm.config() / "config.yaml"
    
    if config_path.exists():
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
    else:
        logger.warning(f"Config file not found at {config_path}, using defaults")
        config = {}
    
    tasks = YuaMaintenanceTasks(config)
    
    print("\n=== Yua Maintenance Tasks Test ===")
    print("1. Health Check")
    result = tasks.run_health_check()
    print(f"   Result: {result}\n")
    
    print("2. Daily Cleanup (dry-run)")
    # 暫時設定 dry_run = True
    original_dry_run = config.get('aging', {}).get('dry_run', False)
    config.setdefault('aging', {})['dry_run'] = True
    tasks = YuaMaintenanceTasks(config)
    result = tasks.run_daily_cleanup()
    print(f"   Result: {result}\n")
    
    # 恢復原本設定
    config['aging']['dry_run'] = original_dry_run
