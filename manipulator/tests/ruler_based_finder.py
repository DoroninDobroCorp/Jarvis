#!/usr/bin/env python3
"""
Поиск координат через итеративное уточнение с линейками
Подход: спросить координаты -> нарисовать точку + линейки -> спросить как корректировать
"""
import google.generativeai as genai
from PIL import Image, ImageDraw, ImageFont
import subprocess
import re
import sys
from pathlib import Path
from datetime import datetime

# Добавляем путь к config
sys.path.insert(0, str(Path(__file__).parent.parent))
import config

# Настройка Gemini
genai.configure(api_key=config.GEMINI_API_KEY)

# Глобальный файл лога
LOG_FILE = None


def init_log():
    """Инициализация файла лога"""
    global LOG_FILE
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_path = f'logs/ruler_finder_{timestamp}.log'
    Path('logs').mkdir(exist_ok=True)
    LOG_FILE = open(log_path, 'w', encoding='utf-8')
    log(f'=== НАЧАЛО ЛОГА {timestamp} ===\n')
    return log_path


def log(message):
    """Запись в лог и вывод на экран"""
    print(message)
    if LOG_FILE:
        LOG_FILE.write(message + '\n')
        LOG_FILE.flush()


def close_log():
    """Закрытие файла лога"""
    if LOG_FILE:
        log('\n=== КОНЕЦ ЛОГА ===')
        LOG_FILE.close()


def ask_gemini_coordinates(img):
    """
    Спрашивает Gemini координаты кнопки БЕЗ сетки
    
    Returns:
        (x, y) или None
    """
    width, height = img.size
    
    prompt = f'''На изображении размером {width}x{height} пикселей найди кнопку "+добавить в избранное" из Spotify.

ВАЖНО: 
- Координата (0, 0) находится в ЛЕВОМ ВЕРХНЕМ углу
- X увеличивается ВПРАВО (от 0 до {width})
- Y увеличивается ВНИЗ (от 0 до {height})

ОТВЕТЬ СТРОГО в формате:
Координаты: X Y
Описание: где находится кнопка

Пример:
Координаты: 520 1650
Описание: белый плюсик в сером круге справа от названия трека в плеере внизу'''

    log('📝 ПРОМПТ (запрос координат):')
    log('=' * 80)
    log(prompt)
    log('=' * 80)
    log('')

    model = genai.GenerativeModel('gemini-2.5-pro')  # НЕ 2.0!
    response = model.generate_content([prompt, img])
    
    answer = response.text.strip()
    log(f"📥 Ответ Gemini:\n{answer}\n")
    
    # Парсим координаты
    coords_match = re.search(r'Координаты:\s*(\d+)\s+(\d+)', answer)
    if coords_match:
        x = int(coords_match.group(1))
        y = int(coords_match.group(2))
        return (x, y)
    
    log('❌ Не удалось распарсить координаты')
    return None


