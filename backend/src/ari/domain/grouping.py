"""统一分组计算：按指定视角解析支柱与片段归属。

支柱页、视角卡片预览、表达渲染共用同一份结构化结果，避免多处各自实现分组。
纯函数，不修改快照，也不切换 ``active_perspective_id``。
"""

from __future__ import annotations

from pydantic import BaseModel

from ..models import WorkspaceSnapshot


class GroupedViewError(ValueError):
    """请求的视角不存在等读取错误；``recovery`` 提示调用方如何恢复。"""

    def __init__(self, message: str, recovery: str) -> None:
        super().__init__(message)
        self.recovery = recovery


class GroupedPiece(BaseModel):
    """分组中的片段条目：只带 ID 与原文，原文不做转义。"""

    id: str
    text: str


class GroupedPillar(BaseModel):
    """视角下的一个支柱及其材料。空支柱保留（``pieces=[]``）。"""

    id: str
    name: str
    order: int
    pieces: list[GroupedPiece]


class GroupedPerspective(BaseModel):
    id: str
    name: str


class GroupedView(BaseModel):
    """按视角解析后的分组结果。``unassigned`` 即「待归类」，恒排最后。"""

    purpose: str
    perspective: GroupedPerspective
    pillars: list[GroupedPillar]
    unassigned: list[GroupedPiece]


def build_grouped_view(
    snapshot: WorkspaceSnapshot, perspective_id: str
) -> GroupedView:
    """按指定视角解析分组。规则与 ``export.render`` 原内联分组一致：
    - 片段按 ``(order, id)`` 排序（采集顺序）；
    - 支柱按 ``(order, id)`` 排序；
    - 只读取该视角下的归属，跨视角隔离；
    - 归属缺失或目标为空 → 待归类；
    - 指向不存在支柱的归属沿用原导出行为静默丢弃。
    """
    perspective = snapshot.perspective(perspective_id)
    if perspective is None:
        raise GroupedViewError(
            f"视角不存在: {perspective_id}",
            "请回到视角阶段选择或重新创建视角",
        )

    pieces = sorted(
        (p for p in snapshot.pieces if p.id != snapshot.root_id),
        key=lambda p: (p.order, p.id),
    )
    pillars = sorted(
        (p for p in snapshot.pillars if p.perspective_id == perspective_id),
        key=lambda p: (p.order, p.id),
    )
    assign = {
        a.piece_id: a.pillar_id
        for a in snapshot.assignments
        if a.perspective_id == perspective_id
    }

    pillar_pieces: dict[str, list[GroupedPiece]] = {p.id: [] for p in pillars}
    unassigned: list[GroupedPiece] = []
    for piece in pieces:
        pillar_id = assign.get(piece.id)
        entry = GroupedPiece(id=piece.id, text=piece.text)
        if pillar_id is None:
            unassigned.append(entry)
        elif pillar_id in pillar_pieces:
            pillar_pieces[pillar_id].append(entry)
        # 悬空 pillar_id（归属指向不存在支柱）：静默丢弃，保持导出逐字节一致。

    return GroupedView(
        purpose=snapshot.purpose,
        perspective=GroupedPerspective(id=perspective.id, name=perspective.name),
        pillars=[
            GroupedPillar(id=p.id, name=p.name, order=p.order, pieces=pillar_pieces[p.id])
            for p in pillars
        ],
        unassigned=unassigned,
    )
