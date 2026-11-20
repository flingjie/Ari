"""FastAPI 应用入口。

启动：``uv run uvicorn ari.main:app --reload --port 8000``
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.deps import settings
from .api.workspaces import router
from .db import connect, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = connect(settings.app.database_path)
    try:
        init_db(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="Ari", version="0.1.0", lifespan=lifespan)

# 本地开发：前端（Vite）与后端跨端口；无 cookie 认证，放开来源。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/workspaces")
