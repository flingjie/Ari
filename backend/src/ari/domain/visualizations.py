"""可视化关系结构的校验与读取。

每种图形对应一个「按视角持久化的关系结构」；校验分硬/软两级：
- 硬问题：结构无法成立（写入 422、读取 status=missing）；
- 软问题：结构成立但信息不完整（写入允许、读取 status=available，带标记）。

写入（operations.apply）与读取（build_visualization_view）共用同一份规则。
"""

from __future__ import annotations

from typing import Literal, cast

from pydantic import BaseModel, Field

from ..models import (
    Flow,
    LogicTree,
    MatrixStructure,
    Pyramid,
    SetsStructure,
    Visualization,
    WorkspaceSnapshot,
)
from .grouping import GroupedPerspective

ChartType = Literal[
    "classification", "flow", "cycle", "venn", "matrix", "pyramid", "logic_tree"
]
FillTarget = Literal["perspective", "pillar"]


class VisualizationViewError(ValueError):
    """请求的视角不存在等读取错误；``recovery`` 提示调用方如何恢复。"""

    def __init__(self, message: str, recovery: str) -> None:
        super().__init__(message)
        self.recovery = recovery


class MissingField(BaseModel):
    code: str
    message: str
    target: FillTarget | None = None


class ChartStatus(BaseModel):
    chart: ChartType
    status: Literal["ready", "available", "missing"]
    missing: list[MissingField] = Field(default_factory=list)


class VisualizationView(BaseModel):
    purpose: str
    perspective: GroupedPerspective
    charts: list[ChartStatus]
    flow: Flow | None = None
    sets: SetsStructure | None = None
    matrix: MatrixStructure | None = None
    pyramid: Pyramid | None = None
    logic_tree: LogicTree | None = None


# —— 校验函数：返回 (hard, soft)，均为中文问题描述 ——


def flow_problems(
    snapshot: WorkspaceSnapshot, flow: Flow
) -> tuple[list[str], list[str]]:
    hard: list[str] = []
    steps = flow.steps
    ids = [s.id for s in steps]
    id_set = set(ids)
    if len(steps) < 2:
        hard.append("流程至少需要两个步骤")
    if len(ids) != len(id_set):
        hard.append("步骤 id 重复")

    for b in flow.branches:
        if b.from_step_id not in id_set:
            hard.append(f"分支起点不是步骤: {b.from_step_id}")
        if b.to_step_id not in id_set:
            hard.append(f"分支终点不是步骤: {b.to_step_id}")
        if b.from_step_id == b.to_step_id:
            hard.append("分支不能自连")

    # 分支成环检测（对分支边做 DFS）。
    adj: dict[str, list[str]] = {}
    for b in flow.branches:
        adj.setdefault(b.from_step_id, []).append(b.to_step_id)
    if _has_cycle(adj):
        hard.append("分支存在环")

    # 同一步多条出边：必须填条件且互不相同。
    out: dict[str, list[str]] = {}
    for b in flow.branches:
        out.setdefault(b.from_step_id, []).append(b.condition)
    for sid, conds in out.items():
        if len(conds) > 1:
            if any(not c for c in conds):
                hard.append(f"步骤 {sid} 有多条出边，需填写条件")
            if len(conds) != len(set(conds)):
                hard.append(f"步骤 {sid} 的出边条件重复")

    # 反馈边：终点必须是严格上游步骤。
    index_of = {sid: i for i, sid in enumerate(ids)}
    for f in flow.feedback:
        if f.from_step_id not in id_set:
            hard.append(f"反馈起点不是步骤: {f.from_step_id}")
        if f.to_step_id not in id_set:
            hard.append(f"反馈终点不是步骤: {f.to_step_id}")
        if f.from_step_id == f.to_step_id:
            hard.append("反馈不能自连")
        if (
            f.from_step_id in index_of
            and f.to_step_id in index_of
            and index_of[f.to_step_id] >= index_of[f.from_step_id]
        ):
            hard.append("反馈终点必须是严格上游步骤")

    return hard, []


def sets_problems(
    snapshot: WorkspaceSnapshot, sets: SetsStructure
) -> tuple[list[str], list[str]]:
    hard: list[str] = []
    soft: list[str] = []
    if sets.set_a.id == sets.set_b.id:
        hard.append("两个集合的 id 不能相同")
    piece_ids = {p.id for p in snapshot.pieces}
    seen: set[str] = set()
    for m in sets.members:
        if m.piece_id not in piece_ids:
            hard.append(f"成员片段不存在: {m.piece_id}")
        if m.piece_id in seen:
            hard.append(f"片段重复出现在集合中: {m.piece_id}")
        seen.add(m.piece_id)
    if not sets.set_a.name:
        soft.append("集合 A 缺少名称")
    if not sets.set_b.name:
        soft.append("集合 B 缺少名称")
    return hard, soft


