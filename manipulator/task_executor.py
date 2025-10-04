import logging
import asyncio
from telegram import Update

from screen_manager import ScreenManager
from browser_controller import BrowserController
import config

logger = logging.getLogger(__name__)

class TaskExecutor:
    """
    Главный оркестратор выполнения задач.
    Координирует работу всех модулей для выполнения команд пользователя.
    
    TODO: Заменить координатные клики на Playwright для браузерных задач
    """
    
    def __init__(self):
        self.screen = ScreenManager(wait_for_user_idle=config.WAIT_FOR_USER_IDLE)
        self.browser = BrowserController(browser=config.DEFAULT_BROWSER)
    
    async def execute(self, task_plan: str, update: Update) -> str:
        """
        Выполняет план задачи пошагово
        
        Args:
            task_plan: План действий от Gemini
            update: Telegram update для отправки промежуточных сообщений
            
        Returns:
            Результат выполнения
        """
        logger.info(f"🎯 Начинаю выполнение плана:\n{task_plan}")
        
        try:
            # Если задача связана с браузером
            if any(word in task_plan.lower() for word in ['браузер', 'youtube', 'найти', 'видео', 'сайт', 'открыть']):
                return await self._execute_browser_task(task_plan, update)
            
            # Другие типы задач можно добавить позже
            return "Базовый тип задачи пока не поддерживается. Работают только задачи с браузером."
            
        except Exception as e:
            logger.error(f"Ошибка выполнения задачи: {e}", exc_info=True)
            raise
    
    async def _execute_browser_task(self, task_plan: str, update: Update) -> str:
        """
        Выполняет задачу, связанную с браузером
        
        TODO: Перевести на Playwright (см. AUTOMATION_RULES.md)
        """
        logger.info("🌐 Выполняю задачу с браузером")
        
        # 1. Открываем браузер на втором мониторе
        await update.message.reply_text("🌐 Открываю браузер на втором мониторе...")
        await self.browser.open_on_secondary_monitor()
        await asyncio.sleep(2)
        
        # 2. Делаем скриншот
        await update.message.reply_text("📸 Делаю скриншот...")
        screenshot_path = self.screen.capture_secondary_monitor()
        
        # ВРЕМЕННАЯ ЗАГЛУШКА: Vision API еще не реализован правильно
        await update.message.reply_text(
            "⚠️ Автоматическое выполнение пока не готово.\n"
            "Нужна миграция на Playwright (см. AUTOMATION_RULES.md)"
        )
        
        return "Браузер открыт, дальнейшие действия требуют доработки"
