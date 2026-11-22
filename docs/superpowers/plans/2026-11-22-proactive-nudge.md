# 阿理主动引导（Nudge）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让阿理在进入空阶段、结构候选信号命中时主动检查是否开口，沉默合法，开口则写入对话并可附带可采纳提案。

**Architecture:** 前端规则产生候选信号（同轮只选一个）→ `POST /workspaces/{id}/nudges` → 后端复核条件、去重、并发抑制、沉默缓存 → LLM 结构化输出含 `speak` → 前端按 revision 保守丢弃过时响应。idle 第一版只做轻量入口，不调模型。

**Tech Stack:** FastAPI + Pydantic + 现有 `OpenAICompatibleRunner`；React 18 + TypeScript；pytest；无前端单测框架（前端纯函数 + `npm run build` + 手工清单）。

**Spec:** `docs/superpowers/specs/2026-11-22-proactive-nudge-design.md`

## Global Constraints

- 第一版上线：`stage_entry`、`structure_issue`；`idle` 仅轻量入口，不调 LLM。
- `speak=false` → HTTP 204，不落库；相关内容指纹未变时不重试 LLM。
- 主动消息 `question` 存空串（列保持 `NOT NULL`）；用可空 `trigger` 列判别。
- 提案权限沿用 `STAGE_ALLOWED_OPS`；主动消息权限不大于用户提问。
- 同轮只选一个触发；触发源冷却 5 分钟；workspace 级发言冷却 3 分钟。
- 同阶段 pending 提案阻止 nudge；其他阶段不阻止。
- 响应到达时本地 revision ≠ 请求 revision → 丢弃不展示。
- LLM 未配置 → 204（不是 503）。
- 提示词质量：一次一问、引用具体内容/操作、不推断情绪、优先澄清、素材不足先问、无增益则沉默。

## File Structure

| 文件 | 职责 |
|------|------|
| `backend/src/ari/domain/nudge.py` | 候选信号评估、条件复核、内容指纹、observed_values（纯函数） |
| `backend/src/ari/domain/nudge_runtime.py` | 进程内：in-flight 并发抑制、沉默缓存（可测试、可清空） |
| `backend/src/ari/agents/nudge.py` | `speak` 增强输出模型、提示词渲染 |
| `backend/src/ari/prompts/nudge.md` | 主动引导提示词 |
| `backend/src/ari/db.py` | `messages.trigger` 列迁移 |
| `backend/src/ari/domain/proposals.py` | `create_message` / `store_message_and_proposal` 支持 `trigger` |
| `backend/src/ari/api/schemas.py` | `NudgeRequest`；`MessageSummary.trigger` |
| `backend/src/ari/api/workspaces.py` | `POST /{id}/nudges` |
| `backend/tests/test_nudge.py` | 领域 + 端点测试 |
| `docs/contract.md` | 登记 nudge API |
| `frontend/src/lib/nudgeSignals.ts` | 候选信号纯函数（与后端语义对齐） |
| `frontend/src/lib/recentActions.ts` | 当前会话语义操作环形缓冲 |
| `frontend/src/lib/useProactiveTrigger.ts` | 触发 hook：冷却、优先级、发请求 |
| `frontend/src/api/client.ts` | `sendNudge`；204 → `null` |
| `frontend/src/store/chat.tsx` | `sendNudge`、过时丢弃、`trigger` 字段 |
| `frontend/src/components/ChatPanel.tsx` | 主动消息渲染；idle 轻入口 |
| `frontend/src/App.tsx` | 挂载 hook；stage_entry 固定引导条 |

---

### Task 1: 领域层 — 候选信号评估与指纹

**Files:**
- Create: `backend/src/ari/domain/nudge.py`
- Test: `backend/tests/test_nudge.py`

**Interfaces:**
- Produces:
  - `Trigger = Literal["stage_entry", "structure_issue", "idle"]`
  - `RuleId = Literal["stage_entry", "unassigned_pieces", "no_pillars", "purpose_empty"]`
  - `content_piece_count(snapshot) -> int`（排除 root）
  - `unassigned_count(snapshot) -> int`（无 active perspective → 0）
  - `stage_is_empty(snapshot, stage) -> bool`
  - `prior_stages_have_content(snapshot, stage) -> bool`
  - `rule_holds(snapshot, rule_id: RuleId, stage: str) -> bool`
  - `observed_values(snapshot, rule_id) -> dict`
  - `content_fingerprint(snapshot, rule_id) -> str`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_nudge.py
from ari.domain.nudge import (
    content_fingerprint,
    content_piece_count,
    observed_values,
    prior_stages_have_content,
    rule_holds,
    stage_is_empty,
    unassigned_count,
)
from ari.domain.seed import tutorial_snapshot
from ari.models import WorkspaceSnapshot


def test_content_piece_count_excludes_root():
    s = tutorial_snapshot()
    assert content_piece_count(s) == len(s.pieces) - 1


def test_unassigned_count_on_tutorial():
    s = tutorial_snapshot()
    # 教程快照有 active perspective；待归类数量应可计算且 >= 0
    assert unassigned_count(s) >= 0