def matrix_problems(
    snapshot: WorkspaceSnapshot, matrix: MatrixStructure
) -> tuple[list[str], list[str]]:
    hard: list[str] = []
    if len(matrix.x_axis.values) < 2:
        hard.append("横轴至少需要两个取值")
    if len(matrix.y_axis.values) < 2:
        hard.append("纵轴至少需要两个取值")
    x_ids = [v.id for v in matrix.x_axis.values]
    y_ids = [v.id for v in matrix.y_axis.values]
    if len(x_ids) != len(set(x_ids)):
        hard.append("横轴取值 id 重复")
    if len(y_ids) != len(set(y_ids)):
        hard.append("纵轴取值 id 重复")
    x_set, y_set = set(x_ids), set(y_ids)
    piece_ids = {p.id for p in snapshot.pieces}
    seen: set[str] = set()
    for c in matrix.coordinates:
        if c.piece_id not in piece_ids:
            hard.append(f"定位片段不存在: {c.piece_id}")
        if c.piece_id in seen:
            hard.append(f"片段重复定位: {c.piece_id}")
        seen.add(c.piece_id)
        if c.x_value_id not in x_set:
            hard.append(f"横轴取值不存在: {c.x_value_id}")
        if c.y_value_id not in y_set:
            hard.append(f"纵轴取值不存在: {c.y_value_id}")
    return hard, []


def pyramid_problems(
    snapshot: WorkspaceSnapshot, pyramid: Pyramid
) -> tuple[list[str], list[str]]:
    hard: list[str] = []
    soft: list[str] = []
    if len(pyramid.points) < 1:
        hard.append("金字塔至少需要一个要点")
    ids = [p.id for p in pyramid.points]
    if len(ids) != len(set(ids)):
        hard.append("要点 id 重复")
    piece_ids = {p.id for p in snapshot.pieces}
    pillar_ids = snapshot.pillar_ids(pyramid.perspective_id)
    for pt in pyramid.points:
        if pt.pillar_id is not None and pt.pillar_id not in pillar_ids:
            hard.append(f"要点引用的支柱不存在或不属于该视角: {pt.pillar_id}")
        for e in pt.evidence:
            if e not in piece_ids:
                hard.append(f"证据片段不存在: {e}")
    if not pyramid.conclusion:
        soft.append("缺少核心结论")
    for pt in pyramid.points:
        if not pt.evidence:
            soft.append(f"要点缺少证据: {pt.text or pt.id}")
    return hard, soft


def logic_tree_problems(
    snapshot: WorkspaceSnapshot, tree: LogicTree
) -> tuple[list[str], list[str]]:
    hard: list[str] = []
    soft: list[str] = []
    nodes = tree.nodes
    if len(nodes) < 1:
        hard.append("逻辑树至少需要一个节点")
    ids = [n.id for n in nodes]
    id_set = set(ids)
    if len(ids) != len(id_set):
        hard.append("节点 id 重复")
    roots = [n for n in nodes if n.parent_id is None]
    if len(roots) != 1:
        hard.append("逻辑树必须有且只有一个根节点")
    for n in nodes:
        if n.parent_id is not None and n.parent_id not in id_set:
            hard.append(f"父节点不存在: {n.parent_id}")

    # 环检测：沿父链回溯，重访即环。
    parent = {n.id: n.parent_id for n in nodes}
    for n in nodes:
        seen: set[str] = set()
        cur: str | None = n.id
        while cur is not None:
            if cur in seen:
                hard.append("逻辑树存在环")
                break
            seen.add(cur)
            cur = parent.get(cur)
        if any("环" in h for h in hard):
            break

    piece_ids = {p.id for p in snapshot.pieces}
    for n in nodes:
        for m in n.materials:
            if m not in piece_ids:
                hard.append(f"材料片段不存在: {m}")

    if len(roots) == 1 and not any(n.parent_id == roots[0].id for n in nodes):
        soft.append("根问题还没有子问题")

    return hard, soft


def _has_cycle(adj: dict[str, list[str]]) -> bool:
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {}

    def dfs(u: str) -> bool:
        color[u] = GRAY
        for v in adj.get(u, []):
            if color.get(v, WHITE) == GRAY:
                return True
            if color.get(v, WHITE) == WHITE and dfs(v):
                return True
        color[u] = BLACK
        return False

    for u in list(adj.keys()):
        if color.get(u, WHITE) == WHITE:
            if dfs(u):
                return True
    return False


