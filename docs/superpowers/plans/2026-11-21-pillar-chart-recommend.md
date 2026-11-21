# 支柱页 AI 推荐图形 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 进入支柱页时由 AI 从五种结构图形中推荐一种并单卡展开，其余收入「换一种」；已有结构冲突时提示改用或继续。

**Architecture:** 新增只读 `POST …/recommend-chart`（独立于阶段聊天）：领域层拼装上下文与 `existing_charts`，LLM 返回 `{chart, reason}`。前端用 `activeChart` 优先级链驱动单卡编辑器，偏好存 `chartPrefs` localStorage。

**Tech Stack:** FastAPI + Pydantic + 现有 `OpenAICompatibleRunner`；React 18 + TypeScript；pytest；无前端单测框架（前端以 `npm run build` + 手工清单验证）。

**Spec:** `docs/superpowers/specs/2026-11-21-pillar-chart-recommend-design.md`

## Global Constraints

- 候选仅五值：`flow` | `venn` | `matrix` | `pyramid` | `logic_tree`（不推 `classification` / `cycle`）。
- 不生成结构草稿；不把推荐写入快照。
- 换图形不删除旧 visualization。
- LLM 未配置 → 503；调用失败 → 502；revision 不符 → 409；视角不存在 → 422（同 visualization）。
- 结构类型 `sets` 在 API/`existing_charts` 中映射为推荐值 `venn`。

## File Structure

| 文件 | 职责 |
|------|------|
| `backend/src/ari/domain/recommend_chart.py` | `RecommendChart`、`existing_charts()`、上下文装配（纯函数，可单测） |
| `backend/src/ari/prompts/recommend_chart.md` | 推荐提示词 |
| `backend/src/ari/agents/recommend_chart.py` | 输出模型、`render_recommend_prompt`、调用入口辅助 |
| `backend/src/ari/api/schemas.py` | 请求/响应模型 |
| `backend/src/ari/api/workspaces.py` | `POST /{id}/recommend-chart` |
| `docs/contract.md` | 登记新 API |
| `backend/tests/test_recommend_chart.py` | 领域 + 端点测试 |
| `frontend/src/lib/types.ts` | `RecommendChart`、响应类型 |
| `frontend/src/api/client.ts` | `recommendChart` |
| `frontend/src/lib/chartPrefs.ts` | `manualChart`、`dismissedConflictAtRevision` |
| `frontend/src/lib/resolveActiveChart.ts` | 优先级解析纯函数 |
| `frontend/src/components/PillarChartPanel.tsx` | 单卡 UI：推荐头、banner、换一种、挂载编辑器 |
| `frontend/src/routes/PillarPage.tsx` | 去掉五段并列；接入 panel + 请求 |

---

### Task 1: 领域层 — existing_charts 与上下文

**Files:**
- Create: `backend/src/ari/domain/recommend_chart.py`
- Test: `backend/tests/test_recommend_chart.py`
- Spec: `docs/superpowers/specs/2026-11-21-pillar-chart-recommend-design.md`

**Interfaces:**
- Produces:
  - `RecommendChart = Literal["flow","venn","matrix","pyramid","logic_tree"]`
  - `RECOMMEND_CHARTS: tuple[RecommendChart, ...]`
  - `def existing_charts(snapshot: WorkspaceSnapshot, perspective_id: str) -> list[RecommendChart]`
  - `def build_recommend_context(snapshot: WorkspaceSnapshot, perspective_id: str) -> dict[str, str]`
  - `class RecommendChartError(ValueError)` with `.recovery: str`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_recommend_chart.py
from ari.domain.recommend_chart import (
    RecommendChartError,
    build_recommend_context,
    existing_charts,
)
from ari.domain.seed import tutorial_snapshot
from ari.models import Flow, FlowStep, SetsStructure, VennSet


def test_existing_charts_empty_on_tutorial():
    s = tutorial_snapshot()
    assert existing_charts(s, "v-adoption") == []


