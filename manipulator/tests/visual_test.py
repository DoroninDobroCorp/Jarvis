"""
Визуальный тест - проверяем что все работает на втором мониторе
"""
import asyncio
import logging
import sys
from pathlib import Path

# Добавляем родительскую директорию в путь
sys.path.insert(0, str(Path(__file__).parent.parent))

from screen_manager import ScreenManager
from browser_controller import BrowserController
from command_interpreter import CommandInterpreter
import os
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_browser_on_secondary():
    """Тест: открытие браузера на втором мониторе"""
    print("\n" + "="*60)
    print("🧪 ВИЗУАЛЬНЫЙ ТЕСТ: Браузер на втором мониторе")
    print("="*60)
    
    screen = ScreenManager()
    browser = BrowserController()
    
    # Скриншот ДО
    print("\n1️⃣ Делаю скриншот второго монитора ДО открытия браузера...")
    before = screen.capture_secondary_monitor()
    print(f"   📸 Сохранено: {before}")
    
    # Открываем браузер
    print("\n2️⃣ Открываю Safari на втором мониторе...")
    await browser.open_on_secondary_monitor()
    await asyncio.sleep(2)
    
    # Скриншот ПОСЛЕ
    print("\n3️⃣ Делаю скриншот ПОСЛЕ открытия браузера...")
    after = screen.capture_secondary_monitor()
    print(f"   📸 Сохранено: {after}")
    
    # Переходим на YouTube
    print("\n4️⃣ Открываю YouTube...")
    await browser.navigate_to("https://www.youtube.com")
    await asyncio.sleep(3)
    
    youtube_screen = screen.capture_secondary_monitor()
    print(f"   📸 YouTube скриншот: {youtube_screen}")
    
    # Клик в поисковую строку
    print("\n5️⃣ Кликаю в поисковую строку YouTube...")
    # Координаты поиска на YouTube (примерно по центру сверху)
    search_x = 840  # Середина ширины 1680
    search_y = 100  # Верх
    screen.click_at(search_x, search_y)
    await asyncio.sleep(1)
    
    # Вводим текст
    print("\n6️⃣ Ввожу 'котики'...")
    screen.type_text("котики")
    await asyncio.sleep(2)
    
    search_screen = screen.capture_secondary_monitor()
    print(f"   📸 После поиска: {search_screen}")
    
    print("\n✅ ТЕСТ ЗАВЕРШЕН")
    print(f"\n📁 Скриншоты второго монитора:")
    print(f"   - До: {before}")
    print(f"   - После открытия: {after}")
    print(f"   - YouTube: {youtube_screen}")
    print(f"   - Поиск: {search_screen}")
    print("\n👀 ПРОВЕРЬ СКРИНШОТЫ ВИЗУАЛЬНО!")


async def test_gemini_understanding():
    """Тест понимания команд через Gemini"""
    print("\n" + "="*60)
    print("🧪 ТЕСТ: Gemini понимание команд")
    print("="*60)
    
    interpreter = CommandInterpreter()
    
    test_commands = [
        "Включи первую серию третьего сезона Клинка рассекающего демона",
        "Открой Spotify и включи музыку",
        "Найди погоду в Москве в Google",
        "Открой калькулятор"
    ]
    
    for cmd in test_commands:
        print(f"\n📝 Команда: '{cmd}'")
        plan = await interpreter.understand_command(cmd)
        print(f"✅ План:\n{plan}\n")
        await asyncio.sleep(1)


async def main():
    print("\n" + "#"*60)
    print("🚀 ЗАПУСК ВИЗУАЛЬНЫХ ТЕСТОВ")
    print("#"*60)
    
    # Тест 1: Gemini
    await test_gemini_understanding()
    
    # Тест 2: Браузер на втором мониторе
    await test_browser_on_secondary()
    
    print("\n" + "#"*60)
    print("✨ ВСЕ ТЕСТЫ ЗАВЕРШЕНЫ")
    print("#"*60)


if __name__ == '__main__':
    asyncio.run(main())
