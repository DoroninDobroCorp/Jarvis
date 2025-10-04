"""
Простой тест - открыть Safari на втором мониторе и сделать скриншот
"""
import asyncio
import sys
from pathlib import Path

# Добавляем родительскую директорию в путь
sys.path.insert(0, str(Path(__file__).parent.parent))

from screen_manager import ScreenManager
from browser_controller import BrowserController

async def main():
    print("="*60)
    print("ТЕСТ: Safari на втором мониторе")
    print("="*60)
    
    screen = ScreenManager()
    browser = BrowserController()
    
    print("\n1. Скриншот второго монитора ДО...")
    before = screen.capture_secondary_monitor()
    print(f"   Сохранено: {before}")
    
    print("\n2. Открываю Safari на втором мониторе...")
    await browser.open_on_secondary_monitor()
    
    await asyncio.sleep(3)
    
    print("\n3. Скриншот ПОСЛЕ...")
    after = screen.capture_secondary_monitor()
    print(f"   Сохранено: {after}")
    
    print("\n4. Перехожу на YouTube...")
    await browser.navigate_to("https://www.youtube.com")
    
    await asyncio.sleep(5)
    
    print("\n5. Скриншот YouTube...")
    youtube = screen.capture_secondary_monitor()
    print(f"   Сохранено: {youtube}")
    
    print("\n✅ ТЕСТ ЗАВЕРШЕН")
    print(f"\nПРОВЕРЬ СКРИНШОТЫ:")
    print(f"  До: {before}")
    print(f"  После: {after}")
    print(f"  YouTube: {youtube}")
    print("\nДолжен быть виден Safari с YouTube на втором мониторе!")

if __name__ == '__main__':
    asyncio.run(main())