def test_existing_charts_maps_sets_to_venn_and_keeps_flow():
    s = tutorial_snapshot()
    s.visualizations.append(
        Flow(
            type="flow",
            perspective_id="v-adoption",
            steps=[
                FlowStep(id="s1", text="a", pillar_id=None),
                FlowStep(id="s2", text="b", pillar_id=None),
            ],
            branches=[],
            feedback=[],
        )
    )
    s.visualizations.append(
        SetsStructure(
            type="sets",
            perspective_id="v-adoption",
            set_a=VennSet(id="a", name="A"),
            set_b=VennSet(id="b", name="B"),
            members=[],
        )
    )
    assert existing_charts(s, "v-adoption") == ["flow", "venn"]


def test_build_recommend_context_includes_purpose_and_perspective():
    s = tutorial_snapshot()
    ctx = build_recommend_context(s, "v-adoption")
    assert "下一次分享" in ctx["purpose"] or ctx["purpose"]
    assert "采用" in ctx["perspective_name"] or ctx["perspective_name"]
    assert "pieces_json" in ctx and "pillars_json" in ctx
    assert ctx["existing_charts_json"] == "[]"


def test_build_recommend_context_missing_perspective():
    s = tutorial_snapshot()
    try:
        build_recommend_context(s, "nope")
        assert False, "expected error"
    except RecommendChartError as exc:
        assert exc.recovery
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_recommend_chart.py -v`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement domain module**

```python
# backend/src/ari/domain/recommend_chart.py
from __future__ import annotations

import json
from typing import Literal

from ..models import WorkspaceSnapshot

RecommendChart = Literal["flow", "venn", "matrix", "pyramid", "logic_tree"]

RECOMMEND_CHARTS: tuple[RecommendChart, ...] = (
    "flow",
    "venn",
    "matrix",
    "pyramid",
    "logic_tree",
)

_TYPE_TO_CHART: dict[str, RecommendChart] = {
    "flow": "flow",
    "sets": "venn",
    "matrix": "matrix",
    "pyramid": "pyramid",
    "logic_tree": "logic_tree",
}


class RecommendChartError(ValueError):
    def __init__(self, message: str, recovery: str) -> None:
        super().__init__(message)
        self.recovery = recovery


def existing_charts(
    snapshot: WorkspaceSnapshot, perspective_id: str
) -> list[RecommendChart]:
    seen: list[RecommendChart] = []
    for v in snapshot.visualizations:
        if v.perspective_id != perspective_id:
            continue
        chart = _TYPE_TO_CHART.get(v.type)
        if chart and chart not in seen:
            seen.append(chart)
    return seen


def build_recommend_context(
    snapshot: WorkspaceSnapshot, perspective_id: str
) -> dict[str, str]:
    perspective = snapshot.perspective(perspective_id)
    if perspective is None:
        raise RecommendChartError(
            f"视角不存在: {perspective_id}",
            recovery="请选择一个有效视角后再试",
        )
    pieces = [
        {"id": p.id, "text": p.text, "kind": p.kind}
        for p in snapshot.pieces
        if p.parent_id is not None  # 跳过主题根，减噪；若全树需要可改为全部
    ]
    pillars = [
        p.model_dump()
        for p in snapshot.pillars
        if p.perspective_id == perspective_id
    ]
    existing = existing_charts(snapshot, perspective_id)
    return {
        "purpose": snapshot.purpose,
        "perspective_name": perspective.name,
        "perspective_reason": perspective.reason,
        "pieces_json": json.dumps(pieces, ensure_ascii=False),
        "pillars_json": json.dumps(pillars, ensure_ascii=False),
        "existing_charts_json": json.dumps(existing, ensure_ascii=False),
        "candidates": "、".join(RECOMMEND_CHARTS),
    }
```

（若教程 pieces 过滤导致测试断言过严：断言改为 `json.loads(ctx["pieces_json"])` 为 list 即可。）

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_recommend_chart.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/ari/domain/recommend_chart.py backend/tests/test_recommend_chart.py
git commit -m "$(cat <<'EOF'
feat: add recommend-chart domain helpers

Map persisted visualizations to recommendable chart types and assemble LLM context.
EOF
)"
```

---

### Task 2: Prompt、输出模型与渲染

**Files:**
- Create: `backend/src/ari/prompts/recommend_chart.md`
- Create: `backend/src/ari/agents/recommend_chart.py`
- Modify: `backend/tests/test_recommend_chart.py`

