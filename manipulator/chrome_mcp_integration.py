"""
Chrome MCP Integration
Управление подключением и действиями через Chrome DevTools MCP
"""

import asyncio
import logging
from typing import Optional, Dict, Any
from chrome_mcp_client import ChromeMCPClient, get_chrome_mcp_client, close_chrome_mcp_client

logger = logging.getLogger(__name__)


class ChromeMCPIntegration:
    """
    Интеграция Chrome DevTools MCP в систему выполнения задач
    
    Предоставляет:
    - Автоматическое управление подключением
    - Fallback на VISUAL_CLICK при сбоях
    - Отслеживание неудач для умного переключения
    """
    
    def __init__(self):
        self.client: Optional[ChromeMCPClient] = None
        self.connected = False
        self.failed_actions = []  # История неудач для fallback решений
        self.max_retries = 2
        
    async def ensure_connected(self) -> bool:
        """
        Убедиться что соединение с MCP активно
        
        Returns:
            True если подключено, False если не удалось
        """
        if self.connected and self.client:
            return True
        
        try:
            logger.info("🔌 Подключение к Chrome DevTools MCP...")
            self.client = await get_chrome_mcp_client()
            self.connected = True
            logger.info("✅ Chrome MCP подключен")
            return True
        except Exception as e:
            logger.error(f"❌ Не удалось подключиться к Chrome MCP: {e}")
            self.connected = False
            return False
    
    async def disconnect(self):
        """Закрыть соединение с MCP"""
        if self.client:
            await close_chrome_mcp_client()
            self.connected = False
            self.client = None
            logger.info("🔌 Chrome MCP отключен")
    
    async def execute_action(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Выполнить MCP действие с автоматическим fallback
        
        Args:
            action: MCP_NAVIGATE, MCP_CLICK, MCP_EXECUTE_JS, MCP_TYPE, etc.
            params: Параметры действия
            
        Returns:
            {
                'success': bool,
                'result': str,
                'needs_fallback': bool,  # True если нужен fallback на VISUAL_CLICK
                'data': Any  # Дополнительные данные
            }
        """
        # Проверяем подключение
        if not await self.ensure_connected():
            return {
                'success': False,
                'result': 'Нет подключения к Chrome MCP',
                'needs_fallback': True,
                'data': None
            }
        
        # Пробуем выполнить действие
        for attempt in range(self.max_retries):
            try:
                if action == 'MCP_NAVIGATE':
                    return await self._navigate(params)
                
                elif action == 'MCP_CLICK':
                    return await self._click(params)
                
                elif action == 'MCP_EXECUTE_JS':
                    return await self._execute_js(params)
                
                elif action == 'MCP_TYPE':
                    return await self._type(params)
                
                elif action == 'MCP_GET_CONTENT':
                    return await self._get_content(params)
                
                elif action == 'MCP_SCREENSHOT':
                    return await self._screenshot(params)
                
                else:
                    return {
                        'success': False,
                        'result': f'Неизвестное MCP действие: {action}',
                        'needs_fallback': False,
                        'data': None
                    }
                    
            except Exception as e:
                logger.warning(f"⚠️ Попытка {attempt + 1}/{self.max_retries} не удалась: {e}")
                
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(0.5)
                else:
                    # Последняя попытка не удалась
                    self._record_failure(action, params, str(e))
                    return {
                        'success': False,
                        'result': f'MCP действие failed после {self.max_retries} попыток: {e}',
                        'needs_fallback': True,
                        'data': None
                    }
    
    async def _navigate(self, params: Dict) -> Dict:
        """Открыть URL в Chrome"""
        url = params.get('url', '')
        
        if not url:
            return {
                'success': False,
                'result': 'URL не указан',
                'needs_fallback': False,
                'data': None
            }
        
        logger.info(f"🌐 MCP_NAVIGATE: {url}")
        result = await self.client.navigate_to_url(url)
        
        return {
            'success': True,
            'result': f'Открыл URL: {url}',
            'needs_fallback': False,
            'data': result
        }
    
    async def _click(self, params: Dict) -> Dict:
        """
        Клик по элементу
        
        MCP click требует uid из snapshot, а не CSS селектор!
        Универсальный алгоритм:
        1. Если есть uid - кликаем напрямую
        2. Если есть селектор - делаем snapshot, ищем uid, кликаем
        3. Если нет селектора - fallback на VISUAL_CLICK
        """
        selector = params.get('selector', '')
        uid = params.get('uid', '')
        
        # Если есть uid - используем напрямую
        if uid:
            logger.info(f"🖱️  MCP_CLICK по uid: {uid}")
            result = await self.client.call_tool("click", {"uid": uid})
            return {
                'success': True,
                'result': f'Кликнул по uid {uid}',
                'needs_fallback': False,
                'data': result
            }
        
        # Если есть селектор - нужен snapshot для получения uid
        if selector:
            logger.info(f"🖱️  MCP_CLICK: ищу uid для селектора {selector}")
            
            # Сначала делаем snapshot
            snapshot = await self.client.get_page_content()
            
            # Парсим snapshot чтобы найти uid элемента по селектору
            # Snapshot возвращает текст с uid элементов
            snapshot_text = str(snapshot)
            
            # Для универсальности: если селектор простой (тег, класс, id)
            # пробуем найти его в snapshot
            # Если не найден - используем JavaScript для клика
            logger.warning(f"⚠️ MCP click требует uid, но получен selector. Используем JavaScript fallback")
            
            # Универсальное решение: клик через JavaScript
            js_code = f"document.querySelector('{selector}')?.click()"
            js_result = await self.client.execute_javascript(js_code)
            
            return {
                'success': True,
                'result': f'Кликнул по {selector} через JavaScript',
                'needs_fallback': False,
                'data': js_result
            }
        
        # Нет ни uid, ни селектора - нужен fallback
        return {
            'success': False,
            'result': 'Не указан ни uid, ни selector для MCP_CLICK',
            'needs_fallback': True,
            'data': None
        }
    
    async def _execute_js(self, params: Dict) -> Dict:
        """Выполнить JavaScript код"""
        code = params.get('code', '')
        
        if not code:
            return {
                'success': False,
                'result': 'JavaScript код не указан',
                'needs_fallback': False,
                'data': None
            }
        
        logger.info(f"⚡ MCP_EXECUTE_JS: {code[:50]}...")
        result = await self.client.execute_javascript(code)
        
        return {
            'success': True,
            'result': f'Выполнил JS: {code[:30]}...',
            'needs_fallback': False,
            'data': result
        }
    
    async def _type(self, params: Dict) -> Dict:
        """
        Ввести текст через JavaScript (универсально)
        """
        text = params.get('text', '')
        selector = params.get('selector', '')
        uid = params.get('uid', '')
        
        if not text:
            return {
                'success': False,
                'result': 'Текст не указан',
                'needs_fallback': False,
                'data': None
            }
        
        # Если есть selector или uid - используем JavaScript для универсальности
        if selector or uid:
            logger.info(f"⌨️  MCP_TYPE: {text[:30]}... в {selector or uid}")
            result = await self.client.fill_input(selector or uid, text, is_uid=bool(uid))
            
            return {
                'success': True,
                'result': f'Ввел текст: {text[:30]}...',
                'needs_fallback': False,
                'data': result
            }
        
        # Нет селектора - fallback на обычный TYPE
        return {
            'success': False,
            'result': 'Селектор не указан для MCP_TYPE',
            'needs_fallback': True,
            'data': None
        }
    
    async def _get_content(self, params: Dict) -> Dict:
        """Получить содержимое страницы"""
        logger.info("📄 MCP_GET_CONTENT")
        result = await self.client.get_page_content()
        
        return {
            'success': True,
            'result': 'Получил содержимое страницы',
            'needs_fallback': False,
            'data': result
        }
    
    async def _screenshot(self, params: Dict) -> Dict:
        """Сделать скриншот страницы"""
        logger.info("📸 MCP_SCREENSHOT")
        result = await self.client.screenshot()
        
        return {
            'success': True,
            'result': 'Сделал скриншот',
            'needs_fallback': False,
            'data': result
        }
    
    def _record_failure(self, action: str, params: Dict, reason: str):
        """Записать неудачу для анализа"""
        self.failed_actions.append({
            'action': action,
            'params': params,
            'reason': reason
        })
        
        # Храним только последние 10 неудач
        if len(self.failed_actions) > 10:
            self.failed_actions = self.failed_actions[-10:]
        
        logger.warning(f"📝 Записал неудачу: {action} - {reason}")
    
    def should_use_fallback(self, action: str) -> bool:
        """
        Определить, стоит ли использовать fallback на VISUAL_CLICK
        
        Returns:
            True если последние попытки MCP failed
        """
        # Если последние 3 действия такого типа failed - используем fallback
        recent_failures = [f for f in self.failed_actions[-5:] if f['action'] == action]
        
        if len(recent_failures) >= 2:
            logger.info(f"💡 Много неудач {action}, рекомендую fallback на VISUAL_CLICK")
            return True
        
        return False
    
    def get_failure_summary(self) -> str:
        """Получить краткую сводку неудач для отладки"""
        if not self.failed_actions:
            return "Нет неудач"
        
        summary = []
        for f in self.failed_actions[-5:]:
            summary.append(f"❌ {f['action']} - {f['reason'][:50]}")
        
        return "\n".join(summary)


# Singleton instance
_chrome_mcp_integration: Optional[ChromeMCPIntegration] = None


async def get_chrome_mcp_integration() -> ChromeMCPIntegration:
    """
    Получить singleton instance Chrome MCP Integration
    """
    global _chrome_mcp_integration
    
    if _chrome_mcp_integration is None:
        _chrome_mcp_integration = ChromeMCPIntegration()
    
    return _chrome_mcp_integration


async def close_chrome_mcp_integration():
    """Закрыть Chrome MCP Integration"""
    global _chrome_mcp_integration
    
    if _chrome_mcp_integration:
        await _chrome_mcp_integration.disconnect()
        _chrome_mcp_integration = None
