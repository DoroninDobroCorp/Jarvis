"""
Chrome DevTools MCP Client
Интеграция с Chrome DevTools через Model Context Protocol
"""

import asyncio
import logging
from typing import Any, Optional

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger(__name__)


class ChromeMCPClient:
    """Клиент для работы с Chrome DevTools через MCP"""
    
    def __init__(self):
        self.session: Optional[ClientSession] = None
        self._client_context = None
        
    async def connect(self):
        """Установить соединение с Chrome DevTools MCP сервером"""
        try:
            # Параметры для запуска Chrome DevTools MCP через stdio
            server_params = StdioServerParameters(
                command="npx",
                args=["chrome-devtools-mcp@latest"],
            )
            
            logger.info("Запуск Chrome DevTools MCP сервера...")
            
            # Создаем клиент через stdio
            self._client_context = stdio_client(server_params)
            read, write = await self._client_context.__aenter__()
            
            # Инициализируем сессию
            self.session = ClientSession(read, write)
            await self.session.__aenter__()
            
            # Инициализация протокола
            await self.session.initialize()
            
            logger.info("Chrome DevTools MCP подключен успешно")
            
            # Получаем список доступных инструментов
            tools = await self.list_tools()
            logger.info(f"Доступно {len(tools)} инструментов Chrome DevTools")
            
            return True
            
        except Exception as e:
            logger.error(f"Ошибка подключения к Chrome DevTools MCP: {e}")
            return False
    
    async def disconnect(self):
        """Закрыть соединение"""
        try:
            if self.session:
                await self.session.__aexit__(None, None, None)
            if self._client_context:
                await self._client_context.__aexit__(None, None, None)
            logger.info("Chrome DevTools MCP отключен")
        except Exception as e:
            logger.error(f"Ошибка при отключении Chrome DevTools MCP: {e}")
    
    async def list_tools(self) -> list[dict[str, Any]]:
        """Получить список доступных инструментов"""
        if not self.session:
            raise RuntimeError("MCP сессия не инициализирована")
        
        tools_response = await self.session.list_tools()
        return tools_response.tools
    
    async def fill_input(self, selector_or_uid: str, text: str, is_uid: bool = False) -> Any:
        """
        Заполнить поле ввода текстом
        
        Args:
            selector_or_uid: CSS селектор или uid поля
            text: Текст для ввода
            is_uid: True если передан uid, False если selector
        """
        if is_uid:
            # Используем uid напрямую
            return await self.call_tool("fill", {"uid": selector_or_uid, "value": text})
        else:
            # Используем selector (если MCP поддерживает) или через JavaScript
            # Проверяем что работает - пробуем через JavaScript для универсальности
            js_code = f"""
            const el = document.querySelector('{selector_or_uid}');
            if (el) {{
                el.value = '{text}';
                el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                el.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}
            """
            return await self.execute_javascript(js_code)
    
    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """
        Вызвать инструмент Chrome DevTools
        
        Args:
            tool_name: Имя инструмента
            arguments: Аргументы для инструмента
            
        Returns:
            Результат выполнения инструмента
        """
        if not self.session:
            raise RuntimeError("MCP сессия не инициализирована")
        
        try:
            logger.info(f"Вызов инструмента Chrome DevTools: {tool_name}")
            logger.debug(f"Аргументы: {arguments}")
            
            result = await self.session.call_tool(tool_name, arguments)
            
            logger.debug(f"Результат: {result}")
            return result
            
        except Exception as e:
            logger.error(f"Ошибка при вызове инструмента {tool_name}: {e}")
            raise
    
    async def navigate_to_url(self, url: str) -> Any:
        """
        Открыть URL в Chrome
        
        Args:
            url: URL для открытия
        """
        return await self.call_tool("navigate_page", {"url": url})
    
    async def click_element(self, selector: str) -> Any:
        """
        Кликнуть по элементу через селектор
        
        Args:
            selector: CSS селектор элемента
        """
        return await self.call_tool("click", {"selector": selector})
    
    async def execute_javascript(self, code: str) -> Any:
        """
        Выполнить JavaScript код в браузере
        
        Args:
            code: JavaScript код для выполнения (должен быть function)
        """
        # evaluate_script требует функцию, оборачиваем код
        func_code = f"() => {{ return {code}; }}"
        return await self.call_tool("evaluate_script", {"function": func_code})
    
    async def get_page_content(self) -> Any:
        """Получить содержимое текущей страницы"""
        return await self.call_tool("take_snapshot", {})
    
    async def screenshot(self) -> Any:
        """Сделать скриншот текущей страницы"""
        return await self.call_tool("take_screenshot", {})


# Singleton instance для использования в проекте
_chrome_mcp_client: Optional[ChromeMCPClient] = None


async def get_chrome_mcp_client() -> ChromeMCPClient:
    """
    Получить или создать singleton instance Chrome MCP клиента
    """
    global _chrome_mcp_client
    
    if _chrome_mcp_client is None:
        _chrome_mcp_client = ChromeMCPClient()
        await _chrome_mcp_client.connect()
    
    return _chrome_mcp_client


async def close_chrome_mcp_client():
    """Закрыть Chrome MCP клиент"""
    global _chrome_mcp_client
    
    if _chrome_mcp_client:
        await _chrome_mcp_client.disconnect()
        _chrome_mcp_client = None


# Пример использования
if __name__ == "__main__":
    async def main():
        # Настройка логирования
        logging.basicConfig(
            level=logging.DEBUG,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        
        client = ChromeMCPClient()
        
        try:
            # Подключение
            await client.connect()
            
            # Получить список инструментов
            tools = await client.list_tools()
            print(f"\nДоступные инструменты ({len(tools)}):")
            for tool in tools:
                print(f"  - {tool.get('name')}: {tool.get('description', 'N/A')}")
            
            # Пример: открыть страницу
            # await client.navigate_to_url("https://example.com")
            
        finally:
            await client.disconnect()
    
    # Запуск
    asyncio.run(main())