**Interfaces:**
- Consumes: `build_recommend_context`, `RecommendChart`, `RECOMMEND_CHARTS`
- Produces:
  - `class RecommendChartOutput(BaseModel): chart: RecommendChart; reason: str`
  - `def render_recommend_prompt(context: dict[str, str]) -> str`

- [ ] **Step 1: Write failing test for prompt render**

```python
from ari.agents.recommend_chart import RecommendChartOutput, render_recommend_prompt
from ari.domain.recommend_chart import build_recommend_context
from ari.domain.seed import tutorial_snapshot


def test_render_recommend_prompt_contains_candidates_and_purpose():
    ctx = build_recommend_context(tutorial_snapshot(), "v-adoption")
    text = render_recommend_prompt(ctx)
    assert "flow" in text and "venn" in text
    assert ctx["purpose"] in text or "目的" in text
    assert "JSON" in text or "chart" in text


def test_recommend_chart_output_schema_accepts_flow():
    out = RecommendChartOutput(chart="flow", reason="阶段推进")
    assert out.chart == "flow"
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_recommend_chart.py::test_render_recommend_prompt_contains_candidates_and_purpose -v`  
Expected: FAIL（agents 模块不存在）

- [ ] **Step 3: Add prompt + agent module**

`backend/src/ari/prompts/recommend_chart.md`:

```markdown
你是阿理（Ari）的图形顾问。根据当前思考材料，从候选结构图形中选出最合适的一种。

目的：
{purpose}

当前视角：{perspective_name}
视角理由：{perspective_reason}

片段（id / text / kind）：
{pieces_json}

已有支柱：
{pillars_json}

该视角已保存的结构类型：
{existing_charts_json}

候选（必须恰好选一个）：{candidates}

选择指引：
- flow：材料呈现阶段、步骤、先后或循环
- venn：比较两组重叠/差异
- matrix：两个维度交叉定位
- pyramid：层次、由下至上的支撑关系
- logic_tree：问题分解、因果/逻辑分支

只输出 JSON：{{ "chart": "<候选之一>", "reason": "<一句中文理由>" }}
```

（注意：模板里字面 `{{` / `}}` 若用简单 `str.replace`，写成单花括号占位符即可，reason 说明里不要用未转义的 `{chart}`。）

`backend/src/ari/agents/recommend_chart.py`:

```python
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field

from ..domain.recommend_chart import RecommendChart

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "recommend_chart.md"


class RecommendChartOutput(BaseModel):
    chart: RecommendChart
    reason: str = Field(min_length=1)


def render_recommend_prompt(context: dict[str, str]) -> str:
    template = PROMPT_PATH.read_text(encoding="utf-8")
    for key, value in context.items():
        template = template.replace("{" + key + "}", str(value))
    return template
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd backend && uv run pytest tests/test_recommend_chart.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/src/ari/prompts/recommend_chart.md backend/src/ari/agents/recommend_chart.py backend/tests/test_recommend_chart.py
git commit -m "$(cat <<'EOF'
feat: add recommend-chart prompt and output model
EOF
)"
```

---

### Task 3: API 端点 + contract

**Files:**
- Modify: `backend/src/ari/api/schemas.py`
- Modify: `backend/src/ari/api/workspaces.py`
- Modify: `docs/contract.md`（API 表增加一行）
- Modify: `backend/tests/test_recommend_chart.py`

**Interfaces:**
- Consumes: `build_recommend_context`, `existing_charts`, `render_recommend_prompt`, `RecommendChartOutput`, `create_runner`
- Produces: `POST /{workspace_id}/recommend-chart` → `RecommendChartResponse`

- [ ] **Step 1: Add schemas**

```python
# schemas.py 追加
class RecommendChartRequest(BaseModel):
    base_revision: int
    perspective_id: str


class RecommendChartResponse(BaseModel):
    revision: int
    chart: Literal["flow", "venn", "matrix", "pyramid", "logic_tree"]
    reason: str
    existing_charts: list[Literal["flow", "venn", "matrix", "pyramid", "logic_tree"]]
```

（或从 domain 再导出类型；保持与 `RecommendChart` 一致。）

- [ ] **Step 2: Write endpoint tests with fake runner**

项目未装 `pytest-asyncio`：用 `asyncio.run(...)` 包一层，勿新增依赖。

