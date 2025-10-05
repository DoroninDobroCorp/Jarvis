"""
Детектор активности пользователя для безопасной параллельной работы
"""
import time
import logging
from Quartz import CGEventSourceCreate, kCGEventSourceStateHIDSystemState, CGEventSourceCounterForEventType
from Quartz import kCGEventMouseMoved, kCGEventLeftMouseDown, kCGEventRightMouseDown
import subprocess
import os

logger = logging.getLogger(__name__)


class UserActivityDetector:
    """
    Отслеживает активность пользователя (движения мыши, клики, клавиатура)
    """
    
    def __init__(self):
        self.last_mouse_position = None
        self.last_check_time = time.time()
        self.event_source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState)
        
    def get_mouse_events_count(self):
        """Возвращает количество событий мыши с момента запуска системы"""
        try:
            moves = CGEventSourceCounterForEventType(self.event_source, kCGEventMouseMoved)
            left_clicks = CGEventSourceCounterForEventType(self.event_source, kCGEventLeftMouseDown)
            right_clicks = CGEventSourceCounterForEventType(self.event_source, kCGEventRightMouseDown)
            return moves + left_clicks + right_clicks
        except:
            return 0
    
    def is_user_active(self, check_duration: float = 0.1) -> bool:
        """
        Проверяет, активен ли пользователь (двигает мышкой)
        
        Args:
            check_duration: Сколько секунд проверять активность
            
        Returns:
            True если пользователь двигает мышкой, False если нет
        """
        start_count = self.get_mouse_events_count()
        time.sleep(check_duration)
        end_count = self.get_mouse_events_count()
        
        return end_count > start_count
    
    def wait_for_idle(self, idle_seconds: float = 2.0, show_notification: bool = True) -> bool:
        """
        Ждёт, пока пользователь не прекратит двигать мышкой
        
        Args:
            idle_seconds: Сколько секунд бездействия нужно
            show_notification: Показывать ли уведомление пользователю
            
        Returns:
            True если дождались, False если таймаут (максимум 30 секунд)
        """
        max_wait_time = 30.0
        start_wait = time.time()
        notification_shown = False
        
        logger.info(f"⏳ Проверка активности пользователя...")
        
        while True:
            # Проверяем, не истёк ли максимальный таймаут
            elapsed = time.time() - start_wait
            if elapsed > max_wait_time:
                logger.warning(f"⚠️ Таймаут ожидания бездействия ({max_wait_time}s)")
                return False
            
            # Проверяем активность
            if self.is_user_active(check_duration=0.2):
                # Пользователь активен — показываем уведомление
                if show_notification and not notification_shown:
                    self._show_notification(
                        "Jarvis ждёт",
                        f"Освободите мышку на {idle_seconds} секунды"
                    )
                    notification_shown = True
                    logger.info(f"👤 Пользователь активен, жду бездействия...")
                
                # Сбрасываем таймер бездействия
                start_wait = time.time()
                time.sleep(0.5)
                continue
            
            # Пользователь неактивен — проверяем, прошло ли достаточно времени
            idle_duration = time.time() - start_wait
            if idle_duration >= idle_seconds:
                logger.info(f"✅ Пользователь неактивен {idle_duration:.1f}s, продолжаю")
                return True
            
            time.sleep(0.2)
    
    def _show_notification(self, title: str, message: str):
        """Показывает macOS уведомление"""
        try:
            # Экранируем кавычки в сообщении
            safe_message = message.replace('"', '\\"').replace("'", "\\'")
            safe_title = title.replace('"', '\\"').replace("'", "\\'")
            
            apple_script = f'''
            display notification "{safe_message}" with title "{safe_title}" sound name "Glass"
            '''
            subprocess.run(['osascript', '-e', apple_script], 
                         capture_output=True, timeout=2)
        except Exception as e:
            logger.debug(f"Не удалось показать уведомление: {e}")
    
    def get_cursor_monitor_index(self, displays: list) -> int:
        """
        Определяет, на каком мониторе находится курсор
        
        Args:
            displays: Список мониторов из ScreenManager
            
        Returns:
            Индекс монитора (0, 1, ...)
        """
        try:
            # Получаем позицию курсора через AppleScript
            script = 'do shell script "echo $(osascript -e \\"tell application \\\\\\"System Events\\\\\\" to get position of mouse\\")"'
            result = subprocess.run(['osascript', '-e', script], 
                                  capture_output=True, text=True, timeout=1)
            
            if result.returncode == 0:
                # Парсим координаты "x, y"
                coords = result.stdout.strip().split(',')
                if len(coords) == 2:
                    x = int(coords[0].strip())
                    y = int(coords[1].strip())
                    
                    # Определяем монитор
                    for i, display in enumerate(displays):
                        if (display['x'] <= x < display['x'] + display['width'] and
                            display['y'] <= y < display['y'] + display['height']):
                            return i
        except Exception as e:
            logger.debug(f"Не удалось определить позицию курсора: {e}")
        
        return 0  # По умолчанию первый монитор
    
    def is_cursor_on_secondary_monitor(self, displays: list, secondary_index: int = 1) -> bool:
        """
        Проверяет, находится ли курсор на втором мониторе
        
        Args:
            displays: Список мониторов
            secondary_index: Индекс второго монитора
            
        Returns:
            True если курсор на втором мониторе
        """
        current_index = self.get_cursor_monitor_index(displays)
        return current_index == secondary_index
