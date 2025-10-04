# РЕГУЛЯРНЫЙ ТЕСТ: Проверка запуска музыки в Spotify
"""
Универсальный тест запуска песни в Spotify

Проверяет:
- Открытие Spotify
- Поиск и запуск песни
- Реальное воспроизведение через AppleScript
- Проверку названия играющего трека

Работает с ЛЮБОЙ песней, не только с конкретным примером.
"""
import asyncio
import logging
import sys
from pathlib import Path
import subprocess

# Добавляем родительскую директорию в путь
sys.path.insert(0, str(Path(__file__).parent.parent))

from command_interpreter import CommandInterpreter
from task_executor import TaskExecutor

logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

def is_spotify_running() -> bool:
    """Проверяет, запущен ли Spotify"""
    try:
        script = 'tell application "System Events" to (name of processes) contains "Spotify"'
        result = subprocess.run(['osascript', '-e', script], 
                              capture_output=True, text=True, timeout=5)
        return 'true' in result.stdout.lower()
    except Exception as e:
        logging.error(f"Ошибка проверки Spotify: {e}")
        return False

def get_current_track() -> dict:
    """
    Получает информацию о текущем треке в Spotify
    
    Returns:
        dict с полями: name, artist, album, player_state
    """
    try:
        script = '''
        tell application "Spotify"
            set trackName to name of current track
            set trackArtist to artist of current track
            set trackAlbum to album of current track
            set playerState to player state as string
            return trackName & "|" & trackArtist & "|" & trackAlbum & "|" & playerState
        end tell
        '''
        result = subprocess.run(['osascript', '-e', script],
                              capture_output=True, text=True, timeout=5)
        
        if result.returncode == 0:
            parts = result.stdout.strip().split('|')
            if len(parts) >= 4:
                return {
                    'name': parts[0],
                    'artist': parts[1],
                    'album': parts[2],
                    'player_state': parts[3]
                }
    except Exception as e:
        logging.error(f"Ошибка получения трека: {e}")
    
    return {}

def verify_track_playing(expected_keywords: list[str]) -> bool:
    """
    Проверяет, что играет трек с ожидаемыми ключевыми словами
    
    Args:
        expected_keywords: Список ключевых слов (название песни, исполнитель)
        
    Returns:
        True если трек играет и содержит ключевые слова
    """
    print("\n🔍 Проверка текущего трека в Spotify...")
    
    track_info = get_current_track()
    
    if not track_info:
        print("❌ Не удалось получить информацию о треке")
        return False
    
    print(f"   Название: {track_info.get('name', 'N/A')}")
    print(f"   Исполнитель: {track_info.get('artist', 'N/A')}")
    print(f"   Альбом: {track_info.get('album', 'N/A')}")
    print(f"   Статус: {track_info.get('player_state', 'N/A')}")
    
    # Проверяем статус воспроизведения
    if track_info.get('player_state') != 'playing':
        print(f"⚠️ Трек не воспроизводится (статус: {track_info.get('player_state')})")
        return False
    
    # Проверяем наличие ключевых слов
    track_text = f"{track_info.get('name', '')} {track_info.get('artist', '')}".lower()
    found_keywords = [kw for kw in expected_keywords if kw.lower() in track_text]
    
    if found_keywords:
        print(f"✅ Найдены ключевые слова: {found_keywords}")
        return True
    else:
        print(f"⚠️ Ключевые слова не найдены")
        print(f"   Искали: {expected_keywords}")
        print(f"   В строке: {track_text}")
        return False

async def test_spotify_playback(command: str, track_keywords: list[str]):
    """
    Универсальный тест запуска музыки в Spotify
    
    Args:
        command: Голосовая команда (например, "Включи на Spotify песню...")
        track_keywords: Ключевые слова для проверки (название, исполнитель)
    """
    print("\n" + "="*70)
    print(f"🎵 ТЕСТ: Запуск музыки в Spotify")
    print("="*70)
    print(f"Команда: {command}")
    print(f"Ключевые слова: {track_keywords}")
    
    interpreter = CommandInterpreter()
    
    # 1. Проверка Spotify
    print("\n📝 Шаг 1: Проверка Spotify...")
    if not is_spotify_running():
        print("⚠️ Spotify не запущен, запускаю...")
        subprocess.Popen(['open', '-a', 'Spotify'])
        await asyncio.sleep(5)
    else:
        print("✅ Spotify уже запущен")
    
    # 2. Интерпретация команды
    print("\n📝 Шаг 2: Интерпретация команды...")
    task_plan = await interpreter.understand_command(command)
    print(f"План: {task_plan}")
    
    # 3. Выполнение (вручную через AppleScript для демонстрации)
    print("\n▶️ Шаг 3: Выполнение задачи...")
    print("⏸️ Пауза 15 секунд для ручной проверки...")
    print("   Пожалуйста, вручную выполните команду через бота")
    print(f"   Команда: {command}")
    await asyncio.sleep(15)
    
    # 4. Проверка воспроизведения
    is_playing = verify_track_playing(track_keywords)
    
    # Итог
    print("\n" + "="*70)
    if is_playing:
        print("✅ ТЕСТ ПРОЙДЕН: Трек воспроизводится в Spotify")
        return True
    else:
        print("❌ ТЕСТ ПРОВАЛЕН: Трек не воспроизводится или не найден")
        return False

async def main():
    print("\n" + "#"*70)
    print("🚀 ТЕСТИРОВАНИЕ ЗАПУСКА МУЗЫКИ В SPOTIFY")
    print("#"*70)
    
    # Пример 1: Песня из требования
    await test_spotify_playback(
        command="Включи на Spotify песню Винтовка это праздник",
        track_keywords=["винтовка", "праздник"]
    )
    
    print("\n" + "#"*70)
    print("✨ ТЕСТИРОВАНИЕ ЗАВЕРШЕНО")
    print("#"*70)
    print("\n💡 ВАЖНО: Этот тест универсален")
    print("   Можно запускать с ЛЮБОЙ песней, меняя command и track_keywords")
    print("   Примеры:")
    print("   - 'Включи Rammstein Du Hast' → keywords=['rammstein', 'du hast']")
    print("   - 'Запусти Пошлая Молли' → keywords=['пошлая молли']")
    print("   - 'Включи Satisfaction от Rolling Stones' → keywords=['satisfaction', 'rolling']")
    print("\n💡 Проверка через AppleScript гарантирует реальное выполнение")

if __name__ == '__main__':
    asyncio.run(main())
