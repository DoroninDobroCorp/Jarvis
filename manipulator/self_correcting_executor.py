"""
Самокорректирующийся исполнитель с проверкой через Gemini Vision

Ключевая идея: 
- Пытается выполнить задачу
- Проверяет результат через скриншот + Gemini Vision
- Если не получилось - пробует другой метод
- Максимум 3 попытки

Работает с ЛЮБЫМ приложением и задачей
"""
import asyncio
import logging
import os
import warnings
import google.generativeai as genai
from PIL import Image
import config
from screen_manager import ScreenManager

# Игнорируем ALTS warnings от Google API
warnings.filterwarnings('ignore', message='.*ALTS.*')
os.environ['GRPC_VERBOSITY'] = 'ERROR'
os.environ['GLOG_minloglevel'] = '2'

logger = logging.getLogger(__name__)

# Настройка Gemini для Vision
# ВАЖНО: ТОЛЬКО модели 2.5+ (лучшее качество Vision)
genai.configure(api_key=config.GEMINI_API_KEY)
vision_model = genai.GenerativeModel('gemini-2.5-flash')

# Детальное логирование для отладки
DETAILED_LOGGING = True

def log_vision_call(prompt: str, response: str, label: str = "Vision"):
    """Детальное логирование Vision вызовов"""
    if DETAILED_LOGGING:
        print(f"\n{'='*70}")
        print(f"🔍 {label} - ЗАПРОС К GEMINI:")
        print(f"{'='*70}")
        print(prompt[:500] + ("..." if len(prompt) > 500 else ""))
        print(f"\n{'='*70}")
        print(f"📥 {label} - ОТВЕТ GEMINI:")
        print(f"{'='*70}")
        print(response[:500] + ("..." if len(response) > 500 else ""))
        print(f"{'='*70}\n")


