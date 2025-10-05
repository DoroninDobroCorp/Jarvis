"""
Тест Chrome DevTools MCP интеграции
"""

import asyncio
import logging
import sys
from pathlib import Path

# Добавляем корневую директорию в путь для импорта
sys.path.insert(0, str(Path(__file__).parent.parent))

from chrome_mcp_client import ChromeMCPClient

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/test_chrome_mcp.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


async def test_connection():
    """Тест подключения к Chrome DevTools MCP"""
    logger.info("=" * 60)
    logger.info("ТЕСТ 1: Подключение к Chrome DevTools MCP")
    logger.info("=" * 60)
    
    client = ChromeMCPClient()
    
    try:
        success = await client.connect()
        if success:
            logger.info("✅ Подключение успешно")
            return True
        else:
            logger.error("❌ Не удалось подключиться")
            return False
    except Exception as e:
        logger.error(f"❌ Ошибка при подключении: {e}", exc_info=True)
        return False
    finally:
        await client.disconnect()


async def test_list_tools():
    """Тест получения списка инструментов"""
    logger.info("\n" + "=" * 60)
    logger.info("ТЕСТ 2: Получение списка инструментов")
    logger.info("=" * 60)
    
    client = ChromeMCPClient()
    
    try:
        await client.connect()
        
        tools = await client.list_tools()
        logger.info(f"Получено инструментов: {len(tools)}")
        
        if len(tools) > 0:
            logger.info("\nДоступные инструменты:")
            for i, tool in enumerate(tools, 1):
                tool_name = tool.name if hasattr(tool, 'name') else 'Unknown'
                tool_desc = tool.description if hasattr(tool, 'description') else 'N/A'
                logger.info(f"  {i}. {tool_name}")
                logger.info(f"     Описание: {tool_desc}")
            
            logger.info("✅ Список инструментов получен")
            return True
        else:
            logger.warning("⚠️  Список инструментов пуст")
            return False
            
    except Exception as e:
        logger.error(f"❌ Ошибка при получении списка: {e}", exc_info=True)
        return False
    finally:
        await client.disconnect()


async def test_basic_functionality():
    """Тест базовой функциональности (без реального браузера)"""
    logger.info("\n" + "=" * 60)
    logger.info("ТЕСТ 3: Базовая функциональность клиента")
    logger.info("=" * 60)
    
    client = ChromeMCPClient()
    
    try:
        await client.connect()
        
        # Проверяем, что методы доступны
        methods = [
            'navigate_to_url',
            'click_element', 
            'execute_javascript',
            'get_page_content',
            'screenshot'
        ]
        
        for method_name in methods:
            if hasattr(client, method_name):
                logger.info(f"✅ Метод {method_name} доступен")
            else:
                logger.error(f"❌ Метод {method_name} недоступен")
                return False
        
        logger.info("✅ Все методы доступны")
        return True
        
    except Exception as e:
        logger.error(f"❌ Ошибка: {e}", exc_info=True)
        return False
    finally:
        await client.disconnect()


async def test_reconnection():
    """Тест переподключения"""
    logger.info("\n" + "=" * 60)
    logger.info("ТЕСТ 4: Переподключение")
    logger.info("=" * 60)
    
    client = ChromeMCPClient()
    
    try:
        # Первое подключение
        logger.info("Первое подключение...")
        await client.connect()
        logger.info("✅ Первое подключение успешно")
        
        # Отключение
        logger.info("Отключение...")
        await client.disconnect()
        logger.info("✅ Отключение успешно")
        
        # Повторное подключение
        logger.info("Повторное подключение...")
        await client.connect()
        logger.info("✅ Повторное подключение успешно")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Ошибка при переподключении: {e}", exc_info=True)
        return False
    finally:
        await client.disconnect()


async def run_all_tests():
    """Запуск всех тестов"""
    logger.info("\n" + "🧪" * 30)
    logger.info("ЗАПУСК ТЕСТОВ CHROME DEVTOOLS MCP")
    logger.info("🧪" * 30 + "\n")
    
    tests = [
        ("Подключение", test_connection),
        ("Список инструментов", test_list_tools),
        ("Базовая функциональность", test_basic_functionality),
        ("Переподключение", test_reconnection),
    ]
    
    results = {}
    
    for test_name, test_func in tests:
        try:
            result = await test_func()
            results[test_name] = result
        except Exception as e:
            logger.error(f"Критическая ошибка в тесте '{test_name}': {e}")
            results[test_name] = False
        
        # Пауза между тестами
        await asyncio.sleep(1)
    
    # Итоги
    logger.info("\n" + "=" * 60)
    logger.info("ИТОГИ ТЕСТИРОВАНИЯ")
    logger.info("=" * 60)
    
    passed = sum(1 for r in results.values() if r)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        logger.info(f"{status}: {test_name}")
    
    logger.info("\n" + "-" * 60)
    logger.info(f"Пройдено: {passed}/{total} ({passed/total*100:.1f}%)")
    logger.info("-" * 60)
    
    if passed == total:
        logger.info("✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ!")
        return True
    else:
        logger.error("❌ ЕСТЬ НЕУДАЧНЫЕ ТЕСТЫ")
        return False


if __name__ == "__main__":
    # Запуск тестов
    success = asyncio.run(run_all_tests())
    
    # Выход с кодом
    sys.exit(0 if success else 1)
