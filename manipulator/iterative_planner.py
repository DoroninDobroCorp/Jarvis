"""
Итеративный планировщик с динамической корректировкой плана

Цикл работы:
1. Gemini создает план (столько шагов, в скольких уверена)
2. Выполняем шаги
3. Если встречаем REPLAN - делаем скриншот и запрашиваем новый план
4. Повторяем пока задача не выполнена или не застряли
"""
import asyncio
import logging
import yaml
import json
import os
import time
from typing import List, Dict, Any
import google.generativeai as genai
from screen_manager import ScreenManager
import subprocess
import pyautogui
from chrome_mcp_integration import get_chrome_mcp_integration, close_chrome_mcp_integration

logger = logging.getLogger(__name__)

# Загружаем конфиг возможностей
with open('system_capabilities.yaml', 'r', encoding='utf-8') as f:
    CAPABILITIES = yaml.safe_load(f)


class ActionTracker:
    """Отслеживает неудачные действия чтобы не повторять их"""
    
    def __init__(self):
        self.failed_actions = []  # [(action, params, reason), ...]
        
    def add_failed(self, action: str, params: Dict, reason: str):
        """Добавляет неудачное действие в историю"""
        # Сохраняем только ключевую информацию
        key_info = f"{action}"
        if action == "CLICK":
            element_desc = params.get('element_description', '')[:50]
            key_info += f" '{element_desc}'"
        elif action == "TYPE":
            text = params.get('text', '')[:30]
            key_info += f" '{text}'"
            
        self.failed_actions.append((key_info, reason))
        
    def get_history_text(self) -> str:
        """Возвращает историю для промпта (последние 5)"""
        if not self.failed_actions:
            return "Нет неудачных попыток"
        
        history = []
        for action, reason in self.failed_actions[-5:]:
            history.append(f"❌ {action} - {reason}")
        return "\n".join(history)
        
    def is_repeating(self, action: str, params: Dict) -> bool:
        """Проверяет не пытаемся ли повторить недавнюю неудачную попытку"""
        if action == "CLICK":
            element_desc = params.get('element_description', '')[:50]
            check_str = f"CLICK '{element_desc}'"
            # Проверяем последние 3 попытки
            for failed_action, _ in self.failed_actions[-3:]:
                if check_str in failed_action:
                    return True
        return False


class ProgressTracker:
    """Отслеживает прогресс выполнения и детектит зацикливание"""
    
    def __init__(self, stuck_threshold: int = 3):
        self.stuck_threshold = stuck_threshold
        self.history = []  # [(state_hash, explanation), ...]
        self.stuck_count = 0
        
    def update(self, state_description: str, screenshot_hash: str = None):
        """
        Обновляет состояние и проверяет прогресс
        
        Returns:
            bool: True если прогресс есть, False если застряли
        """
        # Создаем хеш состояния
        state_hash = hash(state_description.lower()[:200])
        
        # Проверяем похоже ли на предыдущее состояние
        if len(self.history) > 0:
            prev_hash = self.history[-1][0]
            if state_hash == prev_hash:
                self.stuck_count += 1
                logger.warning(f"⚠️ Возможно зациклились (счетчик: {self.stuck_count}/{self.stuck_threshold})")
            else:
                self.stuck_count = 0  # Сбрасываем если прогресс есть
        
        self.history.append((state_hash, state_description))
        
        # Проверяем порог
        if self.stuck_count >= self.stuck_threshold:
            logger.error(f"❌ Застряли! {self.stuck_threshold} итераций без прогресса")
            return False
        
        return True


