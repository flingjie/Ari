"""领域操作与校验：结构编辑与 AI 提议共用同一组 operation。

``move_piece`` 重挂父节点并重排同级顺序，校验根/自挂/环/锚点，
移动后仍是无环树。树的修改由 add（新叶子）、remove（整棵子树）与
move（重挂 + 排序）组成；删除分支在一个事务内删除整棵子树及各视角
中相关归属；禁止删除或移动根节点。
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from ..models import (
    Assignment,
    Perspective,
    Piece,
    PieceKind,
    PieceSide,
    Pillar,
    WorkspaceSnapshot,
)


class OperationError(ValueError):
    """业务校验失败（非法引用/不存在/重复），映射为 422。"""


class SetPurpose(BaseModel):
    type: Literal["set_purpose"] = "set_purpose"
    text: str


class AddPiece(BaseModel):
    type: Literal["add_piece"] = "add_piece"
    id: str
    parent_id: str
    text: str
    order: int | None = None  # None = 追加到同级末尾
    source: str = ""
    kind: PieceKind = "quote"


class UpdatePiece(BaseModel):
    type: Literal["update_piece"] = "update_piece"
    piece_id: str
    text: str


class RemovePiece(BaseModel):
    type: Literal["remove_piece"] = "remove_piece"
    piece_id: str


class MovePiece(BaseModel):
    type: Literal["move_piece"] = "move_piece"
    piece_id: str
    parent_id: str  # 新父节点
    before_piece_id: str | None = None  # 锚点；None = 追加到末尾
    side: PieceSide | None = None  # 仅父为主题时接受


class AddPerspective(BaseModel):
    type: Literal["add_perspective"] = "add_perspective"
    id: str
    name: str
    reason: str = ""


class UpdatePerspective(BaseModel):
    type: Literal["update_perspective"] = "update_perspective"
    id: str
    name: str | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> UpdatePerspective:
        if self.name is None and self.reason is None:
            raise ValueError("update_perspective 需要 name 或 reason 之一")
        return self


class SetActivePerspective(BaseModel):
    type: Literal["set_active_perspective"] = "set_active_perspective"
    id: str


class AddPillar(BaseModel):
    type: Literal["add_pillar"] = "add_pillar"
    id: str
    perspective_id: str
    name: str
    order: int = 0


class RenamePillar(BaseModel):
    type: Literal["rename_pillar"] = "rename_pillar"
    id: str
    name: str


class RemovePillar(BaseModel):
    type: Literal["remove_pillar"] = "remove_pillar"
    id: str


class AssignPiece(BaseModel):
    type: Literal["assign_piece"] = "assign_piece"
    perspective_id: str
    piece_id: str
    pillar_id: str | None = None  # None = 待归类


Operation = Annotated[
    (
        SetPurpose
        | AddPiece
        | UpdatePiece
        | RemovePiece
        | MovePiece
        | AddPerspective
        | UpdatePerspective
        | SetActivePerspective
        | AddPillar
        | RenamePillar
        | RemovePillar
        | AssignPiece
    ),
    Field(discriminator="type"),
]


def _descendants(snapshot: WorkspaceSnapshot, piece_id: str) -> set[str]:
    """返回 piece_id 及其全部后代 id（含自身）。"""
    result: set[str] = {piece_id}
    changed = True
    while changed:
        changed = False
        for p in snapshot.pieces:
            if p.parent_id in result and p.id not in result:
                result.add(p.id)
                changed = True
    return result


def _require_piece(snapshot: WorkspaceSnapshot, piece_id: str) -> None:
    if snapshot.piece(piece_id) is None:
        raise OperationError(f"片段不存在: {piece_id}")


def _require_perspective(snapshot: WorkspaceSnapshot, perspective_id: str) -> None:
    if snapshot.perspective(perspective_id) is None:
        raise OperationError(f"视角不存在: {perspective_id}")


def _require_pillar(snapshot: WorkspaceSnapshot, pillar_id: str) -> None:
    if snapshot.pillar(pillar_id) is None:
        raise OperationError(f"支柱不存在: {pillar_id}")


def _require_unique_id(snapshot: WorkspaceSnapshot, new_id: str, what: str) -> None:
    taken = (
        snapshot.piece(new_id) is not None
        or snapshot.perspective(new_id) is not None
        or snapshot.pillar(new_id) is not None
    )
    if taken:
        raise OperationError(f"{what} id 重复: {new_id}")


def _children_of(snapshot: WorkspaceSnapshot, parent_id: str) -> list[Piece]:
    """按 ``snapshot.pieces`` 列表顺序返回 parent_id 的直接子节点。"""
    return [p for p in snapshot.pieces if p.parent_id == parent_id]


def _renumber_children(snapshot: WorkspaceSnapshot, parent_id: str) -> None:
    """按列表顺序把直接子节点的 ``order`` 重写为 0..n-1（稠密）。"""
    for i, p in enumerate(_children_of(snapshot, parent_id)):
        p.order = i


def _auto_layout_sides(children: list[Piece]) -> dict[str, PieceSide]:
    """复刻 jsMind 0.8.7 ``calculate_next_child_direction``：右偏平衡 R,R,L,L,R,L,…。

    与前端 ``adapter.ts`` 的 ``autoLayoutSides`` 保持同一条规则，用于旧快照
    （根直接子节点缺省 ``side``）补齐左右分侧，避免移动重排后其他根分支换侧。
    """
    sides: dict[str, PieceSide] = {}
    total = 0  # right=+1，left=-1
    count = 0
    for p in children:
        side: PieceSide = "left" if (count > 1 and total > 0) else "right"
        sides[p.id] = side
        total += 1 if side == "right" else -1
        count += 1
    return sides


def apply(snapshot: WorkspaceSnapshot, op: Operation) -> None:
    """就地应用单个操作，校验失败抛 OperationError。"""
    if isinstance(op, SetPurpose):
        snapshot.purpose = op.text

    elif isinstance(op, AddPiece):
        _require_unique_id(snapshot, op.id, "片段")
        _require_piece(snapshot, op.parent_id)
        order = op.order
        if order is None:
            # 未传 order 时追加到同级末尾，避免默认 0 跑到兄弟前面。
            siblings = _children_of(snapshot, op.parent_id)
            order = max((p.order for p in siblings), default=-1) + 1
        snapshot.pieces.append(
            Piece(
                id=op.id,
                parent_id=op.parent_id,
                text=op.text,
                order=order,
                source=op.source,
                kind=op.kind,
            )
        )

    elif isinstance(op, UpdatePiece):
        _require_piece(snapshot, op.piece_id)
        piece = snapshot.piece(op.piece_id)
        assert piece is not None
        piece.text = op.text

    elif isinstance(op, RemovePiece):
        if op.piece_id == snapshot.root_id:
            raise OperationError("禁止删除根节点")
        _require_piece(snapshot, op.piece_id)
        doomed = _descendants(snapshot, op.piece_id)
        snapshot.pieces = [p for p in snapshot.pieces if p.id not in doomed]
        snapshot.assignments = [a for a in snapshot.assignments if a.piece_id not in doomed]

    elif isinstance(op, MovePiece):
        if op.piece_id == snapshot.root_id:
            raise OperationError("禁止移动根节点")
        _require_piece(snapshot, op.piece_id)
        _require_piece(snapshot, op.parent_id)
        if op.parent_id == op.piece_id:
            raise OperationError("不能把片段挂到自身")
        if op.parent_id in _descendants(snapshot, op.piece_id):
            raise OperationError("不能把片段挂到自身后代")
        if op.before_piece_id is not None:
            if op.before_piece_id == op.piece_id:
                raise OperationError("锚点不能是自身")
            anchor = snapshot.piece(op.before_piece_id)
            if anchor is None:
                raise OperationError(f"锚点不存在: {op.before_piece_id}")
            if anchor.parent_id != op.parent_id:
                raise OperationError("锚点不属于目标父节点")
        if op.side is not None and op.parent_id != snapshot.root_id:
            raise OperationError("side 仅主题直接子节点可用")

        piece = snapshot.piece(op.piece_id)
        assert piece is not None
        old_parent_id = piece.parent_id

        # 首次结构写入前，用自动布局规则为旧快照的根直接子节点补齐 side，
        # 避免移动重排后其他根分支换侧。
        if old_parent_id == snapshot.root_id or op.parent_id == snapshot.root_id:
            index_of = {p.id: i for i, p in enumerate(snapshot.pieces)}
            root_children = sorted(
                _children_of(snapshot, snapshot.root_id),
                key=lambda p: (p.order, index_of[p.id]),
            )
            for cid, side in _auto_layout_sides(root_children).items():
                c = snapshot.piece(cid)
                assert c is not None
                if c.side is None:
                    c.side = side

        # 物理重排列表：先移除，再按锚点（或末尾）插入，最后重排 order。
        snapshot.pieces = [p for p in snapshot.pieces if p.id != op.piece_id]
        piece.parent_id = op.parent_id
        if op.parent_id == snapshot.root_id:
            # 主题直接子节点：显式 side 覆盖，否则保留 backfill 或既有 side。
            if op.side is not None:
                piece.side = op.side
        else:
            piece.side = None

        if op.before_piece_id is not None:
            idx = next(
                i for i, p in enumerate(snapshot.pieces) if p.id == op.before_piece_id
            )
        else:
            children = _children_of(snapshot, op.parent_id)
            if children:
                last_id = children[-1].id
                idx = next(i for i, p in enumerate(snapshot.pieces) if p.id == last_id) + 1
            else:
                idx = len(snapshot.pieces)
        snapshot.pieces.insert(idx, piece)

        if old_parent_id is not None:
            _renumber_children(snapshot, old_parent_id)
        if old_parent_id != op.parent_id:
            _renumber_children(snapshot, op.parent_id)

    elif isinstance(op, AddPerspective):
        _require_unique_id(snapshot, op.id, "视角")
        snapshot.perspectives.append(Perspective(id=op.id, name=op.name, reason=op.reason))

    elif isinstance(op, UpdatePerspective):
        _require_perspective(snapshot, op.id)
        p = snapshot.perspective(op.id)
        assert p is not None
        if op.name is not None:
            p.name = op.name
        if op.reason is not None:
            p.reason = op.reason

    elif isinstance(op, SetActivePerspective):
        _require_perspective(snapshot, op.id)
        snapshot.active_perspective_id = op.id

    elif isinstance(op, AddPillar):
        _require_unique_id(snapshot, op.id, "支柱")
        _require_perspective(snapshot, op.perspective_id)
        snapshot.pillars.append(
            Pillar(id=op.id, perspective_id=op.perspective_id, name=op.name, order=op.order)
        )

    elif isinstance(op, RenamePillar):
        _require_pillar(snapshot, op.id)
        pillar = snapshot.pillar(op.id)
        assert pillar is not None
        pillar.name = op.name

    elif isinstance(op, RemovePillar):
        _require_pillar(snapshot, op.id)
        snapshot.pillars = [p for p in snapshot.pillars if p.id != op.id]
        snapshot.assignments = [a for a in snapshot.assignments if a.pillar_id != op.id]

    elif isinstance(op, AssignPiece):
        _require_piece(snapshot, op.piece_id)
        _require_perspective(snapshot, op.perspective_id)
        if op.pillar_id is not None:
            _require_pillar(snapshot, op.pillar_id)
            pillar = snapshot.pillar(op.pillar_id)
            assert pillar is not None
            if pillar.perspective_id != op.perspective_id:
                raise OperationError("目标支柱不属于该视角")
        # 同一 (perspective, piece) 至多一条归属，先移除旧值再写入。
        snapshot.assignments = [
            a
            for a in snapshot.assignments
            if not (a.perspective_id == op.perspective_id and a.piece_id == op.piece_id)
        ]
        snapshot.assignments.append(
            Assignment(
                perspective_id=op.perspective_id,
                piece_id=op.piece_id,
                pillar_id=op.pillar_id,
            )
        )

    else:  # pragma: no cover - 防御性分支
        raise OperationError(f"未知操作: {op.type}")


def apply_all(snapshot: WorkspaceSnapshot, operations: list[Operation]) -> None:
    for op in operations:
        apply(snapshot, op)
