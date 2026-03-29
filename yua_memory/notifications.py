# notifications.py
# Telegram 通知組件 - 負責 Yua Memory 維護系統的 Telegram 通知

import logging

# 嘗試導入 requests 庫
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    logging.warning("requests library not found. Telegram notifications disabled. Install with: pip install requests")

from .path_manager import PathManager


class TelegramNotifier:
    """
    Telegram 通知器
    
    功能：
    - 任務開始/成功/失敗時發送 Telegram 通知
    - 支援 Markdown 格式訊息
    - 失敗時自動靜默處理（不影響主流程）
    """
    
    def __init__(self, config: dict):
        """初始化通知器"""
        self.pm = PathManager()
        
        # 檢查通知功能是否啟用
        notifications_config = config.get('notifications', {})
        self.enabled = notifications_config.get('enabled', False)
        
        if not self.enabled:
            self.telegram_config = None
            self.token = None
            self.chat_id = None
            return
        
        # 讀取 Telegram 設定
        self.telegram_config = notifications_config.get('telegram', {})
        self.token = self.telegram_config.get('token')
        self.chat_id = self.telegram_config.get('chat_id')
        
        # 通知偏好設定
        self.notify_on_success = self.telegram_config.get('notify_on_success', True)
        self.notify_on_failure = self.telegram_config.get('notify_on_failure', True)
        
        # API URL
        self.api_url = f"https://api.telegram.org/bot{self.token}/sendMessage" if self.token else None
        
        logging.info(f"TelegramNotifier initialized (enabled={self.enabled})")
    
    def send_message(self, text: str) -> bool:
        """
        發送 Telegram 訊息
        
        Args:
            text: 訊息內容（支援 Markdown）
            
        Returns:
            bool: 是否發送成功
        """
        if not self.enabled or not self.token or not self.chat_id:
            return False
        
        if not REQUESTS_AVAILABLE:
            logging.warning("Telegram notification skipped: requests library not available")
            return False
        
        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "Markdown"
        }
        
        try:
            response = requests.post(self.api_url, json=payload, timeout=10)
            response.raise_for_status()
            logging.info(f"Telegram notification sent successfully")
            return True
        except requests.exceptions.Timeout:
            logging.error("Failed to send Telegram notification: Connection timeout")
        except requests.exceptions.HTTPError as e:
            logging.error(f"Failed to send Telegram notification: HTTP error {e.response.status_code}")
        except requests.exceptions.RequestException as e:
            logging.error(f"Failed to send Telegram notification: {e}")
        
        return False
    
    def notify_maintenance_start(self, task_name: str):
        """通知任務開始"""
        if not self.enabled:
            return
        
        message = (
            f"🚀 *Yua Memory 維護啟動*\n"
            f"━━━━━━━━━━━━━━━\n"
            f"📋 任務：`{task_name}`\n"
            f"🕐 時間：{self._now()}\n"
            f"━━━━━━━━━━━━━━━"
        )
        self.send_message(message)
    
    def notify_maintenance_success(self, task_name: str, summary: str):
        """通知任務成功"""
        if not self.enabled or not self.notify_on_success:
            return
        
        message = (
            f"✅ *Yua Memory 維護成功*\n"
            f"━━━━━━━━━━━━━━━\n"
            f"📋 任務：`{task_name}`\n"
            f"📊 摘要：{summary}\n"
            f"🕐 時間：{self._now()}\n"
            f"━━━━━━━━━━━━━━━"
        )
        self.send_message(message)
    
    def notify_maintenance_failure(self, task_name: str, error_msg: str):
        """通知任務失敗"""
        if not self.enabled or not self.notify_on_failure:
            return
        
        message = (
            f"❌ *Yua Memory 維護失敗*\n"
            f"━━━━━━━━━━━━━━━\n"
            f"📋 任務：`{task_name}`\n"
            f"⚠️ 錯誤：\n`{error_msg[:200]}`\n"
            f"🕐 時間：{self._now()}\n"
            f"━━━━━━━━━━━━━━━\n"
            f"⚠️ 請盡快檢查系統日誌！"
        )
        self.send_message(message)
    
    def _now(self) -> str:
        """取得現在時間字串"""
        import datetime
        return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
