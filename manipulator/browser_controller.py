import logging
import subprocess
import time
from screen_manager import ScreenManager

logger = logging.getLogger(__name__)

class BrowserController:
    """
    Управление браузером (открытие, перемещение на второй монитор)
    По умолчанию использует Яндекс.Браузер, fallback на Safari
    """
    
    def __init__(self, browser: str = "Yandex"):
        """
        Args:
            browser: Имя браузера ("Yandex", "Safari", "Chrome")
        """
        self.screen_manager = ScreenManager()
        self.browser = browser
        self.browser_app_name = {
            "Yandex": "Yandex",
            "Safari": "Safari", 
            "Chrome": "Google Chrome"
        }.get(browser, "Yandex")
        
        logger.info(f"🌐 Браузер по умолчанию: {self.browser_app_name}")
    
    def _is_browser_running(self) -> bool:
        """Проверяет, запущен ли браузер"""
        check_script = f'tell application "System Events" to (name of processes) contains "{self.browser_app_name}"'
        result = subprocess.run(['osascript', '-e', check_script], capture_output=True, text=True)
        return 'true' in result.stdout.lower()
    
    async def open_on_secondary_monitor(self):
        """
        Открывает браузер на втором мониторе
        ВСЕГДА создаёт НОВОЕ окно, не закрывая существующие
        """
        logger.info(f"🌐 Открываю {self.browser_app_name}...")
        
        # Получаем координаты второго монитора
        display = self.screen_manager.get_secondary_monitor()
        
        # Проверяем, запущен ли браузер
        browser_running = self._is_browser_running()
        
        if not browser_running:
            logger.info(f"Запускаю {self.browser_app_name}...")
            subprocess.Popen(['open', '-a', self.browser_app_name])
            time.sleep(3)
        else:
            logger.info(f"{self.browser_app_name} уже запущен")
        
        # ОБЯЗАТЕЛЬНО создаём НОВОЕ окно (не трогаем существующие)
        if self.browser == "Yandex":
            apple_script = f'''
            tell application "{self.browser_app_name}"
                activate
                -- Создаём новое окно с пустой вкладкой
                make new window
                delay 1
                -- Перемещаем на второй монитор
                set bounds of front window to {{{display['x']}, {display['y']}, {display['x'] + display['width']}, {display['y'] + display['height']}}}
            end tell
            '''
        else:  # Safari, Chrome
            apple_script = f'''
            tell application "{self.browser_app_name}"
                activate
                make new document
                delay 1
                set bounds of front window to {{{display['x']}, {display['y']}, {display['x'] + display['width']}, {display['y'] + display['height']}}}
            end tell
            '''
        
        try:
            subprocess.run(['osascript', '-e', apple_script], check=True, timeout=10)
            logger.info(f"✅ {self.browser_app_name} перемещен на второй монитор (новое окно)")
        except subprocess.TimeoutExpired:
            logger.warning(f"⚠️ {self.browser_app_name} открыт, но таймаут при перемещении окна")
        except Exception as e:
            logger.error(f"Ошибка перемещения окна: {e}")
    
    async def navigate_to(self, url: str):
        """
        Переходит по URL в активном окне браузера
        """
        logger.info(f"🔗 Навигация: {url}")
        
        if self.browser == "Yandex":
            # Яндекс поддерживает set URL
            apple_script = f'''
            tell application "{self.browser_app_name}"
                activate
                set URL of active tab of front window to "{url}"
            end tell
            '''
        else:  # Safari, Chrome
            apple_script = f'''
            tell application "{self.browser_app_name}"
                activate
                set URL of document 1 to "{url}"
            end tell
            '''
        
        try:
            subprocess.run(['osascript', '-e', apple_script], check=True, timeout=5)
            logger.info(f"✅ Переход на {url}")
        except Exception as e:
            logger.error(f"Ошибка навигации: {e}")
        
        time.sleep(2)