```python
import asyncio
import pytest
from fastapi import HTTPException
from ari.api.schemas import RecommendChartRequest
from ari.api.workspaces import recommend_chart
from ari.agents.recommend_chart import RecommendChartOutput


class _FakeRunner:
    async def run(self, prompt, output_model, **kwargs):
        return RecommendChartOutput(chart="matrix", reason="两维交叉")


def test_recommend_chart_endpoint_ok(tutorial, conn, monkeypatch):
    wid, rev, _ = tutorial
    monkeypatch.setattr(
        "ari.api.workspaces.create_runner", lambda *a, **k: _FakeRunner()
    )
    res = asyncio.run(
        recommend_chart(
            wid,
            RecommendChartRequest(base_revision=rev, perspective_id="v-adoption"),
            conn=conn,
        )
    )
    assert res.chart == "matrix"
    assert res.reason
    assert res.revision == rev
    assert res.existing_charts == []


def test_recommend_chart_endpoint_stale_409(tutorial, conn, monkeypatch):
    from ari.domain.operations import SetPurpose
    from ari.domain.workspace import apply_patch

    wid, rev, _ = tutorial
    monkeypatch.setattr(
        "ari.api.workspaces.create_runner", lambda *a, **k: _FakeRunner()
    )
    apply_patch(conn, wid, "req-stale-rc", rev, [SetPurpose(text="x")])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            recommend_chart(
                wid,
                RecommendChartRequest(base_revision=rev, perspective_id="v-adoption"),
                conn=conn,
            )
        )
    assert exc.value.status_code == 409


def test_recommend_chart_endpoint_no_llm_503(tutorial, conn, monkeypatch):
    wid, rev, _ = tutorial
    monkeypatch.setattr("ari.api.workspaces.create_runner", lambda *a, **k: None)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            recommend_chart(
                wid,
                RecommendChartRequest(base_revision=rev, perspective_id="v-adoption"),
                conn=conn,
            )
        )
    assert exc.value.status_code == 503
```

- [ ] **Step 3: Implement endpoint**

```python
# workspaces.py
@router.post("/{workspace_id}/recommend-chart", response_model=RecommendChartResponse)
async def recommend_chart(
    workspace_id: str, body: RecommendChartRequest, conn=Depends(get_conn)
) -> RecommendChartResponse:
    ws = get_workspace(conn, workspace_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作区不存在")
    if body.base_revision != ws["revision"]:
        raise HTTPException(
            status_code=409,
            detail={"message": "版本已变，请刷新后重试", "current_revision": ws["revision"]},
        )
    snapshot = ws["snapshot"]
    try:
        ctx = build_recommend_context(snapshot, body.perspective_id)
    except RecommendChartError as exc:
        raise HTTPException(
            status_code=422,
            detail={"message": str(exc), "recovery": exc.recovery},
        ) from None

    runner = create_runner(settings.llm, "recommend_chart")
    if runner is None:
        raise HTTPException(
            status_code=503,
            detail="AI 未配置（需 ari.yaml 的 llm.base_url/model 与 LLM_API_KEY）",
        )
    prompt = render_recommend_prompt(ctx)
    try:
        output = await runner.run(prompt, RecommendChartOutput)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"模型调用失败：{exc}") from None

    assert isinstance(output, RecommendChartOutput)
    return RecommendChartResponse(
        revision=ws["revision"],
        chart=output.chart,
        reason=output.reason,
        existing_charts=existing_charts(snapshot, body.perspective_id),
    )
```

- [ ] **Step 4: Update `docs/contract.md` API table**

Add row:

`| POST `/{id}/recommend-chart` | `{base_revision, perspective_id}` | `{revision, chart, reason, existing_charts[]}` |`

- [ ] **Step 5: Run tests**

Run: `cd backend && uv run pytest tests/test_recommend_chart.py -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/ari/api/schemas.py backend/src/ari/api/workspaces.py docs/contract.md backend/tests/test_recommend_chart.py backend/pyproject.toml backend/uv.lock
git commit -m "$(cat <<'EOF'
feat: add POST recommend-chart endpoint

Return AI-picked structure chart for a perspective without mutating the snapshot.
EOF
)"
```

---

