#!/usr/bin/env python3
"""
Тестовый скрипт для проверки выполнения задачи без Telegram

Запускает полный цикл планирования и выполнения задачи,
логирует все действия в файл и консоль.
"""
import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path

# Настройка максимального логирования
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
    ]
)

# Создаем отдельный лог файл для этого теста
log_dir = Path('logs')
log_dir.mkdir(exist_ok=True)
timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
log_file = log_dir / f'test_spotify_{timestamp}.log'

file_handler = logging.FileHandler(log_file, encoding='utf-8')
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))

# Добавляем file handler ко всем логгерам
for logger_name in ['', 'iterative_planner', 'self_correcting_executor', 'screen_manager']:
    logger = logging.getLogger(logger_name)
    logger.addHandler(file_handler)
    logger.setLevel(logging.DEBUG)

logger = logging.getLogger(__name__)

# Добавляем путь к родительской директории для импорта модулей
sys.path.insert(0, str(Path(__file__).parent.parent))

# Импорты после настройки логирования
import config
from iterative_planner import IterativePlanner
from screen_manager import ScreenManager
from self_correcting_executor import SelfCorrectingExecutor


class FakeUpdate:
    """Заглушка для Update из Telegram"""
    class FakeMessage:
        async def reply_text(self, text, parse_mode=None):
            print(f"\n{'='*70}")
            print(f"📱 [BOT MESSAGE]")
            print(f"{'='*70}")
            print(text)
            print(f"{'='*70}\n")
    
    def __init__(self):
        self.message = self.FakeMessage()


async def execute_app_task(task_plan: str, planner: IterativePlanner, screen: ScreenManager) -> str:
    """
    Выполняет задачу с десктопным приложением
    Копия _execute_app_task из task_executor.py но без Telegram
    """
    logger.info("📱 Выполняю задачу с приложением")
    
    fake_update = FakeUpdate()
    
    # Создаем начальный план
    await fake_update.message.reply_text("🤖 Планирую действия...")
    
    try:
        plan = await planner.create_initial_plan(task_plan)
        
        # Форматируем план
        plan_text = f"📋 *План создан*\n\n🎯 *Цель:* {plan['goal']}\n\n*Шаги:*\n"
        for i, step in enumerate(plan['steps'], 1):
            action = step['action']
            reasoning = step.get('reasoning', '')[:50]
            plan_text += f"{i}. {action} - {reasoning}...\n"
        
        await fake_update.message.reply_text(plan_text)
        
        # Выполняем итеративно с replan
        steps_done = []
        current_steps = plan['steps']
        monitor_info = screen.get_secondary_monitor_info()
        
        replan_counter = 0
        max_replans = 10
        
        while current_steps and replan_counter < max_replans:
            for step in current_steps:
                # Выполняем шаг
                logger.info(f"\n{'='*70}")
                logger.info(f"🔧 Выполняю шаг: {step['action']}")
                logger.info(f"   Параметры: {step.get('params', {})}")
                logger.info(f"   Обоснование: {step.get('reasoning', '')}")
                logger.info(f"{'='*70}")
                
                result = await planner.execute_step(step, monitor_info)
                
                step_desc = f"{step['action']} {step.get('params', {})}"
                steps_done.append(step_desc)
                
                if result['success']:
                    logger.info(f"✅ {result['result']}")
                else:
                    logger.warning(f"⚠️ {result['result']}")
                
                # Если нужен replan
                if result.get('needs_replan'):
                    replan_counter += 1
                    await fake_update.message.reply_text(f"🔄 Анализирую ситуацию... (replan {replan_counter}/{max_replans})")
                    
                    # Делаем скриншот
                    screenshot = screen.capture_secondary_monitor()
                    await asyncio.sleep(1)
                    
                    # Определяем текущее состояние
                    executor = SelfCorrectingExecutor(screen)
                    verification = await executor.verify_task_completion(screenshot, plan['goal'])
                    
                    current_state = verification.get('explanation', 'Состояние неизвестно')
                    
                    logger.info(f"🔍 Текущее состояние: {current_state}")
                    logger.info(f"   Задача выполнена: {verification.get('completed')}")
                    
                    # Проверяем завершение
                    if verification.get('completed'):
                        await fake_update.message.reply_text("✅ Задача выполнена!")
                        return "Задача выполнена успешно"
                    
                    # Запрашиваем новый план
                    logger.info(f"📝 Запрашиваю новый план...")
                    logger.info(f"   Оригинальная цель: {plan['goal']}")
                    logger.info(f"   Текущее состояние: {current_state}")
                    logger.info(f"   Шаги выполнены: {steps_done}")
                    
                    new_plan = await planner.replan(
                        screenshot_path=screenshot,
                        original_goal=plan['goal'],
                        current_state=current_state,
                        steps_done=steps_done
                    )
                    
                    if not new_plan.get('steps'):
                        # Или цель достигнута, или застряли
                        if verification.get('completed'):
                            await fake_update.message.reply_text("✅ Цель достигнута!")
                            return "Задача выполнена"
                        else:
                            await fake_update.message.reply_text("❌ Не удалось выполнить задачу")
                            return "Застряли в выполнении"
                    
                    current_steps = new_plan['steps']
                    
                    # Показываем новый план
                    new_plan_text = f"📋 *Новый план* ({len(current_steps)} шагов):\n"
                    for i, step in enumerate(current_steps, 1):
                        action = step['action']
                        reasoning = step.get('reasoning', '')[:40]
                        new_plan_text += f"{i}. {action} - {reasoning}...\n"
                    
                    await fake_update.message.reply_text(new_plan_text)
                    break  # Прерываем текущий цикл и начинаем новый план
            else:
                # Все шаги выполнены без replan
                current_steps = []
        
        if replan_counter >= max_replans:
            await fake_update.message.reply_text(f"⚠️ Достигнут лимит replans ({max_replans})")
            return "Достигнут лимит replans"
        
        # Финальная проверка
        screenshot = screen.capture_secondary_monitor()
        executor = SelfCorrectingExecutor(screen)
        verification = await executor.verify_task_completion(screenshot, plan['goal'])
        
        if verification.get('completed'):
            await fake_update.message.reply_text("✅ Задача выполнена успешно!")
            return "Задача выполнена"
        else:
            await fake_update.message.reply_text(
                f"⚠️ Задача выполнена частично\n"
                f"Состояние: {verification.get('explanation', '')}"
            )
            return "Выполнено частично"
            
    except Exception as e:
        logger.error(f"Ошибка выполнения: {e}", exc_info=True)
        await fake_update.message.reply_text(f"❌ Ошибка: {e}")
        return f"Ошибка: {e}"


