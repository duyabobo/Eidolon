"""
McpAggregatorManager 单例。

独立模块的原因：lifespan（main.py）和路由（routes/mcp.py）都需要访问同一个 manager 实例，
通过模块级单例共享，避免在 app.state 中传递或重复初始化。
"""
from config import settings
from services.aggregator_manager import McpAggregatorManager

manager = McpAggregatorManager(refresh_interval_s=settings.tool_refresh_interval_s)
