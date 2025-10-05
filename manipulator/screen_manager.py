import logging
import pyautogui
from Quartz import CGDisplayBounds, CGMainDisplayID, CGGetActiveDisplayList
from PIL import Image
import config
import time
import os
import warnings
from user_activity_detector import UserActivityDetector
from coordinate_correction import correct_click_coordinates, get_display_scale

# Игнорируем ALTS warnings от Google API
warnings.filterwarnings('ignore', message='.*ALTS.*')

logger = logging.getLogger(__name__)

class ScreenManager:
    """
    Управление мониторами, скриншотами и кликами
    С поддержкой детектора активности пользователя
    """
    
    def __init__(self, wait_for_user_idle: bool = True):
        """
        Args:
            wait_for_user_idle: Ждать ли бездействия пользователя перед кликами
        """
        self.displays = self._get_displays()
        self.wait_for_user_idle = wait_for_user_idle
        self.activity_detector = UserActivityDetector() if wait_for_user_idle else None
        logger.info(f"Найдено мониторов: {len(self.displays)}")
        if len(self.displays) == 1:
            logger.warning(f"⚠️ Работаю в режиме одного монитора")
        logger.info(f"Режим ожидания бездействия: {'✅ ВКЛ' if wait_for_user_idle else '❌ ВЫКЛ'}")
        
    def _get_displays(self):
        """Получает информацию о всех подключенных мониторах"""
        max_displays = 10
        active_displays = CGGetActiveDisplayList(max_displays, None, None)[1]
        
        displays = []
        for display_id in active_displays:
            bounds = CGDisplayBounds(display_id)
            
            # НЕ определяем scale здесь - будем определять по скриншоту
            # (как в color_pipette.py - более точный метод)
            
            displays.append({
                'id': display_id,
                'x': int(bounds.origin.x),
                'y': int(bounds.origin.y),
                'width': int(bounds.size.width),
                'height': int(bounds.size.height)
            })
        
        # Сортируем по X (слева направо)
        displays.sort(key=lambda d: d['x'])
        
        for i, display in enumerate(displays):
            logger.info(f"Монитор {i}: {display}")
        
        return displays
    
    def get_secondary_monitor(self):
        """Возвращает первый монитор (второй монитор отключен)"""
        # ЗАКОММЕНТИРОВАНО: логика второго монитора
        # if len(self.displays) < 2:
        #     logger.warning("Второй монитор не найден, использую первый")
        #     return self.displays[0]
        # return self.displays[config.SECONDARY_MONITOR_INDEX]
        
        # ВСЕГДА используем первый монитор
        logger.info("🖥️ Использую первый монитор (второй монитор отключен)")
        return self.displays[0]
    
    def capture_secondary_monitor(self) -> str:
        """
        Делает скриншот первого монитора (второй монитор отключен)
        
        ВАЖНО: screencapture возвращает ФИЗИЧЕСКОЕ разрешение (Retina 2x)
        Логика из color_pipette.py - НЕ ресайзим, работаем с оригиналом
        
        Returns:
            Путь к файлу скриншота
        """
        display = self.get_secondary_monitor()  # Возвращает первый монитор
        timestamp = int(time.time())
        filename = f"screenshot_{timestamp}.png"
        filepath = os.path.join(config.SCREENSHOTS_DIR, filename)
        
        # Делаем скриншот ТОЛЬКО второго монитора
        import subprocess
        # Формат -R: X,Y,WIDTH,HEIGHT (логические координаты)
        region = f"{display['x']},{display['y']},{display['width']},{display['height']}"
        subprocess.run([
            'screencapture',
            '-x',  # Без звука
            '-R', region,  # Регион второго монитора
            filepath
        ], check=True, stderr=subprocess.DEVNULL)  # Игнорируем stderr warnings
        
        # Определяем scale по размеру скриншота (проверенная логика из color_pipette.py)
        scale = get_display_scale(display, filepath)
        display['scale'] = scale
        display['last_screenshot'] = filepath
        
        logger.info(f"📸 Скриншот первого монитора сохранен: {filepath}")
        logger.debug(f"   Регион (логический): {region}")
        logger.debug(f"   Scale: {scale}x (физ/лог)")
        return filepath
    
    def get_secondary_monitor_info(self) -> dict:
        """
        Возвращает информацию о первом мониторе для Vision промптов (второй монитор отключен)
        """
        display = self.get_secondary_monitor()  # Возвращает первый монитор
        return display
    
    def click_at(self, x: int, y: int, force: bool = False):
        """
        Кликает по координатам на первом мониторе (второй монитор отключен)
        Автоматически ждёт бездействия пользователя (если включено)
        
        Args:
            x: X координата от Vision (относительно скриншота)
            y: Y координата от Vision (относительно скриншота)
            force: Пропустить ожидание бездействия (только для экстренных случаев!)
        """
        display = self.get_secondary_monitor()  # Возвращает первый монитор
        screenshot_path = display.get('last_screenshot')
        
        # Используем coordinate_correction для точного преобразования
        abs_x, abs_y, scale = correct_click_coordinates(x, y, display, screenshot_path)
        
        logger.debug(f"   Retina scale: {scale}x")
        logger.debug(f"   Vision координаты (скриншот): ({x}, {y})")
        logger.debug(f"   Логические координаты: ({x/scale:.0f}, {y/scale:.0f})")
        logger.debug(f"   Абсолютные координаты: ({abs_x}, {abs_y})")
        
        logger.info(f"🖱️ Клик по координатам: ({abs_x}, {abs_y})")
        
        # Ждём бездействия пользователя (если включено и не force)
        if self.wait_for_user_idle and not force and self.activity_detector:
            logger.info(f"⏸️  Действие: клик на ({abs_x}, {abs_y})")
            if not self.activity_detector.wait_for_idle(idle_seconds=2.2, show_notification=True):
                logger.warning("⚠️ Не дождались бездействия, но продолжаю...")
        
        # Двигаем мышь и кликаем
        logger.debug(f"Движение курсора на ({abs_x}, {abs_y})")
        pyautogui.moveTo(abs_x, abs_y, duration=0.5)
        pyautogui.click()
        logger.info("✅ Клик выполнен")
    
    def type_text(self, text: str, force: bool = False):
        """
        Вводит текст с клавиатуры
        Автоматически ждёт бездействия пользователя (если включено)
        
        Args:
            text: Текст для ввода
            force: Пропустить ожидание бездействия
        """
        logger.info(f"⌨️ Ввод текста: {text[:50]}{'...' if len(text) > 50 else ''}")
        
        # Ждём бездействия пользователя ПЕРЕД нажатием клавиш
        if self.wait_for_user_idle and not force and self.activity_detector:
            logger.info(f"⏸️  Действие: ввод текста '{text[:30]}...'")
            if not self.activity_detector.wait_for_idle(idle_seconds=2.2, show_notification=True):
                logger.warning("⚠️ Не дождались бездействия, но продолжаю...")
        
        time.sleep(0.5)
        pyautogui.write(text, interval=0.05)
        pyautogui.press('enter')
        logger.info("✅ Текст введён")
    
    def press_key(self, key: str, force: bool = False):
        """
        Нажимает клавишу
        Автоматически ждёт бездействия пользователя (если включено)
        
        Args:
            key: Клавиша для нажатия
            force: Пропустить ожидание бездействия
        """
        logger.info(f"⌨️ Нажатие клавиши: {key}")
        
        # Ждём бездействия пользователя ПЕРЕД нажатием клавиши
        if self.wait_for_user_idle and not force and self.activity_detector:
            logger.info(f"⏸️  Действие: нажатие клавиши '{key}'")
            if not self.activity_detector.wait_for_idle(idle_seconds=2.2, show_notification=True):
                logger.warning("⚠️ Не дождались бездействия, но продолжаю...")
        
        pyautogui.press(key)
        logger.info("✅ Клавиша нажата")