async def main():
    """Основная функция теста"""
    print(f"\n{'='*70}")
    print(f"🎯 ТЕСТ: Включи на спотифае песню 'Винтовка это праздник'")
    print(f"{'='*70}")
    print(f"📝 Лог сохраняется в: {log_file}")
    print(f"{'='*70}\n")
    
    # Задача
    task = "Включи на спотифае песню 'Винтовка это праздник'"
    
    logger.info(f"🚀 Начинаю тест")
    logger.info(f"   Задача: {task}")
    logger.info(f"   Лог файл: {log_file}")
    
    # Инициализация компонентов
    logger.info("🔧 Инициализация компонентов...")
    screen = ScreenManager(wait_for_user_idle=config.WAIT_FOR_USER_IDLE)
    planner = IterativePlanner(api_key=config.GEMINI_API_KEY, screen_manager=screen)
    
    logger.info("✅ Компоненты инициализированы")
    
    # Выполняем задачу
    try:
        result = await execute_app_task(task, planner, screen)
        
        print(f"\n{'='*70}")
        print(f"🏁 ФИНАЛЬНЫЙ РЕЗУЛЬТАТ")
        print(f"{'='*70}")
        print(f"   {result}")
        print(f"{'='*70}")
        print(f"\n📝 Полный лог в: {log_file}\n")
        
        logger.info(f"🏁 Тест завершен: {result}")
        
    except Exception as e:
        logger.error(f"💥 Критическая ошибка: {e}", exc_info=True)
        print(f"\n❌ Критическая ошибка: {e}\n")
        print(f"📝 Лог ошибки в: {log_file}\n")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️ Тест прерван пользователем\n")
        logger.info("⚠️ Тест прерван пользователем")