def test_stage_is_empty_purpose():
    s = WorkspaceSnapshot(purpose="", root_id="r", pieces=[])
    # 需要合法最小快照；按 seed/empty workspace 惯例构造
    empty = tutorial_snapshot()
    empty.purpose = ""
    assert stage_is_empty(empty, "purpose") is True
    empty.purpose = "有目的"
    assert stage_is_empty(empty, "purpose") is False


def test_prior_stages_perspective_needs_purpose_or_pieces():
    s = tutorial_snapshot()
    assert prior_stages_have_content(s, "perspective") is True
    s.purpose = ""
    # 教程仍有片段
    assert prior_stages_have_content(s, "perspective") is True


def test_rule_holds_unassigned_pieces_threshold():
    s = tutorial_snapshot()
    # 人为制造：若未归类 < 5 则 False
    holds = rule_holds(s, "unassigned_pieces", "pillar")
    assert isinstance(holds, bool)


def test_rule_holds_rejects_wrong_stage_for_structure():
    s = tutorial_snapshot()
    assert rule_holds(s, "unassigned_pieces", "purpose") is False


def test_fingerprint_stable_for_same_relevant_content():
    s = tutorial_snapshot()
    a = content_fingerprint(s, "purpose_empty")
    b = content_fingerprint(s, "purpose_empty")
    assert a == b


def test_observed_values_includes_counts():
    s = tutorial_snapshot()
    vals = observed_values(s, "unassigned_pieces")
    assert "unassigned" in vals
    assert "pieces" in vals
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_nudge.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement domain helpers**

```python
# backend/src/ari/domain/nudge.py
from __future__ import annotations

import hashlib
import json
from typing import Literal

from .grouping import GroupedViewError, build_grouped_view
from ..models import WorkspaceSnapshot

Trigger = Literal["stage_entry", "structure_issue", "idle"]
RuleId = Literal["stage_entry", "unassigned_pieces", "no_pillars", "purpose_empty"]

STRUCTURE_RULES_BY_STAGE: dict[str, set[RuleId]] = {
    "purpose": {"purpose_empty"},
    "piece": {"purpose_empty"},
    "pillar": {"unassigned_pieces", "no_pillars"},
}


def content_piece_count(snapshot: WorkspaceSnapshot) -> int:
    return sum(1 for p in snapshot.pieces if p.id != snapshot.root_id)


def unassigned_count(snapshot: WorkspaceSnapshot) -> int:
    pid = snapshot.active_perspective_id
    if not pid:
        return 0
    try:
        return len(build_grouped_view(snapshot, pid).unassigned)
    except GroupedViewError:
        return 0


def pillar_count(snapshot: WorkspaceSnapshot) -> int:
    pid = snapshot.active_perspective_id
    if not pid:
        return 0
    return sum(1 for p in snapshot.pillars if p.perspective_id == pid)


def stage_is_empty(snapshot: WorkspaceSnapshot, stage: str) -> bool:
    if stage == "purpose":
        return not snapshot.purpose.strip()
    if stage == "piece":
        return content_piece_count(snapshot) == 0
    if stage == "perspective":
        return len(snapshot.perspectives) == 0
    if stage == "pillar":
        return pillar_count(snapshot) == 0
    if stage == "presentation":
        return True  # 表达页无「空」语义；固定引导用，不调 LLM
    return False


def prior_stages_have_content(snapshot: WorkspaceSnapshot, stage: str) -> bool:
    if stage == "purpose":
        return False
    if stage == "piece":
        return bool(snapshot.purpose.strip())
    if stage == "perspective":
        return bool(snapshot.purpose.strip()) or content_piece_count(snapshot) > 0
    if stage == "pillar":
        return len(snapshot.perspectives) > 0
    if stage == "presentation":
        return pillar_count(snapshot) > 0 or content_piece_count(snapshot) > 0
    return False


def rule_holds(snapshot: WorkspaceSnapshot, rule_id: RuleId, stage: str) -> bool:
    if rule_id == "stage_entry":
        return stage_is_empty(snapshot, stage) and prior_stages_have_content(
            snapshot, stage
        )
    allowed = STRUCTURE_RULES_BY_STAGE.get(stage, set())
    if rule_id not in allowed:
        return False
    pieces = content_piece_count(snapshot)
    if rule_id == "unassigned_pieces":
        return unassigned_count(snapshot) >= 5
    if rule_id == "no_pillars":
        return pillar_count(snapshot) == 0 and pieces >= 3
    if rule_id == "purpose_empty":
        return not snapshot.purpose.strip() and pieces >= 5
    return False


def observed_values(snapshot: WorkspaceSnapshot, rule_id: RuleId) -> dict:
    return {
        "pieces": content_piece_count(snapshot),
        "unassigned": unassigned_count(snapshot),
        "pillars": pillar_count(snapshot),
        "purpose_empty": not snapshot.purpose.strip(),
        "perspectives": len(snapshot.perspectives),
        "rule_id": rule_id,
    }


def content_fingerprint(snapshot: WorkspaceSnapshot, rule_id: RuleId) -> str:
    """只哈希与该规则相关的内容，避免无关编辑导致缓存失效。"""
    if rule_id == "purpose_empty":
        payload = {"purpose": snapshot.purpose, "pieces": content_piece_count(snapshot)}
    elif rule_id == "unassigned_pieces":
        pid = snapshot.active_perspective_id
        payload = {
            "perspective": pid,
            "unassigned": unassigned_count(snapshot),
            "assignments": [
                a.model_dump()
                for a in snapshot.assignments
                if a.perspective_id == pid
            ],
        }
    elif rule_id == "no_pillars":
        pid = snapshot.active_perspective_id
        payload = {
            "perspective": pid,
            "pillars": pillar_count(snapshot),
            "pieces": content_piece_count(snapshot),
        }
    else:  # stage_entry
        payload = {
            "purpose": snapshot.purpose,
            "pieces": content_piece_count(snapshot),
            "perspectives": [p.model_dump() for p in snapshot.perspectives],
            "pillars": pillar_count(snapshot),
        }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()
```

