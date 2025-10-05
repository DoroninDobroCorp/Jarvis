import logging
import subprocess
import time
import asyncio
import config
from screen_manager import ScreenManager

logger = logging.getLogger(__name__)

class BrowserController:
    """
    Управление браузером (открытие на первом мониторе, второй монитор отключен)
    По умолчанию использует Яндекс.Браузер, fallback на Safari
    """
    
    def __init__(self, browser: str = "Yandex", screen: ScreenManager | None = None):
        """
        Args:
            browser: Имя браузера ("Yandex", "Safari", "Chrome")
            screen: Экземпляр ScreenManager (опционально)
        """
        self.screen_manager = screen or ScreenManager(wait_for_user_idle=config.WAIT_FOR_USER_IDLE)
        self.browser = browser
        self.browser_app_name = {
            "Yandex": "Yandex",
            "Safari": "Safari",
            "Chrome": "Google Chrome"
        }.get(browser, "Yandex")

        logger.info(f"🌐 Браузер по умолчанию: {self.browser_app_name}")
    
    def _is_browser_running(self) -> bool:
        """Проверяет, запущен ли браузер"""
        check_script = f'''
        tell application "System Events"
            set isRunning to exists (process "{self.browser_app_name}")
        end tell
        return isRunning
        '''
        result = subprocess.run(['osascript', '-e', check_script], capture_output=True, text=True)
        return 'true' in (result.stdout or '').lower()
    
    async def open_on_secondary_monitor(self):
        """
        Открывает браузер на первом мониторе (второй монитор отключен)
        
        Работает:
        1. Запускает браузер если не запущен
        2. Создает новое окно
        3. Перемещает окно на первый монитор и растягивает по размеру
        """
        try:
            logger.info(f"🌐 Открываю {self.browser_app_name}...")
            # 1) Запускаем при необходимости
            if not self._is_browser_running():
                logger.info(f"Запускаю {self.browser_app_name}...")
                subprocess.run(['open', '-a', self.browser_app_name])
                await asyncio.sleep(2)
            else:
                logger.info(f"{self.browser_app_name} уже запущен")

            # 2) Получаем первый монитор (второй монитор отключен)
            display = self.screen_manager.get_secondary_monitor()  # Возвращает первый монитор
            is_single_monitor = True  # ЗАКОММЕНТИРОВАНО: len(self.screen_manager.displays) == 1

            # 3) Создаем окно и перемещаем на нужный монитор
            apple_script = f'''
            tell application "{self.browser_app_name}"
                activate
                try
                    make new window
                end try
                delay 1
            end tell
            tell application "System Events"
                tell application process "{self.browser_app_name}"
                    try
                        set position of front window to {{{display['x']}, {display['y']}}}
                        set size of front window to {{{display['width']}, {display['height']}}}
                    end try
                end tell
            end tell
            '''
            subprocess.run(['osascript', '-e', apple_script], check=False, timeout=5)
            await asyncio.sleep(0.5)

            # ЗАКОММЕНТИРОВАНО: логика второго монитора
            # if is_single_monitor:
            #     logger.info(f"✅ {self.browser_app_name} открыт (режим одного монитора)")
            # else:
            #     logger.info(f"✅ {self.browser_app_name} перемещен на второй монитор (новое окно)")
            
            logger.info(f"✅ {self.browser_app_name} открыт на первом мониторе (второй монитор отключен)")
        except subprocess.TimeoutExpired:
            logger.warning(f"⚠️ {self.browser_app_name} открыт, но таймаут при перемещении окна")
        except Exception as e:
            logger.error(f"Ошибка перемещения окна: {e}")

    async def navigate_to(self, url: str):
        """Переходит по URL в активном окне браузера"""
        logger.info(f"🔗 Навигация: {url}")

        if self.browser == "Yandex":
            apple_script = f'''
            tell application "{self.browser_app_name}"
                activate
                try
                    tell front window to set URL of active tab to "{url}"
                on error
                    make new document with properties {{URL:"{url}"}}
                end try
            end tell
            '''
        else:
            apple_script = f'''
            tell application "{self.browser_app_name}"
                activate
                try
                    set URL of document 1 to "{url}"
                on error
                    make new document with properties {{URL:"{url}"}}
                end try
            end tell
            '''

        try:
            subprocess.run(['osascript', '-e', apple_script], check=False, timeout=5)
            logger.info(f"✅ Переход на {url}")
        except Exception as e:
            logger.error(f"Ошибка навигации: {e}")
        await asyncio.sleep(2)