def draw_point_with_rulers(img, x, y, point_radius=8, crop_size=500, zoom_factor=3):
    """
    Вырезает область вокруг точки, УВЕЛИЧИВАЕТ, затем рисует линейки рядом с точкой
    
    Args:
        img: PIL Image (полный экран)
        x, y: координаты точки на полном экране
        point_radius: радиус точки НА УВЕЛИЧЕННОМ изображении (маленькая 8px)
        crop_size: размер вырезаемой области вокруг точки (500 = 1000x1000px)
        zoom_factor: во сколько раз увеличить (3 = 1500x1500px)
    
    Returns:
        PIL Image с точкой и линейками (увеличенный фрагмент)
    """
    # 1. ВЫРЕЗАЕМ область вокруг точки
    width, height = img.size
    crop_x1 = max(0, x - crop_size)
    crop_y1 = max(0, y - crop_size)
    crop_x2 = min(width, x + crop_size)
    crop_y2 = min(height, y + crop_size)
    
    cropped = img.crop((crop_x1, crop_y1, crop_x2, crop_y2))
    crop_w, crop_h = cropped.size
    
    # Координаты точки на вырезе (ДО увеличения)
    local_x = x - crop_x1
    local_y = y - crop_y1
    
    # 2. УВЕЛИЧИВАЕМ изображение СНАЧАЛА
    zoomed_w = crop_w * zoom_factor
    zoomed_h = crop_h * zoom_factor
    zoomed = cropped.resize((zoomed_w, zoomed_h), Image.Resampling.LANCZOS)
    
    # Координаты точки на увеличенном изображении
    zoomed_x = local_x * zoom_factor
    zoomed_y = local_y * zoom_factor
    
    # 3. Рисуем НА УВЕЛИЧЕННОМ изображении
    draw = ImageDraw.Draw(zoomed)
    
    # Рисуем КРАСНУЮ точку
    draw.ellipse([zoomed_x - point_radius, zoomed_y - point_radius, 
                 zoomed_x + point_radius, zoomed_y + point_radius],
                fill='red', outline='white', width=4)
    
    # 4. ЛИНЕЙКИ РЯДОМ с точкой (0,0) = точка
    # Линейки показывают РЕАЛЬНЫЕ пиксели смещения на оригинале
    
    # ГОРИЗОНТАЛЬНАЯ линейка (РЯДОМ с точкой, не через неё)
    ruler_h_offset = 50  # Отступ от точки
    ruler_h_y = zoomed_y + ruler_h_offset
    
    # Линия линейки (через всю ширину)
    draw.line([(0, ruler_h_y), (zoomed_w, ruler_h_y)], 
              fill='yellow', width=4)
    
    # Метки: -250 до +250 (каждые 10px реальных)
    for real_offset in range(-crop_size, crop_size + 1, 10):
        # Позиция на увеличенном изображении
        tick_x = zoomed_x + (real_offset * zoom_factor)
        if tick_x < 0 or tick_x > zoomed_w:
            continue
            
        tick_y = ruler_h_y
        
        # Каждые 50px - длинная метка с подписью
        if real_offset % 50 == 0:
            draw.line([(tick_x, tick_y - 20), (tick_x, tick_y + 20)], fill='yellow', width=4)
            label = f"{real_offset:+d}" if real_offset != 0 else "0"
            # КРУПНЫЙ шрифт для увеличенного изображения
            # Размещаем подписи над/под линейкой в зависимости от положения
            text_y = tick_y + 30 if tick_y < zoomed_h / 2 else tick_y - 45
            draw.text((tick_x - 25, text_y), label, fill='yellow', font=None)
        else:
            # Короткая метка (каждые 10px)
            draw.line([(tick_x, tick_y - 10), (tick_x, tick_y + 10)], fill='yellow', width=3)
    
    # ВЕРТИКАЛЬНАЯ линейка (РЯДОМ с точкой)
    ruler_v_offset = 50  # Отступ от точки
    ruler_v_x = zoomed_x + ruler_v_offset
    
    # Линия линейки (через всю высоту)
    draw.line([(ruler_v_x, 0), (ruler_v_x, zoomed_h)], 
              fill='cyan', width=4)
    
    # Метки: -250 до +250 (каждые 10px реальных)
    for real_offset in range(-crop_size, crop_size + 1, 10):
        # Позиция на увеличенном изображении
        tick_y = zoomed_y + (real_offset * zoom_factor)
        if tick_y < 0 or tick_y > zoomed_h:
            continue
            
        tick_x = ruler_v_x
        
        # Каждые 50px - длинная метка с подписью
        if real_offset % 50 == 0:
            draw.line([(tick_x - 20, tick_y), (tick_x + 20, tick_y)], fill='cyan', width=4)
            label = f"{real_offset:+d}" if real_offset != 0 else "0"
            # КРУПНЫЙ шрифт для увеличенного изображения
            # Размещаем подписи слева/справа в зависимости от положения
            text_x = tick_x + 30 if tick_x < zoomed_w / 2 else tick_x - 70
            draw.text((text_x, tick_y - 12), label, fill='cyan', font=None)
        else:
            # Короткая метка (каждые 10px)
            draw.line([(tick_x - 10, tick_y), (tick_x + 10, tick_y)], fill='cyan', width=3)
    
    # Инфо в углу
    draw.text((10, 10), f"Координаты: ({x}, {y})", fill='white')
    draw.text((10, 35), f"Увеличение: x{zoom_factor}", fill='white')
    draw.text((10, 60), f"Линейки: пиксели на оригинале", fill='white')
    draw.text((10, 85), f"Точка (0,0) = красная точка", fill='white')
    
    return zoomed