# —— 读取视图 ——

_CHART_ORDER: list[ChartType] = [
    "classification",
    "flow",
    "cycle",
    "venn",
    "matrix",
    "pyramid",
    "logic_tree",
]


def _target(chart: ChartType) -> FillTarget:
    # 矩阵的轴在视角页配置，其余关系编辑器在支柱页。
    return "perspective" if chart == "matrix" else "pillar"


def _status(
    chart: ChartType,
    structure: Visualization | None,
    hard: list[str],
    soft: list[str],
) -> ChartStatus:
    target = _target(chart)
    if structure is None:
        return ChartStatus(
            chart=chart,
            status="missing",
            missing=[MissingField(code=f"{chart}.no_structure", message="尚未定义结构", target=target)],
        )
    if hard:
        return ChartStatus(
            chart=chart,
            status="missing",
            missing=[MissingField(code=f"{chart}.invalid", message=h, target=target) for h in hard],
        )
    if soft:
        return ChartStatus(
            chart=chart,
            status="available",
            missing=[
                MissingField(code=f"{chart}.incomplete", message=s, target=target) for s in soft
            ],
        )
    return ChartStatus(chart=chart, status="ready")


def build_visualization_view(
    snapshot: WorkspaceSnapshot, perspective_id: str
) -> VisualizationView:
    """按指定视角返回全部图形的就绪状态与结构。纯读取，不切换当前视角。"""
    perspective = snapshot.perspective(perspective_id)
    if perspective is None:
        raise VisualizationViewError(
            f"视角不存在: {perspective_id}",
            "请回到视角阶段选择或重新创建视角",
        )

    flow = cast(Flow | None, snapshot.visualization(perspective_id, "flow"))
    sets = cast(SetsStructure | None, snapshot.visualization(perspective_id, "sets"))
    matrix = cast(MatrixStructure | None, snapshot.visualization(perspective_id, "matrix"))
    pyramid = cast(Pyramid | None, snapshot.visualization(perspective_id, "pyramid"))
    logic_tree = cast(
        LogicTree | None, snapshot.visualization(perspective_id, "logic_tree")
    )

    flow_hard, flow_soft = flow_problems(snapshot, flow) if flow else ([], [])

    charts: list[ChartStatus] = []
    for chart in _CHART_ORDER:
        if chart == "classification":
            charts.append(ChartStatus(chart=chart, status="ready"))
        elif chart == "flow":
            charts.append(_status("flow", flow, flow_hard, flow_soft))
        elif chart == "cycle":
            charts.append(_cycle_status(flow, flow_hard))
        elif chart == "venn":
            hard, soft = sets_problems(snapshot, sets) if sets else ([], [])
            charts.append(_status("venn", sets, hard, soft))
        elif chart == "matrix":
            hard, soft = matrix_problems(snapshot, matrix) if matrix else ([], [])
            charts.append(_status("matrix", matrix, hard, soft))
        elif chart == "pyramid":
            hard, soft = pyramid_problems(snapshot, pyramid) if pyramid else ([], [])
            charts.append(_status("pyramid", pyramid, hard, soft))
        elif chart == "logic_tree":
            hard, soft = logic_tree_problems(snapshot, logic_tree) if logic_tree else ([], [])
            charts.append(_status("logic_tree", logic_tree, hard, soft))

    return VisualizationView(
        purpose=snapshot.purpose,
        perspective=GroupedPerspective(id=perspective.id, name=perspective.name),
        charts=charts,
        flow=flow,
        sets=sets,
        matrix=matrix,
        pyramid=pyramid,
        logic_tree=logic_tree,
    )


def _cycle_status(flow: Flow | None, flow_hard: list[str]) -> ChartStatus:
    target = _target("cycle")
    if flow is None:
        return ChartStatus(
            chart="cycle",
            status="missing",
            missing=[
                MissingField(code="cycle.no_structure", message="先定义流程步骤", target=target)
            ],
        )
    if flow_hard:
        return ChartStatus(
            chart="cycle",
            status="missing",
            missing=[
                MissingField(code="cycle.invalid", message=h, target=target) for h in flow_hard
            ],
        )
    if not flow.feedback:
        return ChartStatus(
            chart="cycle",
            status="available",
            missing=[
                MissingField(code="cycle.no_feedback", message="尚未添加反馈边", target=target)
            ],
        )
    return ChartStatus(chart="cycle", status="ready")