若 `WorkspaceSnapshot(purpose="", root_id="r", pieces=[])` 构造失败，测试里一律用 `tutorial_snapshot()` 再改字段，不要硬造非法快照。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_nudge.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/ari/domain/nudge.py backend/tests/test_nudge.py
git commit -m "feat(nudge): 候选信号评估与内容指纹纯函数"
```

---

### Task 2: DB 迁移 + 消息存储支持 trigger

**Files:**
- Modify: `backend/src/ari/db.py`
- Modify: `backend/src/ari/domain/proposals.py`（`create_message`、`store_message_and_proposal`）
- Modify: `backend/src/ari/api/schemas.py`（`MessageSummary.trigger`）
- Modify: `backend/src/ari/api/workspaces.py`（`_message_summary` 映射 `trigger`）
- Test: `backend/tests/test_nudge.py`（追加迁移与存储测试）

**Interfaces:**
- Consumes: Task 1 无直接依赖
- Produces:
  - `create_message(..., trigger: str | None = None)`
  - `store_message_and_proposal(..., trigger: str | None = None)`
  - `MessageSummary.trigger: str | None`

- [ ] **Step 1: Write the failing tests**

```python
# 追加到 backend/tests/test_nudge.py
from ari.db import init_db, connect
from ari.domain.proposals import store_message_and_proposal, get_message_by_request_id


def test_trigger_column_migration(tmp_path):
    # 模拟旧库：无 trigger 列
    path = tmp_path / "old.db"
    c = connect(path)
    c.executescript(
        """
        CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            request_id TEXT NOT NULL,
            question TEXT NOT NULL,
            base_revision INTEGER NOT NULL,
            status TEXT NOT NULL,
            reply TEXT,
            proposal_id TEXT,
            piece_id TEXT,
            created_at TEXT NOT NULL
        );
        """
    )
    c.commit()
    init_db(c)
    cols = {row["name"] for row in c.execute("PRAGMA table_info(messages)")}
    assert "trigger" in cols
    c.close()


def test_store_message_with_trigger(conn, tutorial):
    wid, rev, _ = tutorial
    store_message_and_proposal(
        conn, wid, "perspective", "nudge-1", "", rev, "试试这两个视角",
        [], {"message": "nudge-1"}, trigger="stage_entry",
    )
    row = get_message_by_request_id(conn, "nudge-1")
    assert row["question"] == ""
    assert row["trigger"] == "stage_entry"
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_nudge.py::test_trigger_column_migration tests/test_nudge.py::test_store_message_with_trigger -v`
Expected: FAIL

- [ ] **Step 3: Implement migration and storage**

在 `db.py` 的 `_SCHEMA` 里给 `messages` 加 `trigger TEXT`（新库），并在 `init_db` 里：

```python
cols = {row["name"] for row in conn.execute("PRAGMA table_info(messages)")}
if "trigger" not in cols:
    conn.execute("ALTER TABLE messages ADD COLUMN trigger TEXT")
```

更新 `create_message` INSERT 列列表加入 `trigger`；`store_message_and_proposal` 增加 `trigger: str | None = None` 并向下传递。

`MessageSummary` 增加 `trigger: str | None = None`；`_message_summary` 用 `m.get("trigger")`（Row 用 `m["trigger"] if "trigger" in m.keys() else None`，实际 sqlite3.Row 支持键访问，缺列迁移后恒存在，可为 NULL）。

- [ ] **Step 4: Run all related tests**

Run: `cd backend && uv run pytest tests/test_nudge.py tests/test_messages.py -v`
Expected: PASS（既有消息测试不因新可选参数破坏）

- [ ] **Step 5: Commit**

```bash
git add backend/src/ari/db.py backend/src/ari/domain/proposals.py \
  backend/src/ari/api/schemas.py backend/src/ari/api/workspaces.py \
  backend/tests/test_nudge.py
git commit -m "feat(nudge): messages.trigger 列与存储通路"
```

---

### Task 3: Nudge agent — speak 模型与提示词

**Files:**
- Create: `backend/src/ari/agents/nudge.py`
- Create: `backend/src/ari/prompts/nudge.md`
- Test: `backend/tests/test_nudge.py`（追加渲染与模型测试）

**Interfaces:**
- Consumes: `OUTPUT_MODELS`、`build_context`、`materialize` from `agents.stage`
- Produces:
  - `nudge_output_model(stage) -> type[BaseModel]`（含必填 `speak: bool`，其余继承阶段输出）
  - `render_nudge_prompt(stage, context, trigger, rule_id, observed, recent_actions) -> str`
  - `TRIGGER_LABELS` / `RULE_LABELS` 中文说明字典

- [ ] **Step 1: Write the failing tests**

```python
from ari.agents.nudge import nudge_output_model, render_nudge_prompt
from ari.agents.stage import PurposeOutput


