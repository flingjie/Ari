"""领域模型：工作区快照及其组成部分。

快照以 JSON 存于 SQLite ``workspaces.snapshot``。两份关系分开保存：
- ``Piece.parent_id`` 树表示采集时的上下文；
- ``Assignment`` 表示选定视角下的归属（同一原话在不同视角可归不同支柱）。
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

# 片段来源类型：quote=用户原话；inferred=AI 推测（可区分、可追溯）。
PieceKind = Literal["quote", "inferred"]

# 主题直接子节点在双侧布局下的分侧。
PieceSide = Literal["left", "right"]


class Piece(BaseModel):
    """导图节点。根节点 ``parent_id`` 为空，仅作主题（可独立命名）。"""

    id: str
    parent_id: str | None = None
    text: str
    order: int = 0
    source: str = ""  # 来源标注（用户原话出处）
    kind: PieceKind = "quote"
    side: PieceSide | None = None  # 仅主题直接子节点有效；旧快照缺省为 None


class Perspective(BaseModel):
    """候选视角（角度）。名称与理由说明「这个角度能回答什么」。"""

    id: str
    name: str
    reason: str = ""


class Pillar(BaseModel):
    """某视角下的支柱（分组）。稳定 ID，重命名或排序不改变引用。"""

    id: str
    perspective_id: str
    name: str
    order: int = 0


class Assignment(BaseModel):
    """归属：``(perspective_id, piece_id)`` 至多一条；``pillar_id`` 为空即「待归类」。"""

    perspective_id: str
    piece_id: str
    pillar_id: str | None = None


# —— 可视化关系结构（按视角持久化，旧快照缺省为空列表） ——

VisualizationType = Literal["flow", "sets", "matrix", "pyramid", "logic_tree"]


class FlowStep(BaseModel):
    """流程步骤；``pillar_id`` 可选，支柱删除后置 None。"""

    id: str
    text: str
    pillar_id: str | None = None


class FlowBranch(BaseModel):
    """普通分支连线；同一步多出边时 ``condition`` 必填且互不相同。"""

    id: str
    from_step_id: str
    to_step_id: str
    condition: str = ""


class FlowFeedback(BaseModel):
    """反馈边；``to_step_id`` 必须指向严格上游步骤。"""

    id: str
    from_step_id: str
    to_step_id: str
    meaning: str = ""


class Flow(BaseModel):
    type: Literal["flow"] = "flow"
    perspective_id: str
    steps: list[FlowStep] = Field(default_factory=list)  # 列表顺序 = 步骤顺序
    branches: list[FlowBranch] = Field(default_factory=list)
    feedback: list[FlowFeedback] = Field(default_factory=list)


class VennSet(BaseModel):
    id: str  # 稳定，改名保留 id
    name: str


class SetMember(BaseModel):
    piece_id: str
    region: Literal["a", "b", "both"]


class SetsStructure(BaseModel):
    type: Literal["sets"] = "sets"
    perspective_id: str
    set_a: VennSet
    set_b: VennSet
    members: list[SetMember] = Field(default_factory=list)


class MatrixAxisValue(BaseModel):
    id: str  # 稳定，改名保留 id
    name: str


class MatrixAxis(BaseModel):
    id: str
    name: str
    values: list[MatrixAxisValue] = Field(default_factory=list)


class MatrixCoordinate(BaseModel):
    piece_id: str  # 每个矩阵内至多一个坐标
    x_value_id: str
    y_value_id: str


class MatrixStructure(BaseModel):
    type: Literal["matrix"] = "matrix"
    perspective_id: str
    x_axis: MatrixAxis
    y_axis: MatrixAxis
    coordinates: list[MatrixCoordinate] = Field(default_factory=list)


class PyramidPoint(BaseModel):
    id: str
    text: str
    pillar_id: str | None = None  # 可选支柱引用；支柱删除后置 None
    evidence: list[str] = Field(default_factory=list)  # 证据片段 id，保持顺序


class Pyramid(BaseModel):
    type: Literal["pyramid"] = "pyramid"
    perspective_id: str
    conclusion: str = ""
    points: list[PyramidPoint] = Field(default_factory=list)


class LogicTreeNode(BaseModel):
    id: str
    text: str
    parent_id: str | None = None  # None = 单根
    materials: list[str] = Field(default_factory=list)  # 材料片段 id


class LogicTree(BaseModel):
    type: Literal["logic_tree"] = "logic_tree"
    perspective_id: str
    nodes: list[LogicTreeNode] = Field(default_factory=list)  # 列表顺序 = 同级顺序


Visualization = Annotated[
    Flow | SetsStructure | MatrixStructure | Pyramid | LogicTree,
    Field(discriminator="type"),
]


class WorkspaceSnapshot(BaseModel):
    """当前工作区完整状态（只保存当前版本）。"""

    purpose: str = ""
    root_id: str
    active_perspective_id: str | None = None
    pieces: list[Piece] = Field(default_factory=list)
    perspectives: list[Perspective] = Field(default_factory=list)
    pillars: list[Pillar] = Field(default_factory=list)
    assignments: list[Assignment] = Field(default_factory=list)
    visualizations: list[Visualization] = Field(default_factory=list)

    # —— 便捷查询 ——
    def piece(self, piece_id: str) -> Piece | None:
        return next((p for p in self.pieces if p.id == piece_id), None)

    def root(self) -> Piece | None:
        return self.piece(self.root_id)

    def perspective(self, perspective_id: str) -> Perspective | None:
        return next((p for p in self.perspectives if p.id == perspective_id), None)

    def pillar(self, pillar_id: str) -> Pillar | None:
        return next((p for p in self.pillars if p.id == pillar_id), None)

    def pillar_ids(self, perspective_id: str) -> set[str]:
        return {p.id for p in self.pillars if p.perspective_id == perspective_id}

    def visualization(
        self, perspective_id: str, viz_type: VisualizationType
    ) -> Visualization | None:
        return next(
            (
                v
                for v in self.visualizations
                if v.perspective_id == perspective_id and v.type == viz_type
            ),
            None,
        )
