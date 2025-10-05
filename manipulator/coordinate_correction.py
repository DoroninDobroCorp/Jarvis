"""
Корректировка координат для Retina displays
Основано на логике из color_pipette.py
"""
import subprocess
from PIL import Image
import pyautogui


def get_display_scale(display_info: dict, screenshot_path: str = None) -> float:
    """
    Определяет scale factor для монитора
    
    ПРОВЕРЕННАЯ ЛОГИКА из color_pipette.py:
    - screencapture возвращает ФИЗИЧЕСКОЕ разрешение
    - Вычисляем scale = physical / logical
    - Например: 2880x1800 / 1440x900 = 2.0 для Retina
    
    Args:
        display_info: dict с ключами x, y, width, height (ЛОГИЧЕСКОЕ разрешение)
        screenshot_path: путь к скриншоту (ФИЗИЧЕСКОЕ разрешение)
        
    Returns:
        float: scale factor (1.0 или 2.0)
    """
    # Метод 1: ТОЧНОЕ определение по размеру скриншота (как в color_pipette.py)
    if screenshot_path:
        try:
            img = Image.open(screenshot_path)
            scale_x = img.width / float(display_info['width'])
            scale_y = img.height / float(display_info['height'])
            # Берем максимальный (обычно одинаковые)
            scale = max(scale_x, scale_y)
            # Округляем до ближайшего целого
            result = round(scale)
            
            import logging
            logging.debug(f"📐 Scale: screenshot={img.width}x{img.height}, "
                         f"display={display_info['width']}x{display_info['height']}, "
                         f"calculated={scale:.2f}, rounded={result}")
            return result
        except Exception as e:
            import logging
            logging.warning(f"Не удалось определить scale: {e}")
    
    # Метод 2: Эвристика (fallback)
    # MacBook обычно Retina (width < 1920), внешние мониторы обычно нет
    width = display_info['width']
    if width < 1920:
        return 2.0  # Вероятно Retina
    else:
        return 1.0  # Вероятно обычный монитор


def logical_to_screenshot_coords(x: float, y: float, scale: float) -> tuple:
    """
    Преобразует логические координаты в координаты скриншота
    (для Retina: умножаем на 2)
    
    Args:
        x, y: логические координаты
        scale: scale factor (1.0 или 2.0)
        
    Returns:
        tuple: (x_screenshot, y_screenshot)
    """
    return int(x * scale), int(y * scale)


def screenshot_to_logical_coords(x: float, y: float, scale: float) -> tuple:
    """
    Преобразует координаты из скриншота в логические
    (для Retina: делим на 2)
    
    Args:
        x, y: координаты на скриншоте
        scale: scale factor (1.0 или 2.0)
        
    Returns:
        tuple: (x_logical, y_logical)
    """
    return int(x / scale), int(y / scale)


def correct_click_coordinates(vision_x: int, vision_y: int, 
                             display_info: dict, 
                             screenshot_path: str = None) -> tuple:
    """
    Корректирует координаты от Vision для клика
    
    ПРОВЕРЕННАЯ ЛОГИКА из color_pipette.py:
    - screencapture дает ФИЗИЧЕСКОЕ разрешение (2880x1800 для Retina)
    - Vision анализирует скриншот в ФИЗИЧЕСКОМ разрешении
    - Конвертируем физические → логические: делим на scale
    - Добавляем offset монитора
    
    Args:
        vision_x, vision_y: координаты от Vision (ФИЗИЧЕСКИЕ, относительно скриншота)
        display_info: информация о мониторе (ЛОГИЧЕСКОЕ разрешение)
        screenshot_path: путь к скриншоту (для определения scale)
        
    Returns:
        tuple: (abs_x, abs_y, scale) - абсолютные ЛОГИЧЕСКИЕ координаты для клика
    """
    # Определяем scale (проверенная логика)
    scale = get_display_scale(display_info, screenshot_path)
    
    # Конвертируем физические координаты в логические
    # Для Retina: vision_x=1162 → logical=1162/2=581
    logical_x, logical_y = screenshot_to_logical_coords(vision_x, vision_y, scale)
    
    # Добавляем смещение монитора
    abs_x = display_info['x'] + logical_x
    abs_y = display_info['y'] + logical_y
    
    import logging
    logging.info(f"📐 Координаты: vision=({vision_x},{vision_y}) @ физ, "
                f"scale={scale}x, logical=({logical_x},{logical_y}), "
                f"offset=({display_info['x']},{display_info['y']}), "
                f"→ клик=({abs_x},{abs_y})")
    
    return abs_x, abs_y, scale


def test_coordinate_correction():
    """Тест корректировки координат"""
    print("="*70)
    print("ТЕСТ КОРРЕКТИРОВКИ КООРДИНАТ")
    print("="*70)
    
    # Пример 1: Retina монитор (MacBook)
    retina_display = {'x': 0, 'y': 0, 'width': 1440, 'height': 900}
    vision_x, vision_y = 1144, 140  # Координаты от Vision на скриншоте 2880x1800
    
    abs_x, abs_y, scale = correct_click_coordinates(vision_x, vision_y, retina_display)
    print(f"\n📱 Retina монитор (1440x900 logical):")
    print(f"   Vision координаты (на скриншоте): ({vision_x}, {vision_y})")
    print(f"   Scale factor: {scale}x")
    print(f"   Логические координаты: ({vision_x/scale:.0f}, {vision_y/scale:.0f})")
    print(f"   Абсолютные для клика: ({abs_x}, {abs_y})")
    
    # Пример 2: Обычный внешний монитор
    normal_display = {'x': 1440, 'y': 0, 'width': 1920, 'height': 1080}
    vision_x2, vision_y2 = 960, 120  # Координаты от Vision
    
    abs_x2, abs_y2, scale2 = correct_click_coordinates(vision_x2, vision_y2, normal_display)
    print(f"\n🖥️  Обычный монитор (1920x1080):")
    print(f"   Vision координаты: ({vision_x2}, {vision_y2})")
    print(f"   Scale factor: {scale2}x")
    print(f"   Логические координаты: ({vision_x2/scale2:.0f}, {vision_y2/scale2:.0f})")
    print(f"   Абсолютные для клика: ({abs_x2}, {abs_y2})")
    
    print(f"\n{'='*70}")


if __name__ == '__main__':
    test_coordinate_correction()
