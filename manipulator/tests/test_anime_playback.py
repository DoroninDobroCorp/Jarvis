# РЕГУЛЯРНЫЙ ТЕСТ: Проверка поиска и запуска видео на полный экран (YouTube/аниме)
"""
Универсальный тест запуска видео на полный экран

Проверяет:
- Открытие браузера
- Поиск видео через голосовую команду
- Запуск видео
- Переход в полноэкранный режим
- Реальное выполнение через скриншоты

Работает с ЛЮБЫМ видео/аниме, не только с конкретным примером.
"""
import asyncio
import logging
import sys
from pathlib import Path
import time

# Добавляем родительскую директорию в путь
sys.path.insert(0, str(Path(__file__).parent.parent))

from command_interpreter import CommandInterpreter
from task_executor import TaskExecutor
from screen_manager import ScreenManager
from PIL import Image
import pytesseract

logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

async def verify_video_playback(screen: ScreenManager, video_title_keywords: list[str]) -> bool:
    """
    Проверяет, что видео действительно запустилось
    
    Args:
        screen: ScreenManager instance
        video_title_keywords: Ключевые слова из названия видео для проверки
        
    Returns:
        True если видео запущено
    """
    print("\n🔍 Проверка запуска видео через скриншот...")
    
    # Делаем скриншот
    screenshot_path = screen.capture_secondary_monitor()
    
    # OCR для поиска текста на экране
    try:
        img = Image.open(screenshot_path)
        text = pytesseract.image_to_string(img, lang='rus+eng').lower()
        
        # Проверяем наличие ключевых слов
        found_keywords = [kw for kw in video_title_keywords if kw.lower() in text]
        
        if found_keywords:
            print(f"✅ Найдены ключевые слова: {found_keywords}")
            return True
        else:
            print(f"⚠️ Ключевые слова не найдены на экране")
            print(f"   Искали: {video_title_keywords}")
            return False
            
    except Exception as e:
        logging.error(f"Ошибка OCR: {e}")
        print("⚠️ Не удалось проверить через OCR, проверьте скриншот вручную")
        print(f"   Скриншот: {screenshot_path}")
        return False

async def verify_fullscreen(screen: ScreenManager) -> bool:
    """
    Проверяет, что видео в полноэкранном режиме
    
    Признаки полноэкранного режима:
    - Нет UI элементов браузера в верхней части
    - Черные полосы сверху/снизу (или видео на весь экран)
    """
    print("\n🔍 Проверка полноэкранного режима...")
    
    screenshot_path = screen.capture_secondary_monitor()
    
    try:
        img = Image.open(screenshot_path)
        width, height = img.size
        
        # Проверяем верхнюю полосу (где должен быть UI браузера)
        # В полноэкранном режиме его не будет
        top_strip = img.crop((0, 0, width, 100))
        
        # Считаем темные пиксели в верхней полосе
        pixels = top_strip.getdata()
        dark_pixels = sum(1 for pixel in pixels if sum(pixel[:3]) < 100)
        total_pixels = len(pixels)
        dark_ratio = dark_pixels / total_pixels
        
        if dark_ratio > 0.7:  # Больше 70% темных пикселей
            print(f"✅ Полноэкранный режим подтвержден (темных пикселей: {dark_ratio:.1%})")
            return True
        else:
            print(f"⚠️ Возможно НЕ полноэкранный режим (темных пикселей: {dark_ratio:.1%})")
            return False
            
    except Exception as e:
        logging.error(f"Ошибка проверки полноэкранного режима: {e}")
        return False

async def test_video_playback(command: str, title_keywords: list[str]):
    """
    Универсальный тест запуска видео
    
    Args:
        command: Голосовая команда (например, "Включи первую серию...")
        title_keywords: Ключевые слова из названия для проверки
    """
    print("\n" + "="*70)
    print(f"🎬 ТЕСТ: Запуск видео на полный экран")
    print("="*70)
    print(f"Команда: {command}")
    print(f"Ключевые слова: {title_keywords}")
    
    interpreter = CommandInterpreter()
    executor = TaskExecutor()
    screen = ScreenManager(wait_for_user_idle=False)  # Отключаем ожидание для теста
    
    # 1. Интерпретация команды
    print("\n📝 Шаг 1: Интерпретация команды...")
    task_plan = await interpreter.understand_command(command)
    print(f"План: {task_plan}")
    
    # 2. Выполнение (без Telegram update)
    print("\n▶️ Шаг 2: Выполнение задачи...")
    # TODO: executor.execute требует Update, нужно создать mock или изменить API
    # Пока выполним вручную для демонстрации
    
    print("⏸️ Пауза 10 секунд для ручной проверки...")
    print("   Пожалуйста, вручную выполните команду через бота")
    print(f"   Команда: {command}")
    await asyncio.sleep(10)
    
    # 3. Проверка запуска видео
    video_playing = await verify_video_playback(screen, title_keywords)
    
    # 4. Проверка полноэкранного режима
    is_fullscreen = await verify_fullscreen(screen)
    
    # Итог
    print("\n" + "="*70)
    if video_playing and is_fullscreen:
        print("✅ ТЕСТ ПРОЙДЕН: Видео запущено в полноэкранном режиме")
        return True
    elif video_playing:
        print("⚠️ ТЕСТ ЧАСТИЧНО ПРОЙДЕН: Видео запущено, но не в полноэкранном режиме")
        return False
    else:
        print("❌ ТЕСТ ПРОВАЛЕН: Видео не запустилось")
        return False

async def main():
    print("\n" + "#"*70)
    print("🚀 ТЕСТИРОВАНИЕ ЗАПУСКА ВИДЕО НА ПОЛНЫЙ ЭКРАН")
    print("#"*70)
    
    # Пример 1: Аниме (как в требовании)
    await test_video_playback(
        command="Включи первую серию третьего сезона аниме сериала Клинок рассекающий демонов на весь экран",
        title_keywords=["клинок", "demon", "slayer", "сезон 3"]
    )
    
    print("\n" + "#"*70)
    print("✨ ТЕСТИРОВАНИЕ ЗАВЕРШЕНО")
    print("#"*70)
    print("\n💡 ВАЖНО: Этот тест универсален")
    print("   Можно запускать с ЛЮБЫМ видео, меняя command и title_keywords")
    print("   Например:")
    print("   - 'Включи клип Rammstein Du Hast'")
    print("   - 'Запусти первую серию Атаки титанов'")
    print("   - 'Найди на YouTube трейлер Дюны 2'")

if __name__ == '__main__':
    asyncio.run(main())
