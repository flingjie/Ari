"""配置加载：ari.yaml + 环境变量覆盖（对齐 Finch 的 settings 模式）。

- 非敏感配置放 ``backend/ari.yaml``（gitignored），模板 ``ari.example.yaml`` 提交；
- 密钥与网关地址读环境变量（``LLM_API_KEY`` / ``LLM_BASE_URL`` / ``LLM_MODEL``），
  优先于 ari.yaml；``.env`` 由 load_dotenv 从仓库根与 backend 目录分别加载。
"""

from __future__ import annotations

import os
from pathlib import Path

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field

# 仓库根（backend/ 的父目录）；本文件位于 backend/src/ari/settings.py。
BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent


class LLMNodeSettings(BaseModel):
    """单个 LLM 节点的模型/超时/输出上限覆盖。"""

    model: str = ""
    timeout_seconds: float = 90.0
    max_output_tokens: int | None = None


class LLMSettings(BaseModel):
    """OpenAI 兼容网关配置（base_url + model；api_key 优先读环境变量）。"""

    base_url: str = ""
    model: str = ""
    api_key: str = ""
    nodes: dict[str, LLMNodeSettings] = Field(default_factory=dict)

    def for_node(self, name: str) -> LLMNodeSettings:
        node = self.nodes.get(name)
        if node is None:
            return LLMNodeSettings(model=self.model)
        return LLMNodeSettings(
            model=node.model or self.model,
            timeout_seconds=node.timeout_seconds,
            max_output_tokens=node.max_output_tokens,
        )


class AppSettings(BaseModel):
    """应用配置：数据库路径 + 示例工作区模板。"""

    database_path: str = "ari.db"


class Settings(BaseModel):
    app: AppSettings = Field(default_factory=AppSettings)
    llm: LLMSettings = Field(default_factory=LLMSettings)


def _resolve_llm(raw: dict, llm: LLMSettings) -> LLMSettings:
    """环境变量覆盖：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。"""
    base_url = os.environ.get("LLM_BASE_URL") or raw.get("base_url") or llm.base_url
    api_key = os.environ.get("LLM_API_KEY") or raw.get("api_key") or llm.api_key
    model = os.environ.get("LLM_MODEL") or raw.get("model") or llm.model
    nodes = raw.get("nodes") or {}
    return LLMSettings(
        base_url=base_url,
        api_key=api_key,
        model=model,
        nodes={name: LLMNodeSettings(**cfg) for name, cfg in nodes.items()},
    )


def load_settings(path: Path | None = None) -> Settings:
    """从 ari.yaml 读取配置；缺省使用内置默认值。环境变量覆盖 LLM 项。"""
    # 依次加载仓库根与 backend 目录的 .env（后者覆盖前者；已存在的环境变量不被覆盖）。
    load_dotenv(REPO_ROOT / ".env")
    load_dotenv(BACKEND_DIR / ".env")

    target = path if path is not None else BACKEND_DIR / "ari.yaml"
    data: dict = {}
    if target.exists():
        data = yaml.safe_load(target.read_text()) or {}

    app = AppSettings(**data.get("app", {}))
    llm = _resolve_llm(data.get("llm", {}), LLMSettings())
    return Settings(app=app, llm=llm)