def validate_element_description(description: str) -> tuple:
    """
    Проверяет что описание элемента годится для Vision AI
    
    Returns:
        (is_valid: bool, error_message: str)
    """
    if not description or not description.strip():
        return False, "Пустое описание"
    
    desc = description.strip()
    
    # Проверка минимальной длины
    if len(desc) < 10:
        return False, "Слишком короткое описание (минимум 10 символов)"
    
    # Проверка на URL/технические строки
    invalid_patterns = ['http://', 'https://', 'about:', '.com', '.ru', '.org', 'www.']
    if any(pattern in desc.lower() for pattern in invalid_patterns):
        return False, "Описание похоже на URL, а не UI элемент"
    
    # Проверка что это не просто название приложения
    app_names = ['spotify', 'chrome', 'safari', 'yandex', 'firefox', 'telegram', 'zoom']
    if desc.lower().strip() in app_names:
        return False, f"'{desc}' - это название приложения, а не описание UI элемента"
    
    # Проверка наличия слов указывающих на расположение
    location_words = [
        'верх', 'низ', 'лев', 'прав', 'центр', 'угол', 
        'док', 'панел', 'строк', 'сторон', 'край',
        'top', 'bottom', 'left', 'right', 'center', 'corner',
        'toolbar', 'sidebar', 'bar', 'menu'
    ]
    has_location = any(word in desc.lower() for word in location_words)
    
    if not has_location:
        return False, "Нет указания расположения элемента (добавь: вверху/внизу/слева/справа/в центре)"
    
    return True, "OK"


