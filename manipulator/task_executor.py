import logging
import asyncio
from telegram import Update
import yaml

from screen_manager import ScreenManager
from browser_controller import BrowserController
from iterative_planner import IterativePlanner
import config

logger = logging.getLogger(__name__)

# Загружаем список приложений
with open('system_capabilities.yaml', 'r', encoding='utf-8') as f:
    CAPABILITIES = yaml.safe_load(f)

class TaskExecutor:
    """
    Главный оркестратор выполнения задач.
    Использует итеративное планирование с динамической корректировкой
    """
    
    def __init__(self):
        self.screen = ScreenManager(wait_for_user_idle=config.WAIT_FOR_USER_IDLE)
        self.browser = BrowserController(browser=config.DEFAULT_BROWSER, screen=self.screen)
        # Передаем наш ScreenManager в planner чтобы использовать одинаковые настройки
        self.planner = IterativePlanner(api_key=config.GEMINI_API_KEY, screen_manager=self.screen)
    
    def _detect_task_type(self, task_plan: str) -> str:
        """
        Определяет тип задачи по упоминанию приложений из capabilities
        
        Returns:
            'browser' | 'app' | 'unknown'
        """
        task_lower = task_plan.lower()
        
        # Проверяем упоминание браузеров (определяем по названию)
        browser_keywords = ['chrome', 'safari', 'yandex', 'firefox', 'browser', 'tor browser']
        if any(browser in task_lower for browser in browser_keywords):
            return 'browser'
        
        # Проверяем упоминание веб-сайтов/поиска
        if any(word in task_lower for word in ['youtube', 'google', 'сайт', 'найти в интернете', 'поиск в интернете']):
            return 'browser'
        
        # Проверяем упоминание других приложений
        for app in CAPABILITIES['applications']:
            if app.lower() in task_lower:
                logger.info(f"📱 Обнаружено приложение: {app}")
                return 'app'
        
        # По умолчанию - универсальный режим (без открытия браузера)
        logger.info("❓ Тип задачи не определен, использую универсальный режим")
        return 'app'
    
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
            task_type = self._detect_task_type(task_plan)
            
            if task_type == 'browser':
                return await self._execute_browser_task(task_plan, update)
            elif task_type == 'app':
                return await self._execute_app_task(task_plan, update)
            else:
                return await self._execute_app_task(task_plan, update)
            
        except Exception as e:
            logger.error(f"Ошибка выполнения задачи: {e}", exc_info=True)
            raise
    
    async def _execute_browser_task(self, task_plan: str, update: Update) -> str:
        """
        Выполняет задачу с браузером через итеративное планирование
        """
        logger.info("🌐 Выполняю задачу с браузером")
        
        # 1. Открываем браузер на втором мониторе
        await update.message.reply_text("🌐 Открываю браузер...")
        await self.browser.open_on_secondary_monitor()
        await asyncio.sleep(2)
        
        # 2. Создаем начальный план
        await update.message.reply_text("🤖 Планирую действия...")
        
        try:
            plan = await self.planner.create_initial_plan(task_plan)
            
            # Форматируем план для Telegram
            plan_text = f"📋 *План создан*\n\n🎯 *Цель:* {plan['goal']}\n\n*Шаги:*\n"
            for i, step in enumerate(plan['steps'], 1):
                action = step['action']
                reasoning = step.get('reasoning', '')[:50]
                plan_text += f"{i}. {action} - {reasoning}...\n"
            
            await update.message.reply_text(plan_text, parse_mode='Markdown')
            
            # 3. Выполняем итеративно с replan
            steps_done = []
            current_steps = plan['steps']
            monitor_info = self.screen.get_secondary_monitor_info()
            
            while current_steps:
                for step in current_steps:
                    # Выполняем шаг
                    result = await self.planner.execute_step(step, monitor_info)
                    
                    step_desc = f"{step['action']} {step.get('params', {})}"
                    steps_done.append(step_desc)
                    
                    if result['success']:
                        logger.info(f"✅ {result['result']}")
                    else:
                        logger.warning(f"⚠️ {result['result']}")
                    
                    # Если нужен replan
                    if result.get('needs_replan'):
                        await update.message.reply_text("🔄 Анализирую ситуацию...")
                        
                        # Делаем скриншот
                        screenshot = self.screen.capture_secondary_monitor()
                        await asyncio.sleep(1)
                        
                        # Определяем текущее состояние
                        from self_correcting_executor import SelfCorrectingExecutor
                        executor = SelfCorrectingExecutor()
                        verification = await executor.verify_task_completion(screenshot, plan['goal'])
                        
                        current_state = verification.get('explanation', 'Состояние неизвестно')
                        
                        # Проверяем завершение
                        if verification.get('completed'):
                            await update.message.reply_text("✅ Задача выполнена!")
                            return "Задача выполнена успешно"
                        
                        # Запрашиваем новый план
                        new_plan = await self.planner.replan(
                            screenshot_path=screenshot,
                            original_goal=plan['goal'],
                            current_state=current_state,
                            steps_done=steps_done
                        )
                        
                        if not new_plan.get('steps'):
                            # Или цель достигнута, или застряли
                            if verification.get('completed'):
                                await update.message.reply_text("✅ Цель достигнута!")
                                return "Задача выполнена"
                            else:
                                await update.message.reply_text("❌ Не удалось выполнить задачу")
                                return "Застряли в выполнении"
                        
                        current_steps = new_plan['steps']
                        
                        # Показываем новый план
                        new_plan_text = f"📋 *Новый план* ({len(current_steps)} шагов):\n"
                        for i, step in enumerate(current_steps, 1):
                            action = step['action']
                            reasoning = step.get('reasoning', '')[:40]
                            new_plan_text += f"{i}. {action} - {reasoning}...\n"
                        
                        await update.message.reply_text(new_plan_text, parse_mode='Markdown')
                        break  # Прерываем текущий цикл и начинаем новый план
                else:
                    # Все шаги выполнены без replan
                    current_steps = []
            
            # Финальная проверка
            screenshot = self.screen.capture_secondary_monitor()
            from self_correcting_executor import SelfCorrectingExecutor
            executor = SelfCorrectingExecutor()
            verification = await executor.verify_task_completion(screenshot, plan['goal'])
            
            if verification.get('completed'):
                await update.message.reply_text("✅ Задача выполнена успешно!")
                return "Задача выполнена"
            else:
                await update.message.reply_text(
                    f"⚠️ Задача выполнена частично\n"
                    f"Состояние: {verification.get('explanation', '')}"
                )
                return "Выполнено частично"
                
        except Exception as e:
            logger.error(f"Ошибка выполнения: {e}", exc_info=True)
            await update.message.reply_text(f"❌ Ошибка: {e}")
            return f"Ошибка: {e}"
    
    async def _execute_app_task(self, task_plan: str, update: Update) -> str:
        """
        Выполняет задачу с десктопным приложением через итеративное планирование
        БЕЗ открытия браузера
        """
        logger.info("📱 Выполняю задачу с приложением")
        
        # Создаем начальный план БЕЗ открытия браузера
        await update.message.reply_text("🤖 Планирую действия...")
        
        try:
            plan = await self.planner.create_initial_plan(task_plan)
            
            # Форматируем план для Telegram
            plan_text = f"📋 *План создан*\n\n🎯 *Цель:* {plan['goal']}\n\n*Шаги:*\n"
            for i, step in enumerate(plan['steps'], 1):
                action = step['action']
                reasoning = step.get('reasoning', '')[:50]
                plan_text += f"{i}. {action} - {reasoning}...\n"
            
            await update.message.reply_text(plan_text, parse_mode='Markdown')
            
            # Выполняем итеративно с replan
            steps_done = []
            current_steps = plan['steps']
            monitor_info = self.screen.get_secondary_monitor_info()
            
            while current_steps:
                for step in current_steps:
                    # Выполняем шаг
                    result = await self.planner.execute_step(step, monitor_info)
                    
                    step_desc = f"{step['action']} {step.get('params', {})}"
                    steps_done.append(step_desc)
                    
                    if result['success']:
                        logger.info(f"✅ {result['result']}")
                    else:
                        logger.warning(f"⚠️ {result['result']}")
                    
                    # Если нужен replan
                    if result.get('needs_replan'):
                        await update.message.reply_text("🔄 Анализирую ситуацию...")
                        
                        # Делаем скриншот
                        screenshot = self.screen.capture_secondary_monitor()
                        await asyncio.sleep(1)
                        
                        # Определяем текущее состояние
                        from self_correcting_executor import SelfCorrectingExecutor
                        executor = SelfCorrectingExecutor()
                        verification = await executor.verify_task_completion(screenshot, plan['goal'])
                        
                        current_state = verification.get('explanation', 'Состояние неизвестно')
                        
                        # Проверяем завершение
                        if verification.get('completed'):
                            await update.message.reply_text("✅ Задача выполнена!")
                            return "Задача выполнена успешно"
                        
                        # Запрашиваем новый план
                        new_plan = await self.planner.replan(
                            screenshot_path=screenshot,
                            original_goal=plan['goal'],
                            current_state=current_state,
                            steps_done=steps_done
                        )
                        
                        if not new_plan.get('steps'):
                            # Или цель достигнута, или застряли
                            if verification.get('completed'):
                                await update.message.reply_text("✅ Цель достигнута!")
                                return "Задача выполнена"
                            else:
                                await update.message.reply_text("❌ Не удалось выполнить задачу")
                                return "Застряли в выполнении"
                        
                        current_steps = new_plan['steps']
                        
                        # Показываем новый план
                        new_plan_text = f"📋 *Новый план* ({len(current_steps)} шагов):\n"
                        for i, step in enumerate(current_steps, 1):
                            action = step['action']
                            reasoning = step.get('reasoning', '')[:40]
                            new_plan_text += f"{i}. {action} - {reasoning}...\n"
                        
                        await update.message.reply_text(new_plan_text, parse_mode='Markdown')
                        break  # Прерываем текущий цикл и начинаем новый план
                else:
                    # Все шаги выполнены без replan
                    current_steps = []
            
            # Финальная проверка
            screenshot = self.screen.capture_secondary_monitor()
            from self_correcting_executor import SelfCorrectingExecutor
            executor = SelfCorrectingExecutor()
            verification = await executor.verify_task_completion(screenshot, plan['goal'])
            
            if verification.get('completed'):
                await update.message.reply_text("✅ Задача выполнена успешно!")
                return "Задача выполнена"
            else:
                await update.message.reply_text(
                    f"⚠️ Задача выполнена частично\n"
                    f"Состояние: {verification.get('explanation', '')}"
                )
                return "Выполнено частично"
                
        except Exception as e:
            logger.error(f"Ошибка выполнения: {e}", exc_info=True)
            await update.message.reply_text(f"❌ Ошибка: {e}")
            return f"Ошибка: {e}"