def test_nudge_output_model_has_speak_and_inherits():
    model = nudge_output_model("purpose")
    inst = model(speak=False, reply="", rewritten_purpose="")
    assert inst.speak is False
    assert isinstance(inst, PurposeOutput)


def test_render_nudge_prompt_includes_constraints_and_signal():
    text = render_nudge_prompt(
        "perspective",
        {
            "purpose": "P",
            "pieces_json": "[]",
            "perspectives_json": "[]",
            "active_perspective": "",
            "pillars_json": "[]",
            "assignments_json": "[]",
            "history": "",
        },
        trigger="stage_entry",
        rule_id="stage_entry",
        observed={"pieces": 3},
        recent_actions=["新增片段×3"],
    )
    assert "speak" in text
    assert "一次最多提出一个主要问题" in text
    assert "stage_entry" in text or "进入" in text
    assert "新增片段×3" in text
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_nudge.py::test_nudge_output_model_has_speak_and_inherits tests/test_nudge.py::test_render_nudge_prompt_includes_constraints_and_signal -v`

- [ ] **Step 3: Implement agent + prompt**

```python
# backend/src/ari/agents/nudge.py
from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field, create_model

from .stage import OUTPUT_MODELS, Stage, build_context

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "nudge.md"

TRIGGER_LABELS = {
    "stage_entry": "用户刚进入当前阶段，且该阶段尚无内容，但前面阶段已有材料",
    "structure_issue": "结构候选信号命中（不是断言用户做错了，只是值得看一眼）",
    "idle": "用户在本页停顿了一段时间",
}

RULE_LABELS = {
    "stage_entry": "进入空阶段（有前序内容）",
    "unassigned_pieces": "待归类片段偏多（≥5）",
    "no_pillars": "已有片段但尚无支柱",
    "purpose_empty": "片段较多但目的仍空",
}


def nudge_output_model(stage: Stage) -> type[BaseModel]:
    base = OUTPUT_MODELS[stage]
    return create_model(
        f"Nudge{base.__name__}",
        __base__=base,
        speak=(bool, Field(..., description="是否值得打扰用户；无明确增益则为 false")),
    )


def render_nudge_prompt(
    stage: Stage,
    context: dict[str, str],
    *,
    trigger: str,
    rule_id: str,
    observed: dict,
    recent_actions: list[str],
) -> str:
    template = PROMPT_PATH.read_text(encoding="utf-8")
    replacements = {
        **context,
        "trigger": trigger,
        "trigger_label": TRIGGER_LABELS.get(trigger, trigger),
        "rule_id": rule_id,
        "rule_label": RULE_LABELS.get(rule_id, rule_id),
        "observed_values": json.dumps(observed, ensure_ascii=False),
        "recent_actions": "\n".join(f"- {a}" for a in recent_actions) or "（无）",
        "stage": stage,
    }
    for key, value in replacements.items():
        template = template.replace("{" + key + "}", str(value))
    return template
```

`prompts/nudge.md` 必须包含：

```markdown
你是阿理（Ari）的主动引导助手。你不是检查器——候选信号只说明「值得看一眼」，不代表用户需要帮助。

触发：{trigger}（{trigger_label}）
规则：{rule_id}（{rule_label}）
观测值：{observed_values}
最近编辑动作：
{recent_actions}

当前阶段：{stage}
目的：{purpose}
片段：{pieces_json}
视角：{perspectives_json}
激活视角：{active_perspective}
支柱：{pillars_json}
归属：{assignments_json}
此前对话：
{history}

质量约束（必须遵守）：
1. 一次最多提出一个主要问题。
2. 必须引用具体内容或最近操作，说明建议依据。
3. 不推断用户情绪、能力或心理状态。
4. 优先帮助用户澄清判断；结构修改提案是次要的。
5. 素材不足时先询问，不编造看似真实的经历或证据。
6. 没有明确增益时输出 speak=false，并让其余字段为空/默认。

只输出 JSON（字段随阶段 schema；必含 speak: bool）。
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_nudge.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/ari/agents/nudge.py backend/src/ari/prompts/nudge.md backend/tests/test_nudge.py
git commit -m "feat(nudge): speak 输出模型与主动引导提示词"
```

---

### Task 4: 运行时状态 + POST /nudges 端点

**Files:**
- Create: `backend/src/ari/domain/nudge_runtime.py`
- Modify: `backend/src/ari/api/schemas.py`（`NudgeRequest`）
- Modify: `backend/src/ari/api/workspaces.py`（端点）
- Test: `backend/tests/test_nudge.py`

**Interfaces:**
- Consumes: Task 1–3；`create_runner`、`materialize`、`validate_operations`、`store_message_and_proposal`、`get_message_by_request_id`
- Produces:
  - `nudge_runtime.try_begin(workspace_id) -> bool` / `end(workspace_id)`
  - `nudge_runtime.silence_hit(workspace_id, rule_id, stage, fingerprint) -> bool`
  - `nudge_runtime.record_silence(...)` / `clear()`（测试用）
  - `POST /{id}/nudges` → `MessageResponse` 或 204

- [ ] **Step 1: Write the failing endpoint tests**

用假 runner 注入。模式：在测试里 `monkeypatch` `ari.api.workspaces.create_runner`，返回实现 `async def run(prompt, model)` 的对象。

```python
import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import Response