def ask_gemini_verify(img_with_point, current_x, current_y):
    """
    Спрашивает Gemini верна ли точка, если нет - как корректировать
    
    Returns:
        dict: {
            'correct': bool,
            'delta_x': int,  # на сколько двигать по X (+ вправо, - влево)
            'delta_y': int   # на сколько двигать по Y (+ вниз, - вверх)
        }
    """
    width, height = img_with_point.size
    
    prompt = f'''На изображении показан УВЕЛИЧЕННЫЙ ФРАГМЕНТ экрана (500x500px увеличен в 3 раза до {width}x{height}px).

КРАСНАЯ ТОЧКА с координатами ({current_x}, {current_y}).

ЛИНЕЙКИ РЯДОМ С ТОЧКОЙ:
- ЖЕЛТАЯ горизонтальная линейка НИЖЕ красной точки (0 на линейке)
- ГОЛУБАЯ вертикальная линейка СПРАВА от красной точки (0 на линейке)
- Отрицательные значения: СЛЕВА и ВЫШЕ точки (0)
- Положительные значения: СПРАВА и НИЖЕ точки (0)
- Длинные метки через каждые 50 РЕАЛЬНЫХ пикселей (с подписями)
- Короткие метки через каждые 10 РЕАЛЬНЫХ пикселей

⚠️ ВАЖНО: Линейки показывают РЕАЛЬНЫЕ пиксели на оригинальном экране!

ЗАДАЧА: Ты УВЕРЕН, что клик по координатам ({current_x}, {current_y}) активирует кнопку "+добавить в избранное" из Spotify (белый плюсик в сером круге)?

🎯 ТВОЯ ЗАДАЧА:
1. Найди кнопку "+добавить в избранное" (белый плюс в сером круге)
2. Оцени: ГАРАНТИРУЕТ ли клик по КРАСНОЙ ТОЧКЕ активацию кнопки?
3. Если НЕТ - используй ЛИНЕЙКИ для точного измерения сдвига

📍 ПРАВИЛА СДВИГА (используй линейки):
- Кнопка СПРАВА от точки → Сдвиг X: ПОЛОЖИТЕЛЬНЫЙ (+)
- Кнопка СЛЕВА от точки → Сдвиг X: ОТРИЦАТЕЛЬНЫЙ (-)
- Кнопка НИЖЕ точки → Сдвиг Y: ПОЛОЖИТЕЛЬНЫЙ (+)
- Кнопка ВЫШЕ точки → Сдвиг Y: ОТРИЦАТЕЛЬНЫЙ (-)

Пример: чтобы попасть в кнопку, нужно сдвинуть точку на 15px ВПРАВО и 5px ВВЕРХ → Сдвиг X: +15, Сдвиг Y: -5

⚠️ ВАЖНО:
- Линейки калиброваны точно - "+20" = ровно 20 пикселей
- Клик должен ГАРАНТИРОВАННО активировать кнопку
- Используй линейки для точного измерения

ОТВЕТЬ СТРОГО в одном из форматов:

1) Если ты УВЕРЕН, что клик по точке активирует кнопку:
Точка: ВЕРНА

2) Если НЕ УВЕРЕН или точка явно промахивается, укажи КОРРЕКЦИЮ:
Точка: НЕ ВЕРНА
Сдвиг X: [число]  (по желтой линейке)
Сдвиг Y: [число]  (по голубой линейке)
Объяснение: где находится кнопка по линейкам

Примеры:
Точка: ВЕРНА

или

Точка: НЕ ВЕРНА
Сдвиг X: 18
Сдвиг Y: -7
Объяснение: кнопка на "+18" (желтая) и "-7" (голубая)'''

    log('📝 ПРОМПТ (проверка точки):')
    log('=' * 80)
    log(prompt)
    log('=' * 80)
    log('')

    model = genai.GenerativeModel('gemini-2.5-pro')  # НЕ 2.0!
    response = model.generate_content([prompt, img_with_point])
    
    answer = response.text.strip()
    log(f"📥 Ответ Gemini:\n{answer}\n")
    
    result = {}
    
    # Проверяем на "ВЕРНА"
    if 'ВЕРНА' in answer and 'НЕ ВЕРНА' not in answer:
        result['correct'] = True
        result['delta_x'] = 0
        result['delta_y'] = 0
        return result
    
    result['correct'] = False
    
    # Парсим сдвиги
    x_match = re.search(r'Сдвиг X:\s*([+-]?\d+)', answer)
    y_match = re.search(r'Сдвиг Y:\s*([+-]?\d+)', answer)
    
    if x_match and y_match:
        result['delta_x'] = int(x_match.group(1))
        result['delta_y'] = int(y_match.group(1))
    else:
        log('❌ Не удалось распарсить сдвиги')
        return None
    
    return result


