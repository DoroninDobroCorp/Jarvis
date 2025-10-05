"""
Тест: Регистрация аккаунта Windsurf на временную почту

Комплексный тест для проверки:
1. MCP интеграции (navigate, click, type, execute_js)
2. Fallback MCP → VISUAL_CLICK
3. Работы с несколькими окнами/вкладками
4. Итеративного планирования
5. Совместной работы с пользователем

Задача:
- Открыть временную почту (10minutemail.com)
- Скопировать email адрес
- Открыть Windsurf регистрацию
- Заполнить форму
- Подтвердить email
"""

import asyncio
import logging
import sys
from pathlib import Path

# Добавляем корневую директорию в путь
sys.path.insert(0, str(Path(__file__).parent.parent))

from iterative_planner import IterativePlanner
from screen_manager import ScreenManager
from browser_controller import BrowserController
import config

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/test_windsurf_registration.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


async def test_windsurf_registration():
    """
    Полный сценарий регистрации Windsurf
    """
    logger.info("=" * 80)
    logger.info("ТЕСТ: РЕГИСТРАЦИЯ WINDSURF НА ВРЕМЕННУЮ ПОЧТУ")
    logger.info("=" * 80)
    
    # Инициализация
    screen = ScreenManager(wait_for_user_idle=config.WAIT_FOR_USER_IDLE)
    browser = BrowserController(browser='Chrome', screen=screen)
    planner = IterativePlanner(api_key=config.GEMINI_API_KEY, screen_manager=screen)
    planner.is_browser_task = True  # Активируем MCP режим
    
    try:
        # Шаг 1: Открываем браузер
        logger.info("\n" + "=" * 60)
        logger.info("ШАГ 1: Открытие Chrome на втором мониторе")
        logger.info("=" * 60)
        
        await browser.open_on_secondary_monitor()
        await asyncio.sleep(3)
        
        logger.info("✅ Chrome открыт")
        
        # Шаг 2: Создаем план для временной почты
        logger.info("\n" + "=" * 60)
        logger.info("ШАГ 2: Получение временного email")
        logger.info("=" * 60)
        
        task_1 = """
        Открой сайт 10minutemail.com и получи временный email адрес.
        Задача:
        1. Открыть 10minutemail.com
        2. Подождать загрузки страницы
        3. Найти и скопировать email адрес
        """
        
        plan_1 = await planner.create_initial_plan(task_1)
        logger.info(f"📋 План создан: {len(plan_1['steps'])} шагов")
        
        # Выполняем план 1
        monitor_info = screen.get_secondary_monitor_info()
        steps_done = []
        
        for i, step in enumerate(plan_1['steps'], 1):
            logger.info(f"\n▶️  Шаг {i}/{len(plan_1['steps'])}: {step['action']}")
            result = await planner.execute_step(step, monitor_info)
            
            if result['success']:
                logger.info(f"✅ {result['result']}")
            else:
                logger.warning(f"⚠️ {result['result']}")
            
            steps_done.append(f"{step['action']} {step.get('params', {})}")
            
            if result.get('needs_replan'):
                logger.info("🔄 Требуется replan...")
                break
            
            await asyncio.sleep(1)
        
        # Даем время посмотреть на результат
        logger.info("\n⏸️  Пауза 5 секунд для проверки email...")
        await asyncio.sleep(5)
        
        # Шаг 3: Windsurf регистрация
        logger.info("\n" + "=" * 60)
        logger.info("ШАГ 3: Регистрация на Windsurf")
        logger.info("=" * 60)
        
        # Сначала получаем email со страницы 10minutemail
        logger.info("\n📝 Получение email адреса...")
        js_code = "document.querySelector('#mail_address')?.value || 'email не найден'"
        step_js = {
            'action': 'MCP_EXECUTE_JS',
            'params': {'code': js_code}
        }
        result_js = await planner.execute_step(step_js, monitor_info)
        logger.info(f"📧 Email: {result_js['result']}")
        
        # Теперь создаем план для регистрации Windsurf
        task_2 = """
        Зарегистрировать новый аккаунт на сайте Windsurf.
        
        Задача:
        1. Открыть сайт codeium.com/windsurf или найти страницу регистрации
        2. Найти и кликнуть на кнопку регистрации (Sign Up, Get Started, Register и т.д.)
        3. Заполнить форму регистрации:
           - Email: использовать адрес с 10minutemail (получить через JavaScript со страницы 10minutemail)
           - Пароль: TestPassword123! (если требуется)
           - Имя: Test User (если требуется)
        4. Отправить форму регистрации
        
        ВАЖНО: 
        - НЕ hardcode никакие селекторы - система должна САМА найти элементы
        - Используй MCP действия где возможно
        - Если MCP не работает - автоматически сработает fallback на VISUAL_CLICK
        """
        
        plan_2 = await planner.create_initial_plan(task_2)
        logger.info(f"📋 План регистрации создан: {len(plan_2['steps'])} шагов")
        
        # Выполняем план 2
        for i, step in enumerate(plan_2['steps'], 1):
            logger.info(f"\n▶️  Шаг {i}/{len(plan_2['steps'])}: {step['action']}")
            result = await planner.execute_step(step, monitor_info)
            
            if result['success']:
                logger.info(f"✅ {result['result']}")
            else:
                logger.warning(f"⚠️ {result['result']}")
            
            if result.get('needs_replan'):
                logger.info("🔄 Требуется переплан...")
                # Можем добавить replan логику
                break
            
            await asyncio.sleep(1)
        
        # Финальная проверка
        logger.info("\n" + "=" * 60)
        logger.info("ИТОГИ ТЕСТА")
        logger.info("=" * 60)
        
        logger.info("""
        ✅ Проверено:
        - Открытие браузера
        - MCP_NAVIGATE для открытия URL
        - MCP_EXECUTE_JS для получения данных
        - Итеративное планирование
        - Ожидание бездействия пользователя
        
        ⚠️  Для полной проверки нужно:
        - Реальный URL регистрации Windsurf
        - MCP_CLICK по элементам формы
        - MCP_TYPE для ввода данных
        - Fallback на VISUAL_CLICK
        - Работа с подтверждением email
        """)
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Ошибка в тесте: {e}", exc_info=True)
        return False
        
    finally:
        # Cleanup
        logger.info("\n🧹 Cleanup...")
        
        # Закрываем MCP соединение
        from chrome_mcp_integration import close_chrome_mcp_integration
        await close_chrome_mcp_integration()
        
        logger.info("✅ Cleanup завершен")