from ari.api.schemas import NudgeRequest
from ari.api.workspaces import send_nudge
from ari.domain import nudge_runtime
from ari.agents.nudge import nudge_output_model


@pytest.fixture(autouse=True)
def _clear_runtime():
    nudge_runtime.clear()
    yield
    nudge_runtime.clear()


class FakeRunner:
    def __init__(self, output):
        self.output = output
        self.calls = 0

    async def run(self, prompt, output_model):
        self.calls += 1
        if isinstance(self.output, Exception):
            raise self.output
        return self.output


def test_nudge_speak_false_returns_204(conn, tutorial, monkeypatch):
    wid, rev, _ = tutorial
    model = nudge_output_model("perspective")
    runner = FakeRunner(model(speak=False, reply="", perspectives=[]))
    monkeypatch.setattr("ari.api.workspaces.create_runner", lambda *a, **k: runner)
    # 确保 stage_entry 条件成立：清空 perspectives，保留 purpose/pieces
    # 若 tutorial 已有视角，先用 patch 改快照或选 purpose_empty 等必成立规则
    ...


def test_nudge_speak_true_persists_message_and_proposal(...):
    ...


def test_nudge_idempotent_same_request_id(...):
    # 第二次不增加 runner.calls
    ...


def test_nudge_concurrent_second_returns_204(...):
    # try_begin 占用后直接 204
    ...


def test_nudge_rule_recheck_fails_returns_204(...):
    # rule_id=unassigned_pieces 但快照不满足
    ...


def test_nudge_silence_cache_skips_llm(...):
    # 第一次 speak=false；第二次同指纹不再调用
    ...


def test_nudge_llm_unconfigured_returns_204(conn, tutorial, monkeypatch):
    monkeypatch.setattr("ari.api.workspaces.create_runner", lambda *a, **k: None)
    ...
```

实现测试时：对 `stage_entry`，若教程快照视角非空，改为构造 `rule_id="purpose_empty"` 并临时把 `purpose` 清空、保证片段 ≥ 5；或在测试内 `apply_patch` 造出满足条件的快照。**不要**依赖模糊的「…」——每个测试必须有可运行的完整 setup。推荐路径：

1. `empty` fixture 建空白工作区；
2. 用 `apply_patch` 加入 ≥5 条片段且不设 purpose → 测 `purpose_empty`；
3. 用 FakeRunner 返回 `speak=True/False` 的 purpose 模型实例。

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_nudge.py -k "nudge_" -v`
Expected: FAIL（端点/runtime 不存在）

- [ ] **Step 3: Implement runtime**

```python
# backend/src/ari/domain/nudge_runtime.py
from __future__ import annotations

_in_flight: set[str] = set()
# key: (workspace_id, rule_id, stage, fingerprint)
_silence: set[tuple[str, str, str, str]] = set()


def clear() -> None:
    _in_flight.clear()
    _silence.clear()


def try_begin(workspace_id: str) -> bool:
    if workspace_id in _in_flight:
        return False
    _in_flight.add(workspace_id)
    return True


def end(workspace_id: str) -> None:
    _in_flight.discard(workspace_id)


def silence_hit(workspace_id: str, rule_id: str, stage: str, fingerprint: str) -> bool:
    return (workspace_id, rule_id, stage, fingerprint) in _silence


def record_silence(workspace_id: str, rule_id: str, stage: str, fingerprint: str) -> None:
    _silence.add((workspace_id, rule_id, stage, fingerprint))
```

- [ ] **Step 4: Implement endpoint**

`schemas.py`：

```python
class NudgeRequest(BaseModel):
    request_id: str
    stage: Stage
    trigger: Literal["stage_entry", "structure_issue", "idle"]
    rule_id: Literal["stage_entry", "unassigned_pieces", "no_pillars", "purpose_empty"]
    base_revision: int
    recent_actions: list[str] = Field(default_factory=list)
```

`workspaces.py` 新增（摘要逻辑，实现时写全）：

