"""领域模型：工作区快照及其组成部分。

快照以 JSON 存于 SQLite ``workspaces.snapshot``。两份关系分开保存：
- ``Piece.parent_id`` 树表示采集时的上下文；
- ``Assignment`` 表示选定视角下的归属（同一原话在不同视角可归不同支柱）。
"""

from __future__ import annotations

from typing import Literal

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


class WorkspaceSnapshot(BaseModel):
    """当前工作区完整状态（只保存当前版本）。"""

    purpose: str = ""
    root_id: str
    active_perspective_id: str | None = None
    pieces: list[Piece] = Field(default_factory=list)
    perspectives: list[Perspective] = Field(default_factory=list)
    pillars: list[Pillar] = Field(default_factory=list)
    assignments: list[Assignment] = Field(default_factory=list)

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
