"""共享依赖：配置加载 + 每请求一个 SQLite 连接。"""

from __future__ import annotations

from ..db import connect
from ..settings import load_settings

settings = load_settings()


def get_conn():
    """FastAPI 依赖：打开连接，请求结束关闭。"""
    conn = connect(settings.app.database_path)
    try:
        yield conn
    finally:
        conn.close()