```python
@router.post("/{workspace_id}/nudges", response_model=MessageResponse)
async def send_nudge(workspace_id: str, body: NudgeRequest, conn=Depends(get_conn)):
    existing = get_message_by_request_id(conn, body.request_id)
    if existing is not None:
        if existing["workspace_id"] != workspace_id:
            raise HTTPException(409, detail="request_id 属于另一个工作区")
        return MessageResponse(...)  # 同 send_message 回放

    if body.trigger == "idle":
        return Response(status_code=204)  # 第一版不接 LLM

    if not nudge_runtime.try_begin(workspace_id):
        return Response(status_code=204)
    try:
        ws = get_workspace(conn, workspace_id)
        if ws is None:
            raise HTTPException(404, detail="工作区不存在")
        if body.base_revision != ws["revision"]:
            return Response(status_code=204)  # 过时请求：沉默，不 409 打扰

        snapshot = ws["snapshot"]
        if not rule_holds(snapshot, body.rule_id, body.stage):
            return Response(status_code=204)

        fp = content_fingerprint(snapshot, body.rule_id)
        if nudge_runtime.silence_hit(workspace_id, body.rule_id, body.stage, fp):
            return Response(status_code=204)

        runner = create_runner(settings.llm, body.stage)
        if runner is None:
            return Response(status_code=204)

        history = list_recent_messages(conn, workspace_id, limit=6)
        ctx = build_context(snapshot, body.stage, history)
        prompt = render_nudge_prompt(
            body.stage, ctx,
            trigger=body.trigger, rule_id=body.rule_id,
            observed=observed_values(snapshot, body.rule_id),
            recent_actions=body.recent_actions[:8],
        )
        try:
            output = await runner.run(prompt, nudge_output_model(body.stage))
        except Exception:
            return Response(status_code=204)  # 主动失败静默

        if not getattr(output, "speak", False):
            nudge_runtime.record_silence(workspace_id, body.rule_id, body.stage, fp)
            return Response(status_code=204)

        reply, ops = materialize(body.stage, output, snapshot)
        validate_operations(body.stage, ops, snapshot)
        refs = {"message": body.request_id, "piece_ids": _collect_piece_refs(ops)}
        proposal_id = store_message_and_proposal(
            conn, workspace_id, body.stage, body.request_id, "",
            body.base_revision, reply, ops, refs, trigger=body.trigger,
        )
        return MessageResponse(
            reply=reply, proposal_id=proposal_id, revision=ws["revision"],
            proposal=_message_proposal(conn, proposal_id),
        )
    finally:
        nudge_runtime.end(workspace_id)
```

注意：FastAPI 对「有时 204 有时 MessageResponse」需要 `response_model=None` 或返回 `Response | MessageResponse` 并正确设置 `responses={204: ...}`。用：

```python
@router.post(
    "/{workspace_id}/nudges",
    response_model=MessageResponse,
    responses={204: {"description": "沉默或不触发"}},
)
```

并 `from fastapi import Response`。若 204 与 response_model 冲突，改为 `response_model=None` 并手动 `JSONResponse` 序列化成功体——以能通过测试为准。

- [ ] **Step 5: Run full nudge + message tests**

Run: `cd backend && uv run pytest tests/test_nudge.py tests/test_messages.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/ari/domain/nudge_runtime.py backend/src/ari/api/schemas.py \
  backend/src/ari/api/workspaces.py backend/tests/test_nudge.py
git commit -m "feat(nudge): POST /nudges 端点与并发/沉默/复核"
```

---

### Task 5: 前端 API 与类型

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/lib/types.ts`（若 Stage 等已在此，trigger 类型可放 client）

**Interfaces:**
- Produces:
  - `MessageSummary.trigger?: string | null`
  - `api.sendNudge(...) -> Promise<MessageResult | null>`（204 → null）

- [ ] **Step 1: Extend `request` 或新增专用函数处理 204**

在 `client.ts` 中：

```typescript
export type NudgeTrigger = "stage_entry" | "structure_issue" | "idle";
export type NudgeRuleId =
  | "stage_entry"
  | "unassigned_pieces"
  | "no_pillars"
  | "purpose_empty";

// MessageSummary 增加：
trigger?: string | null;

