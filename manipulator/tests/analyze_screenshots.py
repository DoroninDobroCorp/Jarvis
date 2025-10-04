"""
Анализ скриншотов через Gemini Vision
"""
import os
import sys
from pathlib import Path

# Добавляем родительскую директорию в путь
sys.path.insert(0, str(Path(__file__).parent.parent))

import google.generativeai as genai
from config import GEMINI_API_KEY

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.0-flash')

screenshots_dir = "screenshots"

# Получаем последние 3 скриншота
screenshots = sorted([f for f in os.listdir(screenshots_dir) if f.endswith('.png')])[-3:]

print("="*70)
print("🔍 АНАЛИЗ ПОСЛЕДНИХ СКРИНШОТОВ")
print("="*70)

for i, screenshot_name in enumerate(screenshots, 1):
    path = os.path.join(screenshots_dir, screenshot_name)
    
    print(f"\n{i}. {screenshot_name}")
    print("-"*70)
    
    # Загружаем изображение
    img_file = genai.upload_file(path)
    
    prompt = """Опиши что ты видишь на этом скриншоте.

Ответь на вопросы:
1. Какое приложение открыто?
2. Какой сайт/страница отображается?
3. Что находится по центру экрана?
4. Есть ли поисковая строка? Если да, где?
5. Что пользователь может сделать дальше?

Будь конкретным и кратким."""
    
    response = model.generate_content([prompt, img_file])
    analysis = response.text.strip()
    
    print(analysis)
    print()

print("="*70)
