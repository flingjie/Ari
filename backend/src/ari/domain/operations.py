"""领域操作与校验：结构编辑与 AI 提议共用同一组 operation。

无 ``move_piece``（重挂父节点）操作，故不存在环；树的唯一修改是
add（新叶子）与 remove（整棵子树）。删除分支在一个事务内删除整棵子树
及各视角中相关归属；禁止删除根节点。
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from ..models import Assignment, Perspective, Piece, PieceKind, Pillar, WorkspaceSnapshot


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
    order: int = 0
    source: str = ""
    kind: PieceKind = "quote"


class UpdatePiece(BaseModel):
    type: Literal["update_piece"] = "update_piece"
    piece_id: str
    text: str


class RemovePiece(BaseModel):
    type: Literal["remove_piece"] = "remove_piece"
    piece_id: str


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


def apply(snapshot: WorkspaceSnapshot, op: Operation) -> None:
    """就地应用单个操作，校验失败抛 OperationError。"""
    if isinstance(op, SetPurpose):
        snapshot.purpose = op.text

    elif isinstance(op, AddPiece):
        _require_unique_id(snapshot, op.id, "片段")
        _require_piece(snapshot, op.parent_id)
        snapshot.pieces.append(
            Piece(
                id=op.id,
                parent_id=op.parent_id,
                text=op.text,
                order=op.order,
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