// api 增加：
async sendNudge(
  id: string,
  requestId: string,
  stage: Stage,
  trigger: NudgeTrigger,
  ruleId: NudgeRuleId,
  baseRevision: number,
  recentActions: string[],
): Promise<MessageResult | null> {
  const res = await fetch(`${BASE}/${id}/nudges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: requestId,
      stage,
      trigger,
      rule_id: ruleId,
      base_revision: baseRevision,
      recent_actions: recentActions,
    }),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as MessageResult;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run build`
Expected: 成功（或仅既有无关错误；本改动不应引入新错误）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(nudge): 前端 sendNudge API（204→null）"
```

---

### Task 6: 前端信号、最近操作、触发 hook

**Files:**
- Create: `frontend/src/lib/nudgeSignals.ts`
- Create: `frontend/src/lib/recentActions.ts`
- Create: `frontend/src/lib/useProactiveTrigger.ts`
- Modify: `frontend/src/store/workspace.tsx` 或 `App.tsx`（在 patch 成功处 `pushRecentAction`——优先在 workspace 的 apply 路径打点，避免各页面重复）

**Interfaces:**
- Produces:
  - `detectSignals(snapshot, stage): { trigger, ruleId } | null`（按优先级 structure > entry；同轮一个）
  - `stageNeedsFixedEntryGuide(snapshot, stage): boolean`（空且无前序）
  - `pushRecentAction(label: string)` / `getRecentActions(): string[]`
  - `useProactiveTrigger({ workspaceId, stage })`：内部冷却、调用 `chat.sendNudge`

冷却状态放 hook 的 `useRef`：`lastByRule: Map<string, number>`、`lastSpokeAt: number`。

- [ ] **Step 1: Implement `nudgeSignals.ts`（与后端语义对齐）**

```typescript
import type { Snapshot, Stage } from "./types";

export type NudgeTrigger = "stage_entry" | "structure_issue";
export type NudgeRuleId =
  | "stage_entry"
  | "unassigned_pieces"
  | "no_pillars"
  | "purpose_empty";

export function contentPieceCount(s: Snapshot): number {
  return s.pieces.filter((p) => p.id !== s.root_id).length;
}

export function unassignedCount(s: Snapshot): number {
  const pid = s.active_perspective_id;
  if (!pid) return 0;
  const content = s.pieces.filter((p) => p.id !== s.root_id);
  let n = 0;
  for (const p of content) {
    const a = s.assignments.find(
      (x) => x.perspective_id === pid && x.piece_id === p.id,
    );
    if (!a || a.pillar_id == null) n += 1;
  }
  return n;
}

export function pillarCount(s: Snapshot): number {
  const pid = s.active_perspective_id;
  if (!pid) return 0;
  return s.pillars.filter((p) => p.perspective_id === pid).length;
}

export function stageIsEmpty(s: Snapshot, stage: Stage): boolean {
  if (stage === "purpose") return !s.purpose.trim();
  if (stage === "piece") return contentPieceCount(s) === 0;
  if (stage === "perspective") return s.perspectives.length === 0;
  if (stage === "pillar") return pillarCount(s) === 0;
  return true;
}

export function priorStagesHaveContent(s: Snapshot, stage: Stage): boolean {
  if (stage === "purpose") return false;
  if (stage === "piece") return !!s.purpose.trim();
  if (stage === "perspective")
    return !!s.purpose.trim() || contentPieceCount(s) > 0;
  if (stage === "pillar") return s.perspectives.length > 0;
  return pillarCount(s) > 0 || contentPieceCount(s) > 0;
}

export function stageNeedsFixedEntryGuide(s: Snapshot, stage: Stage): boolean {
  return stageIsEmpty(s, stage) && !priorStagesHaveContent(s, stage);
}

/** 同轮只返回一个：structure_issue > stage_entry */
export function detectSignals(
  s: Snapshot,
  stage: Stage,
): { trigger: NudgeTrigger; ruleId: NudgeRuleId } | null {
  const pieces = contentPieceCount(s);
  if (stage === "pillar") {
    if (unassignedCount(s) >= 5)
      return { trigger: "structure_issue", ruleId: "unassigned_pieces" };
    if (pillarCount(s) === 0 && pieces >= 3)
      return { trigger: "structure_issue", ruleId: "no_pillars" };
  }
  if ((stage === "purpose" || stage === "piece") && !s.purpose.trim() && pieces >= 5) {
    return { trigger: "structure_issue", ruleId: "purpose_empty" };
  }
  if (stageIsEmpty(s, stage) && priorStagesHaveContent(s, stage) && stage !== "presentation") {
    return { trigger: "stage_entry", ruleId: "stage_entry" };
  }
  return null;
}
```

- [ ] **Step 2: Implement `recentActions.ts`**

模块级环形缓冲，上限 8：

```typescript
const buf: string[] = [];
const MAX = 8;

export function pushRecentAction(label: string): void {
  const t = label.trim();
  if (!t) return;
  buf.push(t);
  if (buf.length > MAX) buf.shift();
}

export function getRecentActions(): string[] {
  return [...buf];
}

export function clearRecentActions(): void {
  buf.length = 0;
}
```

在 `workspace.tsx` 成功 `applyServerSnapshot` / patch 成功路径根据 operations 类型推一条中文摘要（可复用/简化 `describe.ts` 的单行描述；若打点成本高，第一版只在 `patch` 成功时推 `"编辑了工作区内容"`，在 chat `resolve accept` 时推 `"采纳了提案"`——宁可粗糙也不要漏）。

- [ ] **Step 3: Implement `useProactiveTrigger.ts`**

关键行为：

- 依赖 `[workspaceId, stage, revision, snapshot]`；
- `sending` 或同阶段 pending 提案 → return；
- `detectSignals`；无信号 return；
- 检查 `(ruleId, stage)` 5 分钟冷却与全局发言 3 分钟冷却；
- 调用 `chat.sendNudge`；若返回非 null，更新 `lastSpokeAt`；
- `stage_entry` 仅在 stage 变化时评估一次（用 ref 记 `lastEntryStage`）；`structure_issue` 在 revision 变化时评估；
- 错误 catch 后 `console.warn`，不 setError。

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/nudgeSignals.ts frontend/src/lib/recentActions.ts \
  frontend/src/lib/useProactiveTrigger.ts frontend/src/store/workspace.tsx
git commit -m "feat(nudge): 前端信号检测、最近操作与触发 hook"
```

---

### Task 7: Chat store、面板渲染、固定引导与 idle 轻入口

**Files:**
- Modify: `frontend/src/store/chat.tsx`
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`（少量样式：主动标识、轻入口、固定引导条）

**Interfaces:**
- Consumes: `api.sendNudge`、`useProactiveTrigger`、`stageNeedsFixedEntryGuide`
- Produces:
  - `ChatMessage.trigger: string | null`
  - `sendNudge(trigger, ruleId): Promise<void>`（内部处理 revision 丢弃）
  - `idleHintVisible` + dismiss/open

- [ ] **Step 1: Extend chat store**

`ChatMessage` 增加 `trigger: string | null`；`toChatMessage` 映射 `m.trigger ?? null`。

新增：

```typescript
sendNudge: (trigger: NudgeTrigger, ruleId: NudgeRuleId) => Promise<boolean>;
// 返回 true 表示实际展示了一条主动消息（供 hook 记 lastSpokeAt）
```

实现要点：

- 记录 `const revAtSend = revisionRef.current`；
- `setSending(true)`（与用户发送共享，抑制并发）；
- 调用 `api.sendNudge`；
- 若 `null`（204）→ return false；
- 若 `revisionRef.current !== revAtSend` → **丢弃不 insert**，return false（消息可能已落库，下次刷新可见）；
- 否则 append 一条 `question: ""`、`trigger`、带 reply/proposal 的消息；return true；
- catch → `console.warn`，return false；
- finally `setSending(false)`。

暴露 `hasPendingProposalForStage(stage): boolean` 或让 hook 直接扫 `messages`。

- [ ] **Step 2: ChatPanel 渲染**

- `m.question` 为空或 `m.trigger` 非空：不渲染用户气泡；阿理气泡上方加 `<span className="nudge-badge">主动建议</span>`。
- 空状态文案保持；若有消息则照常。
- 底部增加 idle 轻入口（由 props 或 chat context 的 `idleHint` 控制）：

```tsx
{idleHintVisible ? (
  <button type="button" className="idle-hint" onClick={onIdleHintClick}>
    需要一起梳理下一步吗？
  </button>
) : null}
```

点击后：关闭 hint，打开面板，`setDraft("")` 并可选直接 `send("我想梳理一下下一步，你看现在卡在哪？")`——或只 focus 输入框。第一版：**点击后 focus 输入框并预填**「我想梳理一下下一步」，由用户按发送（避免未经确认就调 LLM）。

- [ ] **Step 3: App 挂载**

在 `WorkspaceShell` 内（ChatProvider 下）调用 `useProactiveTrigger()`。

固定引导：当 `stageNeedsFixedEntryGuide(snapshot, stage)` 时，在 `<h1>` 下或 ChatPanel 顶显示静态文案（不入库），例如按阶段：

- purpose：「先用一句话写下这次思考要解决什么。」
- piece：「从材料里摘几条原话放进来。」
- perspective：「还没有目的和材料时，先回到前面两步。」
- pillar：「先选定一个视角，再来建支柱。」
- presentation：「前面结构就绪后再来表达。」

idle：在 `useProactiveTrigger` 或独立小 hook 里，`visibilityState === "visible"` 且 `document.hasFocus()` 时累计 90s 无 snapshot/draft 变化 → set idleHintVisible。隐藏/失焦时暂停计时。

- [ ] **Step 4: Build + 手工清单**

Run: `cd frontend && npm run build`

手工（有 LLM 时）：

1. 空白工作区进 purpose → 见固定引导，无模型调用。
2. 填目的后进 perspective（无视角）→ 应发起 nudge；阿理可能开口或沉默。
3. 开口后 3 分钟内换页不应再发言。
4. 采纳/忽略提案后结构信号可再评估。
5. 切走标签页 90s → 不应出 idle hint；回来聚焦后再计时。
6. nudge 生成中手动提问 → 用户消息优先，过时 nudge 不插入。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/chat.tsx frontend/src/components/ChatPanel.tsx \
  frontend/src/App.tsx frontend/src/index.css frontend/src/lib/useProactiveTrigger.ts
git commit -m "feat(nudge): 对话渲染、固定引导与 idle 轻入口"
```

---

### Task 8: 契约文档

**Files:**
- Modify: `docs/contract.md`

- [ ] **Step 1: 登记 API**

在契约表增加：

```markdown
| POST `/{id}/nudges` | `{request_id, stage, trigger, rule_id, base_revision, recent_actions[]}` | `{reply, proposal_id, revision, proposal?}` 或 `204` |
```

并注明：

- `trigger` ∈ `stage_entry` | `structure_issue` | `idle`；第一版 `idle` 恒 204。
- `rule_id` ∈ `stage_entry` | `unassigned_pieces` | `no_pillars` | `purpose_empty`。
- 后端复核条件；不成立 / 沉默 / 未配置 LLM / 并发冲突 → 204。
- 主动消息 `question` 为空串，`trigger` 非空；历史列表原样返回。
- 幂等：同一 `request_id` 回放首次结果。

- [ ] **Step 2: Commit**

```bash
git add docs/contract.md
git commit -m "docs: 登记 nudge API 契约"
```

---

## Self-Review

1. **Spec coverage**
   - 候选信号 / 同轮单触发 / 双冷却 → Task 1 + 6
   - 后端复核、去重、并发、沉默缓存 → Task 4
   - speak + 提示词约束 → Task 3
   - question 空串 + trigger 列（不重建表）→ Task 2
   - revision 过时丢弃 → Task 7
   - stage_entry 固定文案 vs 个性化 → Task 6–7
   - idle 轻入口、可见性计时 → Task 7
   - pending 仅同阶段 → Task 6–7
   - recent_actions → Task 6
   - 测试场景（幂等/并发/复核/沉默/迁移）→ Task 1/2/4
   - 契约 → Task 8

2. **Placeholder scan:** Task 4 测试里的 `...` 已在同步说明用 `empty` + `apply_patch` 造条件；实现时不得留省略号。

3. **Type consistency:** `rule_id` / `trigger` 前后端字面量一致；`sendNudge` 返回 `MessageResult | null`；主动消息 `question === ""` 且 `trigger` 非空。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-22-proactive-nudge.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 Task 派一个新子 agent，Task 间做审查，迭代快

**2. Inline Execution** — 本会话按 executing-plans 批量推进，设检查点

Which approach?
