import logging
import pyautogui
from Quartz import CGDisplayBounds, CGMainDisplayID, CGGetActiveDisplayList
from PIL import Image
import config
import time
import os
from user_activity_detector import UserActivityDetector

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
        logger.info(f"Режим ожидания бездействия: {'✅ ВКЛ' if wait_for_user_idle else '❌ ВЫКЛ'}")
        
    def _get_displays(self):
        """Получает информацию о всех подключенных мониторах"""
        max_displays = 10
        active_displays = CGGetActiveDisplayList(max_displays, None, None)[1]
        
        displays = []
        for display_id in active_displays:
            bounds = CGDisplayBounds(display_id)
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
        """Возвращает второй монитор (дополнительный)"""
        if len(self.displays) < 2:
            logger.warning("Второй монитор не найден, использую первый")
            return self.displays[0]
        return self.displays[config.SECONDARY_MONITOR_INDEX]
    
    def capture_secondary_monitor(self) -> str:
        """
        Делает скриншот второго монитора
        
        Returns:
            Путь к файлу скриншота
        """
        display = self.get_secondary_monitor()
        
        # Делаем скриншот всего экрана
        screenshot = pyautogui.screenshot()
        
        # Обрезаем до второго монитора
        cropped = screenshot.crop((
            display['x'],
            display['y'],
            display['x'] + display['width'],
            display['y'] + display['height']
        ))
        
        # Сохраняем
        timestamp = int(time.time())
        filename = f"screenshot_{timestamp}.png"
        filepath = os.path.join(config.SCREENSHOTS_DIR, filename)
        cropped.save(filepath)
        
        logger.info(f"📸 Скриншот сохранен: {filepath}")
        return filepath
    
    def click_at(self, x: int, y: int, force: bool = False):
        """
        Кликает по абсолютным координатам на втором мониторе
        Автоматически ждёт бездействия пользователя (если включено)
        
        Args:
            x: X координата на втором мониторе (относительная)
            y: Y координата на втором мониторе (относительная)
            force: Пропустить ожидание бездействия (только для экстренных случаев!)
        """
        display = self.get_secondary_monitor()
        
        # Преобразуем относительные координаты в абсолютные
        abs_x = display['x'] + x
        abs_y = display['y'] + y
        
        logger.info(f"🖱️ Клик по координатам: ({abs_x}, {abs_y})")
        
        # Ждём бездействия пользователя (если включено и не force)
        if self.wait_for_user_idle and not force and self.activity_detector:
            if not self.activity_detector.wait_for_idle(idle_seconds=2.0, show_notification=True):
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
        
        # Ждём бездействия пользователя
        if self.wait_for_user_idle and not force and self.activity_detector:
            if not self.activity_detector.wait_for_idle(idle_seconds=2.0, show_notification=True):
                logger.warning("⚠️ Не дождались бездействия, но продолжаю...")
        
        time.sleep(0.5)
        pyautogui.write(text, interval=0.05)
        pyautogui.press('enter')
        logger.info("✅ Текст введён")
    
    def press_key(self, key: str):
        """Нажимает клавишу"""
        logger.info(f"⌨️ Нажатие клавиши: {key}")
        pyautogui.press(key)
