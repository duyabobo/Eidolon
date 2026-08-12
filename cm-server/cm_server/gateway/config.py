"""合并后的统一配置见 cm_server.config；此处仅按原路径转发，保持各子包内部
`from config import settings` 类导入改前缀后可直接使用，无需再改字段访问方式。
"""
from cm_server.config import settings

__all__ = ["settings"]
