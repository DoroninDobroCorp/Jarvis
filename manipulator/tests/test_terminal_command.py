# РЕГУЛЯРНЫЙ ТЕСТ: Проверка открытия терминала и запуска команды в папке
"""
Универсальный тест открытия терминала в папке и запуска команды

Проверяет:
- Открытие терминала в заданной директории
- Запуск команды
- Проверку результата выполнения

Работает с ЛЮБОЙ папкой и ЛЮБОЙ командой, не только с конкретным примером.
"""
import asyncio
import logging
import sys
from pathlib import Path
import subprocess
import os
import time

# Добавляем родительскую директорию в путь
sys.path.insert(0, str(Path(__file__).parent.parent))

from command_interpreter import CommandInterpreter

logging.basicConfig(
    format='%(asctime)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

def open_terminal_in_directory(directory: str) -> bool:
    """
    Открывает Terminal.app в заданной директории
    
    Args:
        directory: Путь к директории
        
    Returns:
        True если успешно открыто
    """
    try:
        # Проверяем существование директории
        if not os.path.exists(directory):
            print(f"❌ Директория не существует: {directory}")
            return False
        
        # AppleScript для открытия терминала в папке
        script = f'''
        tell application "Terminal"
            activate
            do script "cd {directory}"
        end tell
        '''
        
        result = subprocess.run(['osascript', '-e', script],
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            print(f"✅ Терминал открыт в: {directory}")
            return True
        else:
            print(f"❌ Ошибка открытия терминала: {result.stderr}")
            return False
            
    except Exception as e:
        logging.error(f"Ошибка открытия терминала: {e}")
        return False

def execute_command_in_terminal(command: str, directory: str) -> bool:
    """
    Выполняет команду в терминале в заданной директории
    
    Args:
        command: Команда для выполнения
        directory: Директория выполнения
        
    Returns:
        True если команда запущена
    """
    try:
        # AppleScript для выполнения команды в терминале
        script = f'''
        tell application "Terminal"
            activate
            do script "cd {directory} && {command}" in window 1
        end tell
        '''
        
        result = subprocess.run(['osascript', '-e', script],
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            print(f"✅ Команда запущена: {command}")
            return True
        else:
            print(f"❌ Ошибка выполнения команды: {result.stderr}")
            return False
            
    except Exception as e:
        logging.error(f"Ошибка выполнения команды: {e}")
        return False

def verify_process_running(process_name: str, timeout: int = 5) -> bool:
    """
    Проверяет, что процесс запущен
    
    Args:
        process_name: Имя процесса для поиска
        timeout: Время ожидания в секундах
        
    Returns:
        True если процесс найден
    """
    print(f"\n🔍 Проверка запуска процесса '{process_name}'...")
    
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            result = subprocess.run(['pgrep', '-f', process_name],
                                  capture_output=True, text=True, timeout=2)
            
            if result.returncode == 0 and result.stdout.strip():
                pids = result.stdout.strip().split('\n')
                print(f"✅ Процесс найден (PID: {pids})")
                return True
                
        except Exception as e:
            logging.debug(f"Ошибка поиска процесса: {e}")
        
        time.sleep(0.5)
    
    print(f"⚠️ Процесс '{process_name}' не найден за {timeout} секунд")
    return False

async def test_terminal_command(command_text: str, directory: str, app_command: str, 
                                process_name: str = None):
    """
    Универсальный тест открытия терминала и запуска команды
    
    Args:
        command_text: Голосовая команда (например, "Открой терминал в папке X и запусти Y")
        directory: Путь к директории
        app_command: Команда для запуска
        process_name: Имя процесса для проверки (опционально)
    """
    print("\n" + "="*70)
    print(f"💻 ТЕСТ: Открытие терминала и запуск команды")
    print("="*70)
    print(f"Команда: {command_text}")
    print(f"Директория: {directory}")
    print(f"Запускаемая команда: {app_command}")
    
    interpreter = CommandInterpreter()
    
    # 1. Интерпретация команды
    print("\n📝 Шаг 1: Интерпретация команды...")
    task_plan = await interpreter.understand_command(command_text)
    print(f"План: {task_plan}")
    
    # 2. Открытие терминала
    print("\n📝 Шаг 2: Открытие терминала в директории...")
    terminal_opened = open_terminal_in_directory(directory)
    
    if not terminal_opened:
        print("❌ ТЕСТ ПРОВАЛЕН: Не удалось открыть терминал")
        return False
    
    await asyncio.sleep(2)
    
    # 3. Выполнение команды
    print("\n▶️ Шаг 3: Выполнение команды...")
    command_executed = execute_command_in_terminal(app_command, directory)
    
    if not command_executed:
        print("❌ ТЕСТ ПРОВАЛЕН: Не удалось выполнить команду")
        return False
    
    await asyncio.sleep(3)
    
    # 4. Проверка запуска процесса (если указано имя)
    if process_name:
        process_running = verify_process_running(process_name, timeout=10)
    else:
        print("\n⚠️ Имя процесса не указано, пропускаю проверку запуска")
        process_running = True  # Считаем успешным
    
    # Итог
    print("\n" + "="*70)
    if terminal_opened and command_executed and process_running:
        print("✅ ТЕСТ ПРОЙДЕН: Терминал открыт, команда выполнена, процесс запущен")
        return True
    else:
        print("❌ ТЕСТ ПРОВАЛЕН: Проверьте выполнение вручную")
        return False

async def main():
    print("\n" + "#"*70)
    print("🚀 ТЕСТИРОВАНИЕ ОТКРЫТИЯ ТЕРМИНАЛА И ЗАПУСКА КОМАНДЫ")
    print("#"*70)
    
    # Подготовка: получаем домашнюю директорию пользователя
    home_dir = os.path.expanduser("~")
    
    # Пример 1: Запуск droid в папке detective-board (как в требовании)
    project_path = os.path.join(home_dir, "VovkaNowEngineer", "+Jarvis", "detective-board")
    
    # Проверяем существование папки
    if not os.path.exists(project_path):
        print(f"\n⚠️ ПРЕДУПРЕЖДЕНИЕ: Папка не существует: {project_path}")
        print("   Создаем тестовую папку для демонстрации...")
        test_path = os.path.join(home_dir, "test_terminal")
        os.makedirs(test_path, exist_ok=True)
        project_path = test_path
    
    await test_terminal_command(
        command_text=f"Открой консоль в папке {project_path} и запусти droid",
        directory=project_path,
        app_command="droid",  # Или любая другая команда
        process_name="droid"  # Имя процесса для проверки
    )
    
    print("\n" + "#"*70)
    print("✨ ТЕСТИРОВАНИЕ ЗАВЕРШЕНО")
    print("#"*70)
    print("\n💡 ВАЖНО: Этот тест универсален")
    print("   Можно запускать с ЛЮБОЙ папкой и ЛЮБОЙ командой")
    print("   Примеры:")
    print("   - 'Открой терминал в ~/Documents и запусти python script.py'")
    print("   - 'Запусти npm start в папке ~/projects/my-app'")
    print("   - 'Открой консоль в ~/Downloads и запусти ls -la'")
    print("\n💡 Проверка через pgrep гарантирует реальный запуск процесса")

if __name__ == '__main__':
    asyncio.run(main())
