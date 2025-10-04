# РЕГУЛЯРНЫЙ ТЕСТ: Проверка параллельной работы, детектора активности и уведомлений
"""
Тест параллельной работы с детектором активности
"""
import asyncio
import logging
import sys
from pathlib import Path

# Добавляем родительскую директорию в путь
sys.path.insert(0, str(Path(__file__).parent.parent))

from browser_controller import BrowserController
from screen_manager import ScreenManager
from user_activity_detector import UserActivityDetector

logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

async def test_browser_yandex():
    """Тест открытия Яндекс.Браузера с новым окном"""
    print("\n" + "="*60)
    print("🧪 ТЕСТ 1: Яндекс.Браузер + новое окно")
    print("="*60)
    
    # Инициализация с Яндексом
    browser = BrowserController(browser="Yandex")
    
    print("\n1️⃣ Открываю Яндекс.Браузер на втором мониторе...")
    await browser.open_on_secondary_monitor()
    
    print("\n2️⃣ Переход на YouTube...")
    await browser.navigate_to("https://www.youtube.com")
    
    print("\n✅ Проверьте:")
    print("   - Яндекс.Браузер открыт на втором мониторе")
    print("   - Создано НОВОЕ окно (старые вкладки не тронуты)")
    print("   - YouTube загружен")
    
    await asyncio.sleep(3)

async def test_activity_detector():
    """Тест детектора активности"""
    print("\n" + "="*60)
    print("🧪 ТЕСТ 2: Детектор активности пользователя")
    print("="*60)
    
    detector = UserActivityDetector()
    
    print("\n1️⃣ Проверка текущей активности...")
    is_active = detector.is_user_active(check_duration=1.0)
    print(f"   Пользователь активен: {'✅ ДА' if is_active else '❌ НЕТ'}")
    
    print("\n2️⃣ Ожидание бездействия (2 секунды)...")
    print("   ПОДВИГАЙТЕ МЫШКОЙ — появится уведомление!")
    print("   Затем не двигайте 2 секунды.")
    
    success = detector.wait_for_idle(idle_seconds=2.0, show_notification=True)
    
    if success:
        print("   ✅ Дождались бездействия")
    else:
        print("   ⚠️ Таймаут ожидания")

async def test_screen_with_detector():
    """Тест кликов с ожиданием бездействия"""
    print("\n" + "="*60)
    print("🧪 ТЕСТ 3: Клики с детектором активности")
    print("="*60)
    
    # Включаем режим ожидания
    screen = ScreenManager(wait_for_user_idle=True)
    
    print("\n1️⃣ Попытка клика (с ожиданием бездействия)...")
    print("   ДВИГАЙТЕ МЫШКОЙ — увидите уведомление!")
    print("   Затем остановитесь на 2 секунды.")
    
    # Клик где-то в безопасном месте (правый нижний угол второго монитора)
    display = screen.get_secondary_monitor()
    safe_x = display['width'] - 100
    safe_y = display['height'] - 100
    
    screen.click_at(safe_x, safe_y)
    
    print("   ✅ Клик выполнен после ожидания")

async def test_monitor_detection():
    """Тест определения монитора курсора"""
    print("\n" + "="*60)
    print("🧪 ТЕСТ 4: Определение монитора курсора")
    print("="*60)
    
    screen = ScreenManager()
    detector = UserActivityDetector()
    
    print("\n📊 Информация о мониторах:")
    for i, display in enumerate(screen.displays):
        print(f"   Монитор {i}: {display['width']}x{display['height']} @ ({display['x']}, {display['y']})")
    
    print("\n🖱️ Позиция курсора:")
    monitor_index = detector.get_cursor_monitor_index(screen.displays)
    print(f"   Курсор на мониторе: {monitor_index}")
    
    is_secondary = detector.is_cursor_on_secondary_monitor(screen.displays, 1)
    print(f"   На втором мониторе: {'✅ ДА' if is_secondary else '❌ НЕТ (на первом)'}")
    
    print("\n💡 Подвигайте курсор между мониторами и запустите тест снова!")

async def main():
    print("\n" + "#"*60)
    print("🚀 ТЕСТИРОВАНИЕ ПАРАЛЛЕЛЬНОЙ РАБОТЫ")
    print("#"*60)
    
    choice = input("\nВыберите тест:\n"
                   "1 - Яндекс.Браузер + новое окно\n"
                   "2 - Детектор активности\n"
                   "3 - Клики с ожиданием\n"
                   "4 - Определение монитора\n"
                   "5 - Все тесты\n"
                   "Выбор: ")
    
    try:
        if choice == "1":
            await test_browser_yandex()
        elif choice == "2":
            await test_activity_detector()
        elif choice == "3":
            await test_screen_with_detector()
        elif choice == "4":
            await test_monitor_detection()
        elif choice == "5":
            await test_browser_yandex()
            await test_activity_detector()
            await test_screen_with_detector()
            await test_monitor_detection()
        else:
            print("❌ Неверный выбор")
            return
    except Exception as e:
        logging.error(f"Ошибка в тесте: {e}", exc_info=True)
    
    print("\n" + "#"*60)
    print("✨ ТЕСТИРОВАНИЕ ЗАВЕРШЕНО")
    print("#"*60)

if __name__ == '__main__':
    asyncio.run(main())
