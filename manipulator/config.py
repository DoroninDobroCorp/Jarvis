import os
from dotenv import load_dotenv

load_dotenv()

# Telegram
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')

# Gemini
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

# Monitor settings
SECONDARY_MONITOR_INDEX = int(os.getenv('SECONDARY_MONITOR_INDEX', '1'))

# Browser settings
DEFAULT_BROWSER = os.getenv('DEFAULT_BROWSER', 'Yandex')  # Yandex, Safari, Chrome
WAIT_FOR_USER_IDLE = os.getenv('WAIT_FOR_USER_IDLE', 'True').lower() in ('true', '1', 'yes')

# Paths
TEMP_DIR = 'temp'
SCREENSHOTS_DIR = 'screenshots'

# Создаем директории если их нет
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
