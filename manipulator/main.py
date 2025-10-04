import logging
from telegram_bot import JarvisBot
from logger_setup import setup_global_logger

# Настраиваем логирование с ротацией
logger = setup_global_logger()

if __name__ == '__main__':
    logger.info("🚀 Запуск Jarvis...")
    logger.info("📁 Логи сохраняются в logs/ (автоочистка через 7 дней)")
    bot = JarvisBot()
    bot.run()