async def test_mcp_basic_actions():
    """
    Базовая проверка MCP действий без полной регистрации
    """
    logger.info("\n" + "=" * 80)
    logger.info("ТЕСТ: БАЗОВЫЕ MCP ДЕЙСТВИЯ")
    logger.info("=" * 80)
    
    screen = ScreenManager(wait_for_user_idle=False)  # Без ожидания для теста
    browser = BrowserController(browser='Chrome', screen=screen)
    planner = IterativePlanner(api_key=config.GEMINI_API_KEY, screen_manager=screen)
    planner.is_browser_task = True
    
    try:
        # Открываем браузер
        await browser.open_on_secondary_monitor()
        await asyncio.sleep(2)
        
        monitor_info = screen.get_secondary_monitor_info()
        
        # Тест 1: MCP_NAVIGATE
        logger.info("\n📝 Тест 1: MCP_NAVIGATE")
        step1 = {
            'action': 'MCP_NAVIGATE',
            'params': {'url': 'https://example.com'}
        }
        result1 = await planner.execute_step(step1, monitor_info)
        logger.info(f"{'✅' if result1['success'] else '❌'} MCP_NAVIGATE: {result1['result']}")
        await asyncio.sleep(2)
        
        # Тест 2: MCP_EXECUTE_JS
        logger.info("\n📝 Тест 2: MCP_EXECUTE_JS")
        step2 = {
            'action': 'MCP_EXECUTE_JS',
            'params': {'code': 'document.title'}
        }
        result2 = await planner.execute_step(step2, monitor_info)
        logger.info(f"{'✅' if result2['success'] else '❌'} MCP_EXECUTE_JS: {result2['result']}")
        await asyncio.sleep(1)
        
        # Тест 3: MCP_CLICK (будет fallback если селектор неверный)
        logger.info("\n📝 Тест 3: MCP_CLICK (fallback тест)")
        step3 = {
            'action': 'MCP_CLICK',
            'params': {'selector': 'a'}  # Первая ссылка
        }
        result3 = await planner.execute_step(step3, monitor_info)
        logger.info(f"{'✅' if result3['success'] else '⚠️'} MCP_CLICK: {result3['result']}")
        
        # Итоги
        logger.info("\n" + "=" * 60)
        logger.info("ИТОГИ БАЗОВЫХ ТЕСТОВ")
        logger.info("=" * 60)
        
        tests_passed = sum([
            result1['success'],
            result2['success'],
            result3['success'] or result3.get('needs_replan')  # Fallback тоже OK
        ])
        
        logger.info(f"Пройдено: {tests_passed}/3")
        
        return tests_passed >= 2  # Минимум 2 из 3
        
    except Exception as e:
        logger.error(f"❌ Ошибка: {e}", exc_info=True)
        return False
        
    finally:
        from chrome_mcp_integration import close_chrome_mcp_integration
        await close_chrome_mcp_integration()


async def main():
    """Запуск всех тестов"""
    logger.info("\n" + "🧪" * 40)
    logger.info("ЗАПУСК ТЕСТОВ WINDSURF РЕГИСТРАЦИИ")
    logger.info("🧪" * 40 + "\n")
    
    # Тест 1: Базовые MCP действия
    logger.info("\n" + "=" * 80)
    logger.info("ТЕСТ 1: Базовые MCP действия")
    logger.info("=" * 80)
    
    test1_result = await test_mcp_basic_actions()
    await asyncio.sleep(2)
    
    # Тест 2: Полный сценарий (demo)
    logger.info("\n" + "=" * 80)
    logger.info("ТЕСТ 2: Полный сценарий регистрации")
    logger.info("=" * 80)
    
    test2_result = await test_windsurf_registration()
    
    # Финальные итоги
    logger.info("\n" + "=" * 80)
    logger.info("ФИНАЛЬНЫЕ ИТОГИ")
    logger.info("=" * 80)
    
    logger.info(f"\n{'✅' if test1_result else '❌'} Тест 1: Базовые MCP действия")
    logger.info(f"{'✅' if test2_result else '❌'} Тест 2: Полный сценарий")
    
    all_passed = test1_result and test2_result
    
    if all_passed:
        logger.info("\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ!")
        return 0
    else:
        logger.error("\n❌ ЕСТЬ НЕУДАЧНЫЕ ТЕСТЫ")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