def iterative_refinement(screenshot_path, max_iterations=10):
    """
    Итеративное уточнение координат с помощью линеек
    
    Returns:
        (x, y) координаты или None
    """
    # Инициализация лога
    log_path = init_log()
    
    log('🎯 ПОИСК КООРДИНАТ С ЛИНЕЙКАМИ')
    log('=' * 80)
    log(f'Модель: gemini-2.5-pro (НЕ 2.0!)')
    log(f'Макс итераций: {max_iterations}')
    log(f'📝 Лог сохраняется в: {log_path}')
    log('')
    
    # Загружаем оригинал
    original = Image.open(screenshot_path).convert('RGB')
    width, height = original.size
    log(f'📐 Размер экрана: {width}x{height}')
    log('')
    
    # ШАГ 1: Спросить начальные координаты
    log('=' * 80)
    log('ШАГ 1: ЗАПРОС НАЧАЛЬНЫХ КООРДИНАТ')
    log('=' * 80)
    coords = ask_gemini_coordinates(original)
    
    if not coords:
        close_log()
        return None
    
    current_x, current_y = coords
    log(f'✅ Начальные координаты: ({current_x}, {current_y})')
    log('')
    
    # ШАГ 2: Итеративное уточнение
    iteration = 1
    
    while iteration <= max_iterations:
        log('=' * 80)
        log(f'ШАГ {iteration + 1}: ПРОВЕРКА И КОРРЕКЦИЯ')
        log('=' * 80)
        log(f'Текущие координаты: ({current_x}, {current_y})')
        
        # Рисуем точку + линейки
        img_with_point = draw_point_with_rulers(original, current_x, current_y)
        
        # Сохраняем
        iter_path = f'screenshots/ruler_iter{iteration}.png'
        img_with_point.save(iter_path)
        log(f'✅ Изображение: {iter_path}')
        subprocess.run(['open', iter_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        # Спрашиваем Gemini
        result = ask_gemini_verify(img_with_point, current_x, current_y)
        
        if not result:
            log('❌ Ошибка парсинга ответа')
            close_log()
            return None
        
        # Проверяем результат
        if result['correct']:
            log('')
            log('=' * 80)
            log('🎉 ТОЧКА ПОДТВЕРЖДЕНА!')
            log('=' * 80)
            close_log()
            return (current_x, current_y)
        
        # Применяем коррекцию
        delta_x = result['delta_x']
        delta_y = result['delta_y']
        
        log(f'📍 Коррекция: X{delta_x:+d}, Y{delta_y:+d}')
        
        current_x += delta_x
        current_y += delta_y
        
        # Ограничиваем координаты размером экрана
        current_x = max(0, min(width, current_x))
        current_y = max(0, min(height, current_y))
        
        log(f'➡️  Новые координаты: ({current_x}, {current_y})')
        log('')
        
        iteration += 1
    
    # Макс итераций достигнуто
    log('=' * 80)
    log('⚠️  ДОСТИГНУТО МАКСИМУМ ИТЕРАЦИЙ')
    log('=' * 80)
    close_log()
    return (current_x, current_y)


if __name__ == '__main__':
    # Тест
    screenshot = 'screenshots/screenshot_1759682765.png'
    
    result = iterative_refinement(screenshot, max_iterations=10)
    
    if result:
        x, y = result
        print()
        print('🎯 ФИНАЛЬНЫЕ КООРДИНАТЫ:')
        print(f'   X = {x}')
        print(f'   Y = {y}')
        print()
        print('✅ Готово!')
        print(f'📝 Полный лог сохранен в logs/ruler_finder_*.log')
    else:
        print()
        print('❌ Не удалось найти координаты')
