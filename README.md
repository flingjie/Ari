# 阿理（Ari）

五阶段思考助手：在五个独立页面完成一次真实思考任务（以《结构化思考》的 5P 为方法来源）——目的、片段、视角、支柱、表达。每页只做当前阶段的工作，可随时回看、修改和恢复。

- 前端：React 18 + TypeScript + Vite 5 + React Router 6
- 后端：FastAPI + Pydantic v2 + SQLite（stdlib `sqlite3`）
- AI：OpenAI 兼容网关（结构化输出，参考 Finch 的 `llm/` 实现）

## 目录

```
backend/   FastAPI 后端
frontend/  React 前端
docs/      契约与说明
```

## 构建与启动

### 后端

```bash
cd backend
uv sync                                    # 安装依赖（Python 3.12+）
uv run uvicorn ari.main:app --reload --port 8000
```

首次启动会在 `backend/ari.db` 建表（SQLite WAL）。数据库路径见 `backend/ari.yaml` 的 `app.database_path`。

### 前端

```bash
cd frontend
npm install
npm run dev                                # http://localhost:5173
```

Vite 开发服务器把 `/api` 代理到 `http://localhost:8000`。打开 http://localhost:5173，选择「空白」或「教程示例」开始。

## 配置 AI（可选）

AI 阶段助手使用 OpenAI 兼容网关。未配置时走纯手工路径（导出仍是确定性的）。

1. 复制模板：`cp backend/ari.example.yaml backend/ari.yaml`。
2. 设置模型：编辑 `backend/ari.yaml` 的 `llm.model`，或在 `.env` 设 `LLM_MODEL`。
3. 设置网关与密钥：`.env` 设 `LLM_BASE_URL` 与 `LLM_API_KEY`（优先于 ari.yaml）。

密钥只由后端读取，不进入前端。

## 测试与检查

```bash
cd backend
uv run pytest              # 操作校验、幂等、冲突、导出、提案物化
uv run ruff check .
uv run mypy src

cd ../frontend
npm run build              # tsc 类型检查 + 打包
```

## 数据库迁移

首版无 Alembic。`db.py` 的建表语句是幂等的，新增表在应用启动时执行。变更列结构需手动迁移或删库重建（本地单用户 MVP）。

## 关键语义

- `pieces.parent_id` 树表示采集上下文（例如「读者反馈」下面挂一条原话）。
- `assignments` 表示选定视角下的归属。同一条原话可在不同视角归不同支柱，两种关系分别保存。
- 删除分支在一个事务内删除整棵子树及所有视角中相关归属。
- 快照只保存当前版本；写请求带 `request_id` + `base_revision` 实现幂等与乐观并发。
