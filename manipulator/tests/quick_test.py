# РЕГУЛЯРНЫЙ ТЕСТ: Использовать для быстрой проверки базовых компонентов после изменений
"""
Быстрый тест для отладки
"""
import asyncio
import logging
import sys
from pathlib import Path

# Добавляем родительскую директорию в путь
sys.path.insert(0, str(Path(__file__).parent.parent))

from command_interpreter import CommandInterpreter
from screen_manager import ScreenManager
from browser_controller import BrowserController

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

async def test_gemini():
    """Тест Gemini понимания"""
    print("\n=== ТЕСТ 1: Gemini понимание команды ===")
    interpreter = CommandInterpreter()
    
    command = "Открой YouTube и найди видео про котиков"
    print(f"Команда: {command}")
    
    plan = await interpreter.understand_command(command)
    print(f"План: {plan}")
    print("✅ Gemini работает\n")


async def test_screen():
    """Тест скриншотов"""
    print("\n=== ТЕСТ 2: Скриншоты ===")
    screen = ScreenManager()
    
    print(f"Найдено мониторов: {len(screen.displays)}")
    for i, display in enumerate(screen.displays):
        print(f"  Монитор {i}: {display['width']}x{display['height']}")
    
    screenshot = screen.capture_secondary_monitor()
    print(f"Скриншот сохранен: {screenshot}")
    print("✅ Скриншоты работают\n")
    
    return screenshot


async def test_browser():
    """Тест открытия браузера"""
    print("\n=== ТЕСТ 3: Браузер ===")
    browser = BrowserController()
    
    await browser.open_on_secondary_monitor()
    print("✅ Браузер открыт на втором мониторе\n")
    
    await asyncio.sleep(3)


async def main():
    print("\n" + "="*50)
    print("🧪 БЫСТРЫЕ ТЕСТЫ КОМПОНЕНТОВ")
    print("="*50)
    
    # Тест 1: Gemini
    try:
        await test_gemini()
    except Exception as e:
        print(f"❌ Ошибка Gemini: {e}\n")
    
    # Тест 2: Скриншоты
    try:
        screenshot = await test_screen()
        print(f"📸 Скриншот для проверки: {screenshot}")
    except Exception as e:
        print(f"❌ Ошибка скриншотов: {e}\n")
    
    # Тест 3: Браузер
    try:
        await test_browser()
    except Exception as e:
        print(f"❌ Ошибка браузера: {e}\n")
    
    print("\n" + "="*50)
    print("✨ ТЕСТЫ ЗАВЕРШЕНЫ")
    print("="*50 + "\n")


if __name__ == '__main__':
    asyncio.run(main())