class IterativePlanner:
    """
    Планировщик с динамической корректировкой плана
    """
    
    def __init__(self, api_key: str, screen_manager: ScreenManager = None):
        genai.configure(api_key=api_key)
        # ВАЖНО: ТОЛЬКО модели 2.5+ для лучшего качества планирования
        self.model = genai.GenerativeModel('gemini-2.5-pro')
        # Используем переданный ScreenManager или создаем новый с конфигом из config
        if screen_manager:
            self.screen = screen_manager
        else:
            import config
            self.screen = ScreenManager(wait_for_user_idle=config.WAIT_FOR_USER_IDLE)
        self.tracker = ProgressTracker(stuck_threshold=CAPABILITIES['limits']['stuck_threshold'])
        self.action_tracker = ActionTracker()
        self.replan_count = 0
        self.max_replans = CAPABILITIES['limits']['max_replans']
        self.chrome_mcp = None  # Lazy init при необходимости
        self.is_browser_task = False  # Флаг для определения типа задачи
        
    async def _ensure_app_is_active(self, params: Dict):
        """
        Проверяет что нужное приложение активно
        Если нет - выводит уведомление
        """
        # TODO: Определить приложение из контекста/параметров
        # Пока просто логируем
        logger.debug("Проверка активности приложения...")
    
    def _build_capabilities_prompt(self) -> str:
        """Создает описание возможностей системы для Gemini"""
        
        # Список приложений
        apps = CAPABILITIES['applications']
        apps_text = ", ".join(apps)
        
        # Список действий
        actions_text = "\n".join([
            f"- {action['name']}: {action['description']}\n  Пример: {action['example']}"
            for action in CAPABILITIES['actions']
        ])
        
        # Правила (два уровня)
        high_level_rules = CAPABILITIES['planning_rules']['high_level']
        low_level_rules = CAPABILITIES['planning_rules']['low_level']
        
        rules_text = "ВЫСОКИЙ УРОВЕНЬ (стратегия):\n" + "\n".join([f"• {rule}" for rule in high_level_rules])
        rules_text += "\n\nНИЗКИЙ УРОВЕНЬ (конкретные действия):\n" + "\n".join([f"• {rule}" for rule in low_level_rules])
        
        return f"""
## ДОСТУПНЫЕ ПРИЛОЖЕНИЯ
{apps_text}

## ДОСТУПНЫЕ ДЕЙСТВИЯ
{actions_text}

## ПРАВИЛА ПЛАНИРОВАНИЯ
{rules_text}

## 🎯 КРИТИЧНО ВАЖНЫЕ ПРАВИЛА ДЛЯ element_description В CLICK:

element_description - это описание ВНЕШНЕГО ВИДА UI элемента для Vision AI, НЕ содержимое!

✅ ПРАВИЛЬНЫЕ примеры:
- "прямоугольное белое поле ввода адреса в верхней панели браузера"
- "круглая зелёная кнопка Play с треугольником в центре плеера внизу"
- "круглая иконка Google Chrome (красно-жёлто-зелено-синий логотип) в доке внизу экрана"
- "первая карточка видео в результатах поиска (с превью и названием)"
- "красная кнопка Subscribe справа под видео"

❌ НЕПРАВИЛЬНЫЕ примеры (НЕ ДЕЛАЙ ТАК):
- "about:blank" ← Это СОДЕРЖИМОЕ адресной строки, а не описание UI
- "Google Chrome" ← Это НАЗВАНИЕ приложения, а не описание иконки
- "Play" ← Слишком общо, где? как выглядит?
- "первый результат" ← Первый ЧТО? карточка? ссылка? кнопка?
- "youtube.com" ← Это URL, а не UI элемент
- "кнопка" ← Какая кнопка? где? какого цвета?

ФОРМУЛА: [ФОРМА/ЦВЕТ] + [СОДЕРЖИМОЕ/ИКОНКА] + [РАСПОЛОЖЕНИЕ НА ЭКРАНЕ]

## ⚡ НОВАЯ СИСТЕМА КООРДИНАТ (СЕТКА):
Система теперь использует сетку для ТОЧНОГО определения координат:

🔍 Как это работает:
1. Экран разбивается на сетку 50x50 пронумерованных ячеек
2. Gemini выбирает номер ячейки где находится центр элемента
3. Мы кликаем в центр выбранной ячейки

📐 Преимущества:
- Точность ±1% от размера экрана (гораздо лучше чем пиксели)
- Работает даже если Gemini не может дать точные координаты
- Надежность близка к 100% для большинства элементов

🎯 Правила для описаний:
- Будь максимально конкретен в описании элемента
- Указывай форму, цвет, расположение, отличительные черты
- Если элемент имеет текст - упомяни его ВНЕШНИЙ ВИД, а не содержимое

## ВАЖНО О ВВОДЕ ТЕКСТА:
⚠️ Если поле ввода УЖЕ содержит текст (адресная строка с URL, поле поиска с запросом):
- ОБЯЗАТЕЛЬНО сначала очисти: HOTKEY('cmd+a') перед TYPE
- Последовательность: CLICK(поле) → HOTKEY('cmd+a') → TYPE(новый_текст)
- Без cmd+a новый текст ДОБАВИТСЯ к старому!

Примеры:
✅ ПРАВИЛЬНО для адресной строки с "about:blank":
  1. CLICK("поле адреса вверху")
  2. HOTKEY('cmd+a')
  3. TYPE("youtube.com")
  
❌ НЕПРАВИЛЬНО:
  1. CLICK("поле адреса")
  2. TYPE("youtube.com")  ← получится "about:blankyoutube.com"!

## 🚀 ИЕРАРХИЯ ПРИОРИТЕТОВ:

### 1️⃣ TERMINAL (приоритет #1)
Открытие приложений, системные команды:
✅ TERMINAL('open -a "Chrome"')
✅ HOTKEY('cmd+space')
❌ CLICK('иконка приложения')

### 2️⃣ ACCESSIBILITY_API (приоритет #2)
НЕ РЕАЛИЗОВАНО - пропускаем

### 3️⃣ MCP CHROME (приоритет #3) - ДЛЯ БРАУЗЕРА!
**ИСПОЛЬЗУЙ для Chrome/веб-задач:**

MCP_NAVIGATE(url='https://youtube.com')
  → Открыть URL. ПРИОРИТЕТ выше CLICK!

MCP_CLICK(selector='input[name="search"]')
  → Клик по CSS селектору. ПРИОРИТЕТ выше VISUAL_CLICK!
  
MCP_EXECUTE_JS(code='document.querySelector("button").click()')
  → JavaScript для сложных действий

MCP_TYPE(text='hello', selector='input#search')
  → Ввод текста если знаешь селектор

**FALLBACK:** Если MCP failed → автоматически VISUAL_CLICK

### 4️⃣ VISUAL_CLICK (приоритет #4) - LAST RESORT
ТОЛЬКО когда:
- Не знаешь CSS селектор
- Не браузер (Spotify, другие приложения)
- MCP не сработал

**ПРИМЕРЫ:**
Chrome задача:
  ✅ MCP_NAVIGATE('youtube.com')    ← #3
  ✅ MCP_CLICK('input#search')      ← #3
  ❌ CLICK('адресная строка')       ← используй MCP!

Spotify задача:
  ✅ CLICK('кнопка Play')           ← MCP недоступен
  ✅ TYPE('название трека')         ← обычный TYPE

## ВАЖНО О ПЛАНИРОВАНИИ
- Планируй МАКСИМУМ 2-4 шага за раз
- Если confidence следующего шага < 90% - используй REPLAN СЕЙЧАС
- Лучше больше REPLAN, чем неправильный план
"""

    async def create_initial_plan(self, user_request: str) -> Dict[str, Any]:
        """
        Создает начальный план на основе запроса пользователя
        
        Returns:
            {
                'goal': str,
                'steps': [
                    {'action': 'CLICK', 'params': {...}, 'confidence': 0.95},
                    ...
                ],
                'reasoning': str
            }
        """
        capabilities = self._build_capabilities_prompt()
        
        prompt = f"""{capabilities}

## ЗАДАЧА ПОЛЬЗОВАТЕЛЯ
{user_request}

Создай план выполнения этой задачи. ПЛАНИРУЙ ТОЛЬКО САМЫЕ ОЧЕВИДНЫЕ ПЕРВЫЕ 2-4 ШАГА!

ОТВЕТЬ В ФОРМАТЕ JSON:
{{
    "goal": "общая цель задачи",
    "steps": [
        {{
            "action": "CLICK|TYPE|TERMINAL|HOTKEY|WAIT|REPLAN",
            "params": {{
                "element_description": "ДЕТАЛЬНОЕ описание UI элемента по формуле выше"
            }},
            "confidence": 0.0-1.0,
            "reasoning": "почему этот шаг"
        }}
    ],
    "reasoning": "общая логика плана"
}}

⚠️ КРИТИЧНЫЕ ТРЕБОВАНИЯ:
1. Для CLICK используй ТОЛЬКО ключ "element_description"
2. Описание должно следовать формуле: [ФОРМА/ЦВЕТ] + [СОДЕРЖИМОЕ] + [РАСПОЛОЖЕНИЕ]
3. Планируй МАКСИМУМ 2-4 шага (не больше!)
4. Каждый шаг должен иметь confidence > 0.9
5. Если не уверен на 90%+ в следующем шаге - добавь REPLAN

Примеры хороших планов:
- Задача "открыть YouTube" → 2 шага: CLICK(адресная строка), TYPE(youtube.com), WAIT(3), REPLAN
- Задача "найти видео про котов" → 3 шага: CLICK(поле поиска с лупой), TYPE(коты), WAIT(2), REPLAN

НЕ планируй дальше если не видишь экран!
"""
        
        response = self.model.generate_content(prompt)
        plan_text = response.text.strip()
        
        # Извлекаем JSON
        if '```json' in plan_text:
            plan_text = plan_text.split('```json')[1].split('```')[0].strip()
        elif '```' in plan_text:
            plan_text = plan_text.split('```')[1].split('```')[0].strip()
        
        plan = json.loads(plan_text)
        
        # Валидация: не больше max_steps_per_plan шагов
        max_steps = CAPABILITIES['limits']['max_steps_per_plan']
        if len(plan['steps']) > max_steps:
            logger.warning(f"⚠️ План содержит {len(plan['steps'])} шагов, обрезаю до {max_steps}")
            plan['steps'] = plan['steps'][:max_steps]
        
        logger.info(f"📋 Создан план: {len(plan['steps'])} шагов")
        logger.info(f"🎯 Цель: {plan['goal']}")
        
        return plan

    async def replan(self, screenshot_path: str, original_goal: str, 
                    current_state: str, steps_done: List[str]) -> Dict[str, Any]:
        """
        Создает новый план на основе текущего состояния экрана
        
        Args:
            screenshot_path: Путь к скриншоту текущего состояния
            original_goal: Изначальная цель задачи
            current_state: Описание текущего состояния от Vision
            steps_done: Список уже выполненных шагов
        """
        self.replan_count += 1
        
        if self.replan_count > self.max_replans:
            logger.error(f"❌ Превышен лимит replan ({self.max_replans})")
            return {'steps': []}
        
        logger.info(f"🔄 Replan #{self.replan_count}")
        
        capabilities = self._build_capabilities_prompt()
        
        # Загружаем скриншот
        img_file = genai.upload_file(screenshot_path)
        
        steps_done_text = "\n".join([f"{i+1}. {step}" for i, step in enumerate(steps_done)])
        failed_history = self.action_tracker.get_history_text()
        
        prompt = f"""{capabilities}

## ИЗНАЧАЛЬНАЯ ЦЕЛЬ
{original_goal}

## УЖЕ ВЫПОЛНЕНО
{steps_done_text}

## НЕУДАЧНЫЕ ПОПЫТКИ (НЕ ПОВТОРЯЙ!)
{failed_history}

## ТЕКУЩЕЕ СОСТОЯНИЕ (СМОТРИ СКРИНШОТ)
{current_state}

Посмотри на скриншот и создай НОВЫЙ план для достижения цели.

⚠️ НЕ ПОВТОРЯЙ неудачные попытки! Выбери ДРУГОЙ подход!

ОТВЕТЬ В ФОРМАТЕ JSON:
{{
    "steps": [
        {{
            "action": "CLICK|TYPE|TERMINAL|HOTKEY|WAIT|REPLAN",
            "params": {{
                "element_description": "ДЕТАЛЬНОЕ описание UI элемента по формуле [ФОРМА] + [СОДЕРЖИМОЕ] + [РАСПОЛОЖЕНИЕ]"
            }},
            "confidence": 0.0-1.0,
            "reasoning": "почему этот шаг (и почему НЕ повторение неудачной попытки)"
        }}
    ],
    "progress_assessment": "движемся ли к цели или застряли"
}}

КРИТИЧНЫЕ ТРЕБОВАНИЯ:
1. Используй ТОЛЬКО ключ "element_description" (никаких target/query)
2. Описание должно быть КОНКРЕТНЫМ: форма, цвет, расположение
3. Планируй 2-3 шага максимум
4. Confidence > 0.9 для каждого шага
5. Если цель достигнута - верни ПУСТОЙ список steps: []
6. Если видишь что повторяешь неудачу - ОСТАНОВИ СЕБЯ и выбери другой путь

⚠️ НОВАЯ СИСТЕМА КООРДИНАТ:
Система теперь использует сетку 50x50 для точного позиционирования.
Gemini выбирает номер ячейки, мы кликаем в её центр.
Это дает точность ±1% экрана вместо пикселей.

⚠️ ДЛЯ ВВОДА ТЕКСТА:
- Если поле УЖЕ содержит текст → ОБЯЗАТЕЛЬНО: CLICK → HOTKEY('cmd+a') → TYPE
- Без cmd+a получится: "старый_текст + новый_текст"!
- Пример: адресная строка с "about:blank" → нужен cmd+a перед вводом URL

Если застряли (повторяем ошибки 2+ раза) - верни пустой список steps.
"""
        
        response = self.model.generate_content([prompt, img_file])
        plan_text = response.text.strip()
        
        # Извлекаем JSON
        if '```json' in plan_text:
            plan_text = plan_text.split('```json')[1].split('```')[0].strip()
        elif '```' in plan_text:
            plan_text = plan_text.split('```')[1].split('```')[0].strip()
        
        plan = json.loads(plan_text)
        
        # Валидация: не больше max_steps_per_plan шагов
        max_steps = CAPABILITIES['limits']['max_steps_per_plan']
        if len(plan.get('steps', [])) > max_steps:
            logger.warning(f"⚠️ План содержит {len(plan['steps'])} шагов, обрезаю до {max_steps}")
            plan['steps'] = plan['steps'][:max_steps]
        
        logger.info(f"📋 Новый план: {len(plan.get('steps', []))} шагов")
        logger.info(f"📊 Прогресс: {plan.get('progress_assessment', 'не указан')}")
        
        # Проверяем прогресс
        if not self.tracker.update(current_state):
            logger.error("❌ Застряли! Останавливаем выполнение")
            return {'steps': []}
        
        return plan

    async def execute_step(self, step: Dict[str, Any], monitor_info: Dict) -> Dict[str, Any]:
        """
        Выполняет один шаг плана
        
        Returns:
            {
                'success': bool,
                'result': str,
                'needs_replan': bool
            }
        """
        action = step['action']
        params = step.get('params', {})
        
        logger.info(f"▶️ Выполняю: {action} {params}")
        
        try:
            # MCP Actions (приоритет 3)
            if action.startswith('MCP_'):
                return await self._execute_mcp_action(action, params, monitor_info)
            
            # Traditional actions
            elif action == 'CLICK':
                return await self._execute_click(params, monitor_info)
            
            elif action == 'TYPE':
                return await self._execute_type(params)
            
            elif action == 'TERMINAL':
                return await self._execute_terminal(params)
            
            elif action == 'HOTKEY':
                return await self._execute_hotkey(params)
            
            elif action == 'WAIT':
                return await self._execute_wait(params)
            
            elif action == 'REPLAN':
                return {
                    'success': True,
                    'result': 'Требуется replan',
                    'needs_replan': True
                }
            
            else:
                return {
                    'success': False,
                    'result': f'Неизвестное действие: {action}',
                    'needs_replan': False
                }
                
        except Exception as e:
            logger.error(f"❌ Ошибка выполнения шага: {e}", exc_info=True)
            return {
                'success': False,
                'result': str(e),
                'needs_replan': False
            }

    async def _execute_mcp_action(self, action: str, params: Dict, monitor_info: Dict) -> Dict:
        """
        Выполняет MCP действие с автоматическим fallback на VISUAL_CLICK
        
        Args:
            action: MCP_NAVIGATE, MCP_CLICK, MCP_EXECUTE_JS, MCP_TYPE
            params: Параметры действия
            monitor_info: Информация о мониторе
            
        Returns:
            Результат выполнения с флагом needs_replan
        """
        # Lazy init Chrome MCP
        if not self.chrome_mcp:
            self.chrome_mcp = await get_chrome_mcp_integration()
        
        # Выполняем MCP действие
        result = await self.chrome_mcp.execute_action(action, params)
        
        if result['success']:
            # MCP успешно выполнилось
            logger.info(f"✅ {result['result']}")
            return {
                'success': True,
                'result': result['result'],
                'needs_replan': False
            }
        
        elif result.get('needs_fallback'):
            # MCP не удалось, пробуем fallback
            logger.warning(f"⚠️ MCP failed: {result['result']}")
            logger.info("💡 Пробую fallback на VISUAL_CLICK...")
            
            # Fallback: MCP_CLICK → CLICK
            if action == 'MCP_CLICK':
                # Извлекаем описание из селектора или используем общее
                selector = params.get('selector', '')
                element_desc = f"элемент с селектором {selector}" if selector else "элемент на странице"
                
                fallback_params = {'element_description': element_desc}
                return await self._execute_click(fallback_params, monitor_info)
            
            # Для других MCP действий fallback нет - нужен replan
            else:
                self.action_tracker.add_failed(action, params, result['result'])
                return {
                    'success': False,
                    'result': f"{result['result']} (fallback недоступен)",
                    'needs_replan': True
                }
        
        else:
            # Критическая ошибка без fallback
            self.action_tracker.add_failed(action, params, result['result'])
            return {
                'success': False,
                'result': result['result'],
                'needs_replan': True
            }

    async def _execute_click(self, params: Dict, monitor_info: Dict) -> Dict:
        """Выполняет клик по элементу через Vision"""
        from self_correcting_executor import SelfCorrectingExecutor
        
        # Передаем наш ScreenManager в executor
        executor = SelfCorrectingExecutor(screen_manager=self.screen)
        
        # Извлекаем описание элемента - ТОЛЬКО из element_description
        element_desc = params.get('element_description', '').strip()
        
        # Валидация описания
        is_valid, error_msg = validate_element_description(element_desc)
        if not is_valid:
            logger.error(f"❌ Невалидное описание: {error_msg}")
            logger.error(f"   Получено: '{element_desc}'")
            self.action_tracker.add_failed("CLICK", params, f"Невалидное описание: {error_msg}")
            return {
                'success': False, 
                'result': f'Невалидное описание элемента: {error_msg}', 
                'needs_replan': True
            }
        
        # Проверяем не повторяем ли мы неудачную попытку
        if self.action_tracker.is_repeating("CLICK", params):
            logger.warning(f"⚠️ Попытка повторить неудачный CLICK: {element_desc[:50]}")
            self.action_tracker.add_failed("CLICK", params, "Повторение неудачной попытки")
            return {
                'success': False,
                'result': f'Повторение неудачной попытки: {element_desc}',
                'needs_replan': True
            }
        
        # Делаем скриншот
        screenshot = self.screen.capture_secondary_monitor()
        await asyncio.sleep(1)
        
        # Ищем элемент
        element = await executor.find_element_coordinates(screenshot, element_desc, monitor_info)
        
        # confidence теперь строка: 'высокая', 'средняя', 'низкая'
        confidence_ok = element.get('confidence', 'низкая') in ['высокая', 'средняя']
        if element['found'] and confidence_ok:
            logger.info(f"✅ Элемент найден: {element_desc[:50]}")
            self.screen.click_at(element['x'], element['y'], force=True)
            await asyncio.sleep(1)
            return {'success': True, 'result': f'Кликнул на {element_desc[:50]}', 'needs_replan': False}
        else:
            logger.warning(f"❌ Элемент не найден: {element_desc[:50]}")
            self.action_tracker.add_failed("CLICK", params, "Элемент не найден Vision'ом")
            return {'success': False, 'result': f'Не найден элемент: {element_desc[:50]}', 'needs_replan': True}

    async def _execute_type(self, params: Dict) -> Dict:
        """Вводит текст"""
        text = params.get('text', '')
        safe_text = text.replace('\\', '\\\\').replace('"', '\\"')
        
        script = f'''
        tell application "System Events"
            keystroke "{safe_text}"
        end tell
        '''
        subprocess.run(['osascript', '-e', script], timeout=10)
        await asyncio.sleep(0.5)
        
        return {'success': True, 'result': f'Ввел текст: {text}', 'needs_replan': False}

    async def _execute_terminal(self, params: Dict) -> Dict:
        """Выполняет команду в терминале"""
        command = params.get('command', '')
        cwd = params.get('cwd', os.path.expanduser('~'))
        
        result = subprocess.run(command, shell=True, cwd=cwd, 
                              capture_output=True, text=True, timeout=30)
        
        return {
            'success': result.returncode == 0,
            'result': result.stdout or result.stderr,
            'needs_replan': False
        }

    async def _execute_hotkey(self, params: Dict) -> Dict:
        """Нажимает горячую клавишу"""
        combo = params.get('combo', '')
        
        # Парсим комбинацию (например "cmd+f")
        parts = combo.lower().split('+')
        
        # Преобразуем в формат pyautogui
        modifiers = []
        key = parts[-1]
        
        for part in parts[:-1]:
            if part in ['cmd', 'command']:
                modifiers.append('command')
            elif part in ['ctrl', 'control']:
                modifiers.append('ctrl')
            elif part in ['alt', 'option']:
                modifiers.append('alt')
            elif part == 'shift':
                modifiers.append('shift')
        
        pyautogui.hotkey(*modifiers, key)
        await asyncio.sleep(0.5)
        
        return {'success': True, 'result': f'Нажата комбинация: {combo}', 'needs_replan': False}

    async def _execute_wait(self, params: Dict) -> Dict:
        """Ждет указанное время"""
        seconds = min(10, max(1, params.get('seconds', 2)))
        await asyncio.sleep(seconds)
        return {'success': True, 'result': f'Подождал {seconds}с', 'needs_replan': False}