### Task 4: 前端类型、API、chartPrefs

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/lib/chartPrefs.ts`

**Interfaces:**
- Produces:
  - `export type RecommendChart = "flow" | "venn" | "matrix" | "pyramid" | "logic_tree"`
  - `export interface RecommendChartResult { revision: number; chart: RecommendChart; reason: string; existing_charts: RecommendChart[] }`
  - `api.recommendChart(id, baseRevision, perspectiveId): Promise<RecommendChartResult>`
  - `ChartPrefs.manualChart: RecommendChart | null`
  - `ChartPrefs.dismissedConflictAtRevision: number | null`

- [ ] **Step 1: Extend types**

```typescript
export type RecommendChart =
  | "flow"
  | "venn"
  | "matrix"
  | "pyramid"
  | "logic_tree";

export interface RecommendChartResult {
  revision: number;
  chart: RecommendChart;
  reason: string;
  existing_charts: RecommendChart[];
}
```

- [ ] **Step 2: API client method**

```typescript
recommendChart(
  id: string,
  baseRevision: number,
  perspectiveId: string,
): Promise<RecommendChartResult> {
  return request<RecommendChartResult>(`/${id}/recommend-chart`, {
    method: "POST",
    body: JSON.stringify({
      base_revision: baseRevision,
      perspective_id: perspectiveId,
    }),
  });
},
```

- [ ] **Step 3: chartPrefs defaults**

```typescript
export interface ChartPrefs {
  selected: ChartType;
  collapsed: Record<string, boolean>;
  layout: Record<string, string>;
  returnTarget: { chart: ChartType; perspectiveId: string } | null;
  manualChart: RecommendChart | null;
  dismissedConflictAtRevision: number | null;
}

const DEFAULTS: ChartPrefs = {
  selected: "classification",
  collapsed: {},
  layout: {},
  returnTarget: null,
  manualChart: null,
  dismissedConflictAtRevision: null,
};
```

（`loadChartPrefs` 已 spread `DEFAULTS`，旧 localStorage 缺字段会回落。）

- [ ] **Step 4: Verify compile**

Run: `cd frontend && npm run build`  
Expected: 成功（尚无 UI 引用亦可）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/api/client.ts frontend/src/lib/chartPrefs.ts
git commit -m "$(cat <<'EOF'
feat: wire recommend-chart client types and prefs fields
EOF
)"
```

---

### Task 5: resolveActiveChart 纯函数

**Files:**
- Create: `frontend/src/lib/resolveActiveChart.ts`

**Interfaces:**
- Consumes: `RecommendChart`
- Produces: `resolveActiveChart(input): RecommendChart` 与 `editorParamToRecommendChart(param: string | null): RecommendChart | null`

- [ ] **Step 1: Implement**

```typescript
import type { RecommendChart } from "./types";

const ALL: RecommendChart[] = [
  "flow",
  "venn",
  "matrix",
  "pyramid",
  "logic_tree",
];

export function editorParamToRecommendChart(
  param: string | null,
): RecommendChart | null {
  if (!param) return null;
  if (param === "sets") return "venn";
  if (param === "flow" || param === "matrix" || param === "pyramid" || param === "logic_tree") {
    return param;
  }
  return null;
}

export function resolveActiveChart(input: {
  editorParam: string | null;
  manualChart: RecommendChart | null;
  recommended: RecommendChart | null;
  existingCharts: RecommendChart[];
}): RecommendChart {
  const fromUrl = editorParamToRecommendChart(input.editorParam);
  if (fromUrl) return fromUrl;
  if (input.manualChart && ALL.includes(input.manualChart)) return input.manualChart;
  if (input.recommended && ALL.includes(input.recommended)) return input.recommended;
  if (input.existingCharts.length > 0) return input.existingCharts[0]!;
  return "flow";
}

export const RECOMMEND_CHART_LABELS: Record<RecommendChart, string> = {
  flow: "流程 / 循环",
  venn: "维恩集合",
  matrix: "矩阵",
  pyramid: "金字塔",
  logic_tree: "逻辑树",
};
```

