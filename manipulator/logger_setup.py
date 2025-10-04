"""
Система логирования с автоматической ротацией на 7 дней
Создает отдельный лог под каждую команду
Также очищает старые скриншоты (старше 1 дня)
"""
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
import hashlib

LOGS_DIR = 'logs'
LOG_RETENTION_DAYS = 7
SCREENSHOTS_RETENTION_DAYS = 1
SCREENSHOTS_DIRS = ['screenshots', 'test_screenshots']

# Создаем директории
os.makedirs(LOGS_DIR, exist_ok=True)


def cleanup_old_logs():
    """Удаляет логи старше 7 дней"""
    cutoff_date = datetime.now() - timedelta(days=LOG_RETENTION_DAYS)
    deleted_count = 0
    
    for log_file in Path(LOGS_DIR).glob('*.log'):
        # Пропускаем jarvis.log (главный лог)
        if log_file.name == 'jarvis.log':
            continue
            
        file_time = datetime.fromtimestamp(log_file.stat().st_mtime)
        if file_time < cutoff_date:
            log_file.unlink()
            deleted_count += 1
    
    if deleted_count > 0:
        print(f"🗑️  Удалено старых логов: {deleted_count}")


def cleanup_old_screenshots():
    """Удаляет скриншоты старше 1 дня"""
    cutoff_date = datetime.now() - timedelta(days=SCREENSHOTS_RETENTION_DAYS)
    deleted_count = 0
    
    for screenshots_dir in SCREENSHOTS_DIRS:
        if not os.path.exists(screenshots_dir):
            continue
            
        for screenshot_file in Path(screenshots_dir).glob('*.png'):
            file_time = datetime.fromtimestamp(screenshot_file.stat().st_mtime)
            if file_time < cutoff_date:
                screenshot_file.unlink()
                deleted_count += 1
    
    if deleted_count > 0:
        print(f"🗑️  Удалено старых скриншотов: {deleted_count}")


def setup_command_logger(command: str) -> logging.Logger:
    """
    Создает отдельный логгер для команды
    
    Args:
        command: Текст команды пользователя
        
    Returns:
        Logger с файловым хендлером
    """
    # Создаем безопасное имя файла из команды
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    command_hash = hashlib.md5(command.encode()).hexdigest()[:8]
    safe_name = ''.join(c if c.isalnum() or c in ' _-' else '_' for c in command[:30])
    
    log_filename = f"{timestamp}_{safe_name}_{command_hash}.log"
    log_path = os.path.join(LOGS_DIR, log_filename)
    
    # Создаем логгер
    logger = logging.getLogger(f"command_{command_hash}")
    logger.setLevel(logging.DEBUG)
    logger.propagate = False  # Не передаем в родительские логгеры
    
    # Удаляем старые хендлеры если есть
    logger.handlers.clear()
    
    # Файловый хендлер
    file_handler = logging.FileHandler(log_path, encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    
    # Формат лога
    formatter = logging.Formatter(
        '%(asctime)s | %(levelname)-8s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(formatter)
    
    logger.addHandler(file_handler)
    
    # Логируем начало команды
    logger.info("="*70)
    logger.info(f"КОМАНДА: {command}")
    logger.info("="*70)
    
    return logger


def setup_global_logger():
    """Настраивает глобальный логгер для всего приложения"""
    # Очищаем старые логи и скриншоты
    cleanup_old_logs()
    cleanup_old_screenshots()
    
    # Создаем глобальный лог (все в одном файле)
    global_log_path = os.path.join(LOGS_DIR, 'jarvis.log')
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s | %(levelname)-8s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
        handlers=[
            logging.FileHandler(global_log_path, encoding='utf-8'),
            logging.StreamHandler()  # Также выводим в консоль
        ]
    )
    
    return logging.getLogger('jarvis')
