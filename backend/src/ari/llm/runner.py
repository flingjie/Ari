"""OpenAI 兼容的纯结构化推理 runner（无工具、单次 HTTP 调用，移植 Finch）。

只用 OpenAI 兼容网关这一条路径；不涉及 codex 子进程。
用 ``httpx`` 异步 POST 到 ``{base_url}/chat/completions``；
``temperature=0``；把 Pydantic JSON Schema 放进 system prompt；容忍 markdown 代码块。
"""

from __future__ import annotations

import json

import httpx
from pydantic import BaseModel

from ..settings import LLMNodeSettings, LLMSettings
from .structured_output import StructuredOutputError, load_json, parse_checked


class OpenAICompatibleRunner:
    """调用任意 OpenAI 兼容 ``/chat/completions`` 端点。"""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        *,
        timeout: float = 90.0,
        max_tokens: int | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.max_tokens = max_tokens

    async def run(
        self,
        prompt: str,
        output_model: type[BaseModel],
        *,
        timeout: float | None = None,
        max_attempts: int = 2,
    ) -> BaseModel:
        effective_timeout = self.timeout if timeout is None else timeout
        last_error: Exception | None = None
        for _ in range(max_attempts):
            try:
                return await self._run_once(prompt, output_model, timeout=effective_timeout)
            except (json.JSONDecodeError, StructuredOutputError) as exc:
                last_error = exc
        raise StructuredOutputError(
            f"LLM failed to produce valid structured output after {max_attempts} "
            f"attempts: {last_error}"
        ) from last_error

    async def _run_once(
        self, prompt: str, output_model: type[BaseModel], *, timeout: float
    ) -> BaseModel:
        schema = json.dumps(output_model.model_json_schema())
        payload: dict = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a structured-output engine. Return only valid JSON "
                        f"matching this JSON Schema:\n{schema}"
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0,
        }
        if self.max_tokens is not None:
            payload["max_tokens"] = self.max_tokens

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self.api_key}",
                    },
                )
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            raise RuntimeError(f"LLM request timed out after {timeout:g}s") from exc
        except httpx.HTTPStatusError as exc:
            detail = (exc.response.text or "")[:200]
            raise RuntimeError(
                f"LLM request failed ({exc.response.status_code}): {detail}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"LLM request failed: {exc}") from exc

        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("LLM response missing choices")
        first = choices[0]
        content = (first.get("message") or {}).get("content")
        if content is None:
            content = (first.get("delta") or {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("LLM response missing text content")
        return parse_checked(load_json(content), output_model)


def create_runner(
    llm: LLMSettings, node_name: str | None = None
) -> OpenAICompatibleRunner | None:
    """从配置构建 runner；缺 base_url / api_key / model 时返回 None（走纯手工路径）。"""
    if not llm.base_url:
        return None
    if not llm.api_key:
        return None
    node = llm.for_node(node_name) if node_name else LLMNodeSettings(model=llm.model)
    if not node.model:
        return None
    return OpenAICompatibleRunner(
        base_url=llm.base_url,
        api_key=llm.api_key,
        model=node.model,
        timeout=node.timeout_seconds,
        max_tokens=node.max_output_tokens,
    )