- [ ] **Step 2: `npm run build` — expect PASS**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/resolveActiveChart.ts
git commit -m "$(cat <<'EOF'
feat: add active chart priority resolver for pillar page
EOF
)"
```

---

### Task 6: PillarChartPanel + 改造 PillarPage

**Files:**
- Create: `frontend/src/components/PillarChartPanel.tsx`
- Modify: `frontend/src/routes/PillarPage.tsx`

**Interfaces:**
- Consumes: `api.recommendChart`, `resolveActiveChart`, editors, `chartPrefs`, snapshot visualizations
- Produces: 单卡 UI；请求缓存于组件 state/`useRef` Map

- [ ] **Step 1: Implement `PillarChartPanel`**

要点：

```tsx
// Props 含 workspaceId, revision, perspectiveId, snapshot 中本视角的 flow/sets/matrix/pyramid/logicTree,
// editorParam from searchParams, onSaved noop 可继续传

// state:
// - status: "loading" | "ready" | "error"
// - recommended: RecommendChart | null
// - reason: string
// - existingCharts: RecommendChart[]
// - pickerOpen: boolean
// - prefs via load/save ChartPrefs

// useEffect on (workspaceId, perspectiveId, revision):
//   check memory cache key `${workspaceId}:${perspectiveId}:${revision}`
//   else api.recommendChart(...).then / catch

// active = resolveActiveChart({ editorParam, manualChart: prefs.manualChart, recommended, existingCharts })

// conflict when:
//   status==="ready" && recommended && existingCharts.length>0
//   && !existingCharts.includes(recommended)
//   && prefs.dismissedConflictAtRevision !== revision
//   && prefs.manualChart == null

// Render:
// - optional banner
// - header: 推荐/当前 + reason
// - button 重新推荐
// - switch(active) mount one editor
// - 「换一种图形」toggle list of other four; onClick set manualChart + savePrefs
```

编辑器映射：

| active | component |
|--------|-----------|
| flow | `<FlowEditor flow={flow} …>` |
| venn | `<VennEditor sets={sets} …>` |
| matrix | `<MatrixEditor matrix={matrix} …>` |
| pyramid | `<PyramidEditor pyramid={pyramid} …>` |
| logic_tree | `<LogicTreeEditor tree={logicTree} …>` |

- [ ] **Step 2: Slim `PillarPage`**

删除五个并列 `<section>` 与五个 `show*Editor` state；保留 `searchParams.get("editor")` 传入 panel。`PillarBoard` / `addPillar` 不变。

```tsx
<PillarChartPanel
  workspaceId={workspaceId!}
  revision={revision}
  perspectiveId={currentActiveId}
  editorParam={searchParams.get("editor")}
  flow={flow ?? null}
  sets={sets ?? null}
  matrix={matrix ?? null}
  pyramid={pyramid ?? null}
  logicTree={logicTree ?? null}
/>
```

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`  
Expected: PASS

- [ ] **Step 4: Manual smoke（需后端 + `ari.yaml` LLM）**

1. 打开教程工作区 → 支柱页：应见骨架后单卡推荐，非五段并列。  
2. 「换一种」切到矩阵并刷新：应保持矩阵（manualChart）。  
3. 表达页某图「去补全」带 `?editor=sets`：应打开维恩。  
4. 先保存矩阵结构，清 manual、重新推荐若推 flow：应见冲突 banner；「继续编辑」关闭；revision 变更后再可出现。  
5. 停掉 LLM / 错误配置：行内「推荐暂时不可用」，仍可编辑默认 flow。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PillarChartPanel.tsx frontend/src/routes/PillarPage.tsx
git commit -m "$(cat <<'EOF'
feat: show one AI-recommended chart editor on pillar page

Replace the five stacked editors with a single card, picker, and conflict banner.
EOF
)"
```

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| 五候选、不推 classification/cycle | 1, 2, 5 |
| POST recommend-chart + 字段 | 3 |
| 不写快照 / 不生成草稿 | 3, 6 |
| 单卡 + 换一种 | 6 |
| 优先级 URL > 手动 > AI > 降级 | 5, 6 |
| chartPrefs 扩展 | 4, 6 |
| 冲突 banner 双按钮 + revision 关闭 | 6 |
| 失败 503/502 + 前端降级 | 3, 6 |
| sets→venn | 1, 5 |
| contract 登记 | 3 |
| 测试 | 1–3 自动；6 手工 |

无 TBD/占位实现步骤。类型名全程统一为 `RecommendChart` / `RecommendChartResult` / `RecommendChartOutput`。
