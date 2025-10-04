import logging
import google.generativeai as genai
import config

logger = logging.getLogger(__name__)

class CommandInterpreter:
    """
    Интерпретатор голосовых команд:
    - Преобразует голос → текст (Gemini)
    - Анализирует команду → план действий (Gemini)
    """
    def __init__(self):
        genai.configure(api_key=config.GEMINI_API_KEY)
        self.model = genai.GenerativeModel('gemini-2.0-flash')
    
    async def understand_command(self, user_text: str) -> str:
        """
        Анализирует команду пользователя и возвращает структурированный план действий
        """
        prompt = f"""Ты - помощник, который анализирует команды пользователя для управления компьютером.

Пользователь сказал: "{user_text}"

Твоя задача - понять, что нужно сделать и описать это простым списком действий.

Примеры команд:
- "Включи первую серию третьего сезона Клинка рассекающего демона" → Открыть браузер, найти аниме "Клинок рассекающий демонов", выбрать 3 сезон, запустить 1 серию, развернуть на весь экран
- "Найди видео про котиков на YouTube" → Открыть YouTube, найти "котики", открыть первое видео
- "Открой Google" → Открыть браузер и перейти на google.com

Ответь КРАТКИМ списком действий (максимум 5 пунктов). Используй простые глаголы: открыть, найти, кликнуть, запустить."""

        try:
            response = self.model.generate_content(prompt)
            plan = response.text.strip()
            logger.info(f"Gemini план: {plan}")
            return plan
        except Exception as e:
            logger.error(f"Ошибка Gemini: {e}")
            raise
    
    async def voice_to_text(self, audio_path: str) -> str:
        """
        Конвертирует аудио в текст через Gemini
        """
        try:
            # Загружаем аудио файл
            audio_file = genai.upload_file(audio_path)
            
            prompt = "Преобразуй это голосовое сообщение в текст. Верни ТОЛЬКО текст без дополнительных комментариев."
            
            response = self.model.generate_content([prompt, audio_file])
            text = response.text.strip()
            
            logger.info(f"Распознанный текст: {text}")
            return text
            
        except Exception as e:
            logger.error(f"Ошибка распознавания речи: {e}")
            raise
