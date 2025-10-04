import os
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

import config
from command_interpreter import CommandInterpreter
from task_executor import TaskExecutor
from logger_setup import setup_command_logger

logger = logging.getLogger(__name__)

class JarvisBot:
    def __init__(self):
        self.app = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()
        self.command_interpreter = CommandInterpreter()
        self.executor = TaskExecutor()
        
        # Handlers
        self.app.add_handler(CommandHandler("start", self.start))
        self.app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.handle_text))
        self.app.add_handler(MessageHandler(filters.VOICE, self.handle_voice))
        
    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text(
            "👋 Привет! Я Jarvis - твой голосовой помощник.\n\n"
            "Отправь мне голосовое сообщение или текст с командой, и я выполню её на втором мониторе.\n\n"
            "Пример: 'Включи нам первую серию третьего сезона Клинка рассекающего демона'"
        )
    
    async def handle_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработка текстовых сообщений"""
        user_text = update.message.text
        logger.info(f"📝 Получен текст: {user_text}")
        
        # Создаем отдельный лог для этой команды
        cmd_logger = setup_command_logger(user_text)
        cmd_logger.info(f"Пользователь: {update.effective_user.username or update.effective_user.id}")
        
        await update.message.reply_text("🤔 Анализирую запрос...")
        
        try:
            # Отправляем в Gemini для понимания
            cmd_logger.info("Отправка команды в Gemini для понимания...")
            task_plan = await self.command_interpreter.understand_command(user_text)
            cmd_logger.info(f"План от Gemini: {task_plan}")
            
            await update.message.reply_text(f"✅ Понял! Выполняю:\n{task_plan}")
            
            # Выполняем задачу
            cmd_logger.info("Начало выполнения задачи...")
            result = await self.executor.execute(task_plan, update)
            cmd_logger.info(f"Результат выполнения: {result}")
            
            await update.message.reply_text(f"✨ Готово!\n{result}")
            cmd_logger.info("Команда выполнена успешно")
            
        except Exception as e:
            logger.error(f"Ошибка обработки текста: {e}", exc_info=True)
            cmd_logger.error(f"ОШИБКА: {e}", exc_info=True)
            await update.message.reply_text(f"❌ Ошибка: {str(e)}")
    
    async def handle_voice(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработка голосовых сообщений"""
        logger.info("🎤 Получено голосовое сообщение")
        
        # Создаем лог (текст команды узнаем после распознавания)
        cmd_logger = setup_command_logger("voice_message")
        cmd_logger.info(f"Пользователь: {update.effective_user.username or update.effective_user.id}")
        
        await update.message.reply_text("🎧 Слушаю...")
        
        try:
            # Скачиваем голосовое сообщение
            voice_file = await update.message.voice.get_file()
            voice_path = os.path.join(config.TEMP_DIR, f"voice_{update.message.message_id}.ogg")
            await voice_file.download_to_drive(voice_path)
            cmd_logger.info(f"Голосовое сообщение сохранено: {voice_path}")
            
            # Конвертируем в текст через Gemini (он умеет работать с аудио)
            text = await self.command_interpreter.voice_to_text(voice_path)
            logger.info(f"📝 Распознан текст: {text}")
            cmd_logger.info(f"Распознанный текст: {text}")
            
            # Удаляем временный файл
            os.remove(voice_path)
            
            await update.message.reply_text(f"📝 Распознал: '{text}'\n\n🤔 Анализирую...")
            
            # Обрабатываем как текст
            task_plan = await self.command_interpreter.understand_command(text)
            cmd_logger.info(f"План от Gemini: {task_plan}")
            await update.message.reply_text(f"✅ План действий:\n{task_plan}")
            
            # Выполняем
            cmd_logger.info("Начало выполнения задачи...")
            result = await self.executor.execute(task_plan, update)
            cmd_logger.info(f"Результат выполнения: {result}")
            await update.message.reply_text(f"✨ Готово!\n{result}")
            cmd_logger.info("Команда выполнена успешно")
            
        except Exception as e:
            logger.error(f"Ошибка обработки голоса: {e}", exc_info=True)
            cmd_logger.error(f"ОШИБКА: {e}", exc_info=True)
            await update.message.reply_text(f"❌ Ошибка: {str(e)}")
    
    def run(self):
        """Запуск бота"""
        logger.info("🤖 Бот запущен и готов к работе!")
        self.app.run_polling(allowed_updates=Update.ALL_TYPES)