class SelfCorrectingExecutor:
    """
    Исполнитель с самопроверкой и самокоррекцией
    Использует Gemini Vision для проверки результата и поиска элементов
    """
    
    def __init__(self, screen_manager: 'ScreenManager' = None):
        if screen_manager:
            self.screen = screen_manager
        else:
            # Fallback: создаем свой с настройками из config
            import config
            self.screen = ScreenManager(wait_for_user_idle=config.WAIT_FOR_USER_IDLE)
        self.max_attempts = 3
    
    async def ensure_app_active(self, app_name: str) -> bool:
        """
        Проверяет что нужное приложение активно, если нет - активирует
        
        Args:
            app_name: Имя приложения (Spotify, Yandex, Terminal и т.д.)
            
        Returns:
            True если приложение активно или успешно активировано
        """
        import subprocess
        
        # Проверяем активное приложение
        check_script = '''
        tell application "System Events"
            set frontApp to name of first application process whose frontmost is true
            return frontApp
        end tell
        '''
        try:
            result = subprocess.run(['osascript', '-e', check_script], 
                                  capture_output=True, text=True, timeout=5)
            active_app = result.stdout.strip()
            
            if app_name.lower() in active_app.lower():
                logger.debug(f"✅ {app_name} активен")
                return True
            
            # Если не активен - активируем
            logger.info(f"⚠️ {app_name} не активен (активен: {active_app}). Активирую...")
            activate_script = f'tell application "{app_name}" to activate'
            subprocess.run(['osascript', '-e', activate_script], timeout=5)
            await asyncio.sleep(1)
            return True
            
        except Exception as e:
            logger.error(f"Ошибка проверки активности {app_name}: {e}")
            return False
    
    def _draw_point_with_rulers(self, img, x, y, point_radius=8, crop_size=500, zoom_factor=3):
        """
        Вырезает область вокруг точки, увеличивает, рисует линейки
        
        Args:
            img: PIL Image (полный экран)
            x, y: координаты точки
            point_radius: радиус точки на увеличенном изображении
            crop_size: размер вырезаемой области вокруг точки (по умолчанию 500px = область 1000x1000px)
            zoom_factor: во сколько раз увеличить
            
        Returns:
            PIL Image с точкой и линейками
        """
        from PIL import Image, ImageDraw
        
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
        
        # Увеличиваем
        zoomed_w = crop_w * zoom_factor
        zoomed_h = crop_h * zoom_factor
        zoomed = cropped.resize((zoomed_w, zoomed_h), Image.Resampling.LANCZOS)
        
        # Координаты на увеличенном изображении
        zoomed_x = local_x * zoom_factor
        zoomed_y = local_y * zoom_factor
        
        draw = ImageDraw.Draw(zoomed)
        
        # Красная точка
        draw.ellipse([zoomed_x - point_radius, zoomed_y - point_radius,
                     zoomed_x + point_radius, zoomed_y + point_radius],
                    fill='red', outline='white', width=4)
        
        # ЖЕЛТАЯ горизонтальная линейка
        ruler_h_offset = 50
        ruler_h_y = zoomed_y + ruler_h_offset
        draw.line([(0, ruler_h_y), (zoomed_w, ruler_h_y)], fill='yellow', width=4)
        
        # Метки для горизонтальной линейки
        for real_offset in range(-crop_size, crop_size + 1, 10):
            tick_x = zoomed_x + (real_offset * zoom_factor)
            if tick_x < 0 or tick_x > zoomed_w:
                continue
            tick_y = ruler_h_y
            
            if real_offset % 50 == 0:  # Длинная метка с подписью
                draw.line([(tick_x, tick_y - 20), (tick_x, tick_y + 20)], fill='yellow', width=4)
                label = f"{real_offset:+d}" if real_offset != 0 else "0"
                text_y = tick_y + 30 if tick_y < zoomed_h / 2 else tick_y - 45
                draw.text((tick_x - 25, text_y), label, fill='yellow')
            else:  # Короткая метка
                draw.line([(tick_x, tick_y - 10), (tick_x, tick_y + 10)], fill='yellow', width=3)
        
        # ГОЛУБАЯ вертикальная линейка
        ruler_v_offset = 50
        ruler_v_x = zoomed_x + ruler_v_offset
        draw.line([(ruler_v_x, 0), (ruler_v_x, zoomed_h)], fill='cyan', width=4)
        
        # Метки для вертикальной линейки
        for real_offset in range(-crop_size, crop_size + 1, 10):
            tick_y = zoomed_y + (real_offset * zoom_factor)
            if tick_y < 0 or tick_y > zoomed_h:
                continue
            tick_x = ruler_v_x
            
            if real_offset % 50 == 0:  # Длинная метка с подписью
                draw.line([(tick_x - 20, tick_y), (tick_x + 20, tick_y)], fill='cyan', width=4)
                label = f"{real_offset:+d}" if real_offset != 0 else "0"
                text_x = tick_x + 30 if tick_x < zoomed_w / 2 else tick_x - 70
                draw.text((text_x, tick_y - 12), label, fill='cyan')
            else:  # Короткая метка
                draw.line([(tick_x - 10, tick_y), (tick_x + 10, tick_y)], fill='cyan', width=3)
        
        # Инфо в углу
        draw.text((10, 10), f"Координаты: ({x}, {y})", fill='white')
        draw.text((10, 35), f"Увеличение: x{zoom_factor}", fill='white')
        draw.text((10, 60), f"Линейки: реальные пиксели", fill='white')
        
        return zoomed
    
    async def identify_active_app(self, screenshot_path: str) -> str:
        """
        Определяет какое приложение сейчас активно на скриншоте
        
        Returns:
            Название приложения (YouTube, Spotify, Safari, etc)
        """
        try:
            img_file = genai.upload_file(screenshot_path)
            
            prompt = """Определи какое ПРИЛОЖЕНИЕ или САЙТ сейчас активен на этом скриншоте.

Ответь ОДНИМ СЛОВОМ названием приложения/сайта:
- "YouTube" - если открыт YouTube
- "Spotify" - если открыт Spotify (десктопное приложение)
- "Safari" - если браузер Safari
- "Chrome" - если браузер Chrome
- "Yandex" - если Яндекс.Браузер
- "Terminal" - если терминал
- "Другое" - если что-то иное

Ответь только названием, без объяснений."""

            response = vision_model.generate_content([prompt, img_file])
            app_name = response.text.strip()
            
            log_vision_call(prompt, app_name, "identify_app")
            
            return app_name
            
        except Exception as e:
            logger.error(f"Ошибка определения приложения: {e}")
            return "Неизвестно"
    
    async def verify_task_completion(self, screenshot_path: str, task_description: str) -> dict:
        """
        Проверяет выполнение задачи через Gemini Vision
        
        Args:
            screenshot_path: Путь к скриншоту
            task_description: Описание задачи для проверки
            
        Returns:
            dict: {
                'completed': bool,
                'explanation': str,
                'next_action': str  # что нужно сделать если не выполнено
            }
        """
        try:
            logger.info(f"🔍 Проверка выполнения через Gemini Vision: {task_description}")
            
            # Загружаем скриншот
            img_file = genai.upload_file(screenshot_path)
            
            prompt = f"""Проанализируй этот скриншот и ответь на вопрос:

ЗАДАЧА: {task_description}

Выполнена ли эта задача на скриншоте? 

Ответь в формате JSON:
{{
    "completed": true/false,
    "explanation": "что видно на экране",
    "next_element": "КОНКРЕТНЫЙ UI-элемент, на который нужно кликнуть (если не выполнено)"
}}

ВАЖНО для next_element:
- Указывай ТОЧНОЕ описание элемента: "поле ввода поиска с иконкой лупы", "кнопка Play в нижней панели плеера"
- НЕ просто "кнопка поиска", а "поле ввода текста для поиска в верхней панели"
- НЕ "первый результат", а "первая карточка видео в результатах поиска"
- Указывай расположение: "в верхней панели", "в левой боковой панели", "в центре экрана"

Примеры:
- Задача "найти видео" → completed: false → next_element: "поле ввода поиска в верхней панели (справа от логотипа)"
- Задача "включить музыку" → completed: false → next_element: "треугольная кнопка Play в нижней панели плеера"
- Задача "полноэкранный режим" → completed: false → next_element: "кнопка fullscreen в правом нижнем углу видеоплеера"

Будь строг: completed=true только если задача ТОЧНО выполнена."""

            response = vision_model.generate_content([prompt, img_file])
            result_text = response.text.strip()
            
            # Логируем вызов
            log_vision_call(prompt, result_text, "verify_task")
            
            # Парсим JSON из ответа
            import json
            import re
            
            # Ищем JSON в ответе
            json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', result_text)
            if json_match:
                result = json.loads(json_match.group())
            else:
                # Fallback - парсим текст
                result = {
                    'completed': 'completed: true' in result_text.lower() or 'выполнена' in result_text.lower(),
                    'explanation': result_text[:200],
                    'next_element': 'элемент интерфейса для следующего шага'
                }
            
            logger.info(f"✅ Результат проверки: {result}")
            return result
            
        except Exception as e:
            logger.error(f"❌ Ошибка проверки через Vision: {e}")
            return {
                'completed': False,
                'explanation': f'Ошибка проверки: {e}',
                'next_element': 'элемент интерфейса (ошибка определения)'
            }
    
    async def find_element_coordinates(self, screenshot_path: str, element_description: str, monitor_region: str = None) -> dict:
        """
        Находит координаты элемента на скриншоте через Gemini Vision с итеративным уточнением
        Использует систему линеек для точной коррекции координат
        
        Args:
            screenshot_path: Путь к скриншоту
            element_description: Описание элемента (например "кнопка поиска")
            monitor_region: Информация о мониторе (не используется, для совместимости)
            
        Returns:
            dict: {
                'found': bool,
                'x': int,  # координата относительно скриншота  
                'y': int,
                'confidence': str,
                'explanation': str
            }
        """
        """
        Находит координаты элемента используя систему сетки

        Args:
            screenshot_path: Путь к скриншоту
            element_description: Описание элемента (например "кнопка поиска")

        Returns:
            dict: {
                'found': bool,
                'x': int,  # координата относительно скриншота
                'y': int,
                'confidence': str
            }
        """
        logger.info(f"🔍 Поиск элемента через итеративное уточнение с линейками: {element_description}")

        try:
            # Загружаем оригинальное изображение
            from PIL import Image, ImageDraw
            import re
            
            original = Image.open(screenshot_path).convert('RGB')
            width, height = original.size
            logger.info(f"📐 Размер скриншота: {width}x{height}")
            
            # ШАГ 1: Запрос начальных координат
            logger.info(f"📍 Запрашиваю начальные координаты для: {element_description}")
            
            initial_prompt = f'''На изображении размером {width}x{height} пикселей найди: {element_description}

ВАЖНО:
- Координата (0, 0) находится в ЛЕВОМ ВЕРХНЕМ углу
- X увеличивается ВПРАВО (от 0 до {width})
- Y увеличивается ВНИЗ (от 0 до {height})

ОТВЕТЬ СТРОГО в формате:
Координаты: X Y
Описание: где находится элемент

Пример:
Координаты: 520 1650
Описание: кнопка поиска в верхней панели'''
            
            response = vision_model.generate_content([initial_prompt, original])
            answer = response.text.strip()
            logger.debug(f"📥 Ответ Gemini: {answer[:200]}...")
            
            # Парсим координаты
            coords_match = re.search(r'Координаты:\s*(\d+)\s+(\d+)', answer)
            if not coords_match:
                logger.warning(f"❌ Не удалось распарсить начальные координаты")
                return {
                    'found': False,
                    'x': 0,
                    'y': 0,
                    'confidence': 'низкая',
                    'explanation': 'Не удалось получить начальные координаты'
                }
            
            current_x = int(coords_match.group(1))
            current_y = int(coords_match.group(2))
            logger.info(f"✅ Начальные координаты: ({current_x}, {current_y})")
            
            # ШАГ 2: Итеративное уточнение с линейками (макс 5 итераций)
            # Вырезается область 1000x1000px (500px в каждую сторону), увеличивается в 3 раза
            max_iterations = 5
            for iteration in range(1, max_iterations + 1):
                logger.info(f"🔄 Итерация {iteration}/{max_iterations}: проверка координат ({current_x}, {current_y})")
                
                # Рисуем точку + линейки (область 1000x1000px вокруг точки)
                point_img = self._draw_point_with_rulers(original, current_x, current_y)
                
                # Сохраняем для проверки
                import time
                iter_path = f'screenshots/ruler_iter{iteration}_{int(time.time())}.png'
                point_img.save(iter_path)
                
                # Проверяем точность
                verify_prompt = f'''На изображении показан УВЕЛИЧЕННЫЙ ФРАГМЕНТ экрана.

КРАСНАЯ ТОЧКА с координатами ({current_x}, {current_y}).

ЛИНЕЙКИ:
- ЖЕЛТАЯ горизонтальная - ниже точки (0 = точка)
- ГОЛУБАЯ вертикальная - справа от точки (0 = точка)  
- Метки каждые 10-50 РЕАЛЬНЫХ пикселей

ЗАДАЧА: ГАРАНТИРУЕТ ли клик по этой точке активацию элемента "{element_description}"?

🎯 КРИТЕРИЙ УСПЕХА:
- Точка НЕ обязана быть в центре элемента!
- Если точка попадает В ОБЛАСТЬ элемента (даже с краю) - это ДОСТАТОЧНО
- Ответь ВЕРНА, если клик по точке ГАРАНТИРОВАННО активирует элемент
- Коррекция нужна ТОЛЬКО если есть реальный риск промаха

⚠️ ВАЖНО: Если элемента НЕТ на этом фрагменте вообще - напиши "Элемент НЕ ВИДЕН НА ФРАГМЕНТЕ"

ОТВЕТЬ СТРОГО в одном из форматов:

1) Если элемента НЕТ на фрагменте:
Элемент НЕ ВИДЕН НА ФРАГМЕНТЕ

2) Если точка ПОПАДАЕТ в область элемента (даже с краю):
Точка: ВЕРНА

3) ТОЛЬКО если есть РЕАЛЬНЫЙ риск промаха - укажи минимальную коррекцию:
Точка: НЕ ВЕРНА
Сдвиг X: [число]
Сдвиг Y: [число]
Объяснение: почему точка промахнется

Правила сдвига:
- Элемент СПРАВА → X положительный (+)
- Элемент СЛЕВА → X отрицательный (-)
- Элемент НИЖЕ → Y положительный (+)
- Элемент ВЫШЕ → Y отрицательный (-)'''
                
                verify_response = vision_model.generate_content([verify_prompt, point_img])
                verify_answer = verify_response.text.strip()
                logger.debug(f"📥 Проверка: {verify_answer[:200]}...")
                
                # Проверяем - виден ли элемент на фрагменте
                if 'НЕ ВИДЕН НА ФРАГМЕНТЕ' in verify_answer.upper() or 'НЕ ВИДЕН' in verify_answer.upper():
                    logger.warning(f"⚠️ Элемент не виден на фрагменте, возвращаюсь к полному скриншоту")
                    # Пробуем снова с полным скриншотом
                    logger.info(f"🔄 Повторный запрос координат на полном скриншоте")
                    
                    retry_prompt = f'''На изображении размером {width}x{height} пикселей найди: {element_description}

ВАЖНО:
- Координата (0, 0) находится в ЛЕВОМ ВЕРХНЕМ углу
- X увеличивается ВПРАВО (от 0 до {width})
- Y увеличивается ВНИЗ (от 0 до {height})

ОТВЕТЬ СТРОГО в формате:
Координаты: X Y
Описание: где находится элемент

Пример:
Координаты: 520 1650
Описание: кнопка поиска в верхней панели'''
                    
                    retry_response = vision_model.generate_content([retry_prompt, original])
                    retry_answer = retry_response.text.strip()
                    logger.debug(f"📥 Повторный ответ: {retry_answer[:200]}...")
                    
                    retry_match = re.search(r'Координаты:\s*(\d+)\s+(\d+)', retry_answer)
                    if retry_match:
                        current_x = int(retry_match.group(1))
                        current_y = int(retry_match.group(2))
                        logger.info(f"✅ Новые координаты с полного скриншота: ({current_x}, {current_y})")
                        continue  # Продолжаем итерации с новыми координатами
                    else:
                        logger.error(f"❌ Не удалось получить координаты с полного скриншота")
                        break
                
                # Парсим результат
                if 'ВЕРНА' in verify_answer and 'НЕ ВЕРНА' not in verify_answer:
                    logger.info(f"✅ Координаты подтверждены на итерации {iteration}")
                    return {
                        'found': True,
                        'x': current_x,
                        'y': current_y,
                        'confidence': 'высокая',
                        'explanation': f'Найден после {iteration} итераций уточнения'
                    }
                
                # Извлекаем сдвиги
                x_match = re.search(r'Сдвиг X:\s*([+-]?\d+)', verify_answer)
                y_match = re.search(r'Сдвиг Y:\s*([+-]?\d+)', verify_answer)
                
                if x_match and y_match:
                    delta_x = int(x_match.group(1))
                    delta_y = int(y_match.group(1))
                    logger.info(f"📐 Коррекция: X{delta_x:+d}, Y{delta_y:+d}")
                    
                    current_x += delta_x
                    current_y += delta_y
                    
                    # Ограничиваем координаты
                    current_x = max(0, min(width, current_x))
                    current_y = max(0, min(height, current_y))
                    logger.info(f"➡️ Новые координаты: ({current_x}, {current_y})")
                else:
                    logger.warning(f"⚠️ Не удалось распарсить сдвиги, останавливаемся")
                    break
            
            # Если дошли до конца итераций - используем последние координаты
            logger.warning(f"⚠️ Достигнут лимит итераций, использую последние координаты")
            return {
                'found': True,
                'x': current_x,
                'y': current_y,
                'confidence': 'средняя',
                'explanation': f'Координаты после {max_iterations} итераций'
            }

        except Exception as e:
            logger.error(f"❌ Ошибка поиска элемента: {e}", exc_info=True)
            return {
                'found': False,
                'x': 0,
                'y': 0,
                'confidence': 'низкая',
                'explanation': str(e)
            }
    
    async def execute_with_self_correction(self, 
                                          task_description: str,
                                          primary_method,
                                          search_query: str = None) -> bool:
        """
        Выполняет задачу с самокоррекцией
        
        Args:
            task_description: Описание задачи для проверки
            primary_method: Основной метод (async функция)
            search_query: Текст для ввода если Vision найдет поле ввода (опционально)
            
        Returns:
            bool: True если задача выполнена
            
        Пример:
            await executor.execute_with_self_correction(
                task_description="Видео воспроизводится на весь экран",
                primary_method=lambda: запустить_видео(),
                search_query="клинок demon slayer"
            )
            
        Система сама определит какой элемент кликать если primary не сработал
        """
        for attempt in range(1, self.max_attempts + 1):
            print(f"\n{'='*70}")
            print(f"🔄 Попытка {attempt}/{self.max_attempts}")
            print(f"{'='*70}")
            
            # 1. Выполняем основной метод
            print(f"   ▶️ Выполняю действие...")
            try:
                await primary_method()
            except Exception as e:
                logger.error(f"Ошибка при выполнении: {e}")
            
            await asyncio.sleep(2)  # Даём время на отклик
            
            # 2. Делаем скриншот
            print(f"   📸 Создаю скриншот...")
            screenshot_path = self.screen.capture_secondary_monitor()
            
            # 3. Проверяем результат через Gemini Vision
            print(f"   🔍 Проверяю результат через Gemini Vision...")
            verification = await self.verify_task_completion(screenshot_path, task_description)
            
            print(f"   📊 Результат: {verification['explanation']}")
            
            if verification['completed']:
                print(f"\n✅ УСПЕХ! Задача выполнена с попытки {attempt}")
                return True
            
            # 4. Если не выполнено и есть ещё попытки - используем next_element от Gemini
            if attempt < self.max_attempts:
                next_element = verification.get('next_element', '')
                
                if next_element and 'ошибка' not in next_element.lower():
                    print(f"   ⚠️ Не получилось. Пробую альтернативный метод...")
                    print(f"   🎯 Gemini рекомендует: {next_element}")
                    
                    await asyncio.sleep(2)  # Задержка перед Vision запросом
                    
                    # Проверяем что нужное приложение все еще активно
                    # Определяем приложение по контексту задачи
                    if 'spotify' in task_description.lower():
                        await self.ensure_app_active('Spotify')
                    elif 'youtube' in task_description.lower() or 'видео' in task_description.lower():
                        await self.ensure_app_active('Yandex')
                    
                    monitor_info = self.screen.get_secondary_monitor_info()
                    element = await self.find_element_coordinates(screenshot_path, next_element, monitor_info)
                    
                    # confidence теперь строка: 'высокая', 'средняя', 'низкая'
                    confidence_ok = element.get('confidence', 'низкая') in ['высокая', 'средняя']
                    if element['found'] and confidence_ok:
                        print(f"   ✅ Найден! Confidence: {element['confidence']}")
                        print(f"   📍 Координаты: X={element['x']}, Y={element['y']}")
                        print(f"   💭 Gemini объяснение: {element.get('explanation', 'нет')}")
                        print(f"   🖱️  Кликаю...")
                        self.screen.click_at(element['x'], element['y'], force=True)
                        await asyncio.sleep(1)
                        
                        # Если это поле ввода И есть search_query - определяем что вводить
                        is_input_field = any(keyword in next_element.lower() for keyword in 
                                           ['поле', 'ввод', 'search', 'адрес', 'строка', 'input'])
                        
                        if search_query and is_input_field:
                            # Используем Gemini чтобы определить ЧТО именно вводить
                            print(f"   🤔 Определяю что вводить в поле...")
                            
                            prompt = f"""На основе этой задачи:
{search_query}

Определи ТОЧНЫЙ текст для ввода в поле "{next_element}".

Правила:
- Если нужно найти сериал/видео/музыку - верни название
- Если нужен URL - верни полный URL
- Если нужен поисковый запрос - верни короткий запрос
- Максимум 100 символов

Ответь ТОЛЬКО текстом для ввода, без JSON, без объяснений."""

                            response = vision_model.generate_content(prompt)
                            text_to_type = response.text.strip().replace('"', '').replace("'", '')
                            
                            print(f"   ⌨️  Ввожу текст: {text_to_type}")
                            import subprocess
                            # Экранируем спецсимволы для AppleScript
                            safe_text = text_to_type.replace('\\', '\\\\').replace('"', '\\"')
                            script = f'''
                            tell application "System Events"
                                keystroke "{safe_text}"
                                delay 2
                                keystroke return
                                delay 1
                            end tell
                            '''
                            subprocess.run(['osascript', '-e', script], timeout=10)
                            print(f"   ⏳ Жду результаты...")
                            await asyncio.sleep(3)
                            
                            # Делаем новый скриншот и ищем первый результат
                            print(f"   📸 Скриншот результатов поиска...")
                            new_screenshot = self.screen.capture_secondary_monitor()
                            
                            print(f"   🔍 Ищу первый результат поиска...")
                            await asyncio.sleep(2)
                            monitor_info = self.screen.get_secondary_monitor_info()
                            first_result = await self.find_element_coordinates(
                                new_screenshot,
                                "первая карточка трека в результатах поиска (не реклама, не плейлист)",
                                monitor_info
                            )
                            
                            confidence_ok = first_result.get('confidence', 'низкая') in ['высокая', 'средняя']
                            if first_result['found'] and confidence_ok:
                                print(f"   ✅ Первый результат найден!")
                                
                                # КРИТИЧНО: Применяем коррекцию координат для Retina
                                from coordinate_correction import correct_click_coordinates
                                corrected_x, corrected_y, scale = correct_click_coordinates(
                                    first_result['x'], first_result['y'], 
                                    monitor_info, 
                                    new_screenshot
                                )
                                print(f"   📐 Коррекция: scale={scale}x → клик на ({corrected_x}, {corrected_y})")
                                print(f"   🖱️  Кликаю на первый результат...")
                                self.screen.click_at(corrected_x, corrected_y, force=True)
                                await asyncio.sleep(2)
                            else:
                                print(f"   ⚠️ Первый результат не найден, пропускаю")
                    else:
                        conf = element.get('confidence', 0)
                        print(f"   ❌ Элемент не найден или низкая уверенность ({conf:.2f})")
                else:
                    print(f"   ⚠️ Gemini не смог определить следующий элемент")
            
            if attempt < self.max_attempts:
                print(f"   🔄 Следующая попытка...")
                await asyncio.sleep(1)
        
        print(f"\n❌ Не удалось выполнить задачу за {self.max_attempts} попытки")
        return False
