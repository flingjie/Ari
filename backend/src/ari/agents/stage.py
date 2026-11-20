"""阶段助手：按阶段选择上下文、输出模型与允许操作，并把结构化输出物化为领域操作。"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from ..domain.operations import (
    AddPerspective,
    AddPiece,
    AddPillar,
    AssignPiece,
    Operation,
    OperationError,
    SetPurpose,
)
from ..models import PieceKind, WorkspaceSnapshot

Stage = Literal["purpose", "piece", "perspective", "pillar", "presentation"]

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"

# 每个阶段允许的 AI 操作（阶段权限）。
STAGE_ALLOWED_OPS: dict[Stage, set[str]] = {
    "purpose": {"set_purpose"},
    "piece": {"add_piece", "update_piece"},
    "perspective": {"add_perspective"},
    "pillar": {"add_pillar", "assign_piece"},
    "presentation": set(),
}


class PurposeOutput(BaseModel):
    reply: str = ""
    rewritten_purpose: str = ""


class FragmentSuggestion(BaseModel):
    text: str
    parent_id: str | None = None
    kind: PieceKind = "inferred"


class PieceOutput(BaseModel):
    reply: str = ""
    fragments: list[FragmentSuggestion] = Field(default_factory=list)


class PerspectiveSuggestion(BaseModel):
    name: str
    reason: str = ""


class PerspectiveOutput(BaseModel):
    reply: str = ""
    perspectives: list[PerspectiveSuggestion] = Field(default_factory=list)


class PillarSuggestion(BaseModel):
    name: str


class AssignmentSuggestion(BaseModel):
    piece_id: str
    pillar_name: str | None = None  # None = 待归类


class PillarOutput(BaseModel):
    reply: str = ""
    pillars: list[PillarSuggestion] = Field(default_factory=list)
    assignments: list[AssignmentSuggestion] = Field(default_factory=list)


class PresentationOutput(BaseModel):
    reply: str = ""


OUTPUT_MODELS: dict[Stage, type[BaseModel]] = {
    "purpose": PurposeOutput,
    "piece": PieceOutput,
    "perspective": PerspectiveOutput,
    "pillar": PillarOutput,
    "presentation": PresentationOutput,
}


def build_context(snapshot: WorkspaceSnapshot, stage: Stage) -> dict[str, str]:
    """按阶段装配提示词上下文。"""
    active = snapshot.active_perspective_id
    perspective_name = ""
    pillars_json = "[]"
    assignments_json = "[]"
    if active:
        perspective = snapshot.perspective(active)
        perspective_name = perspective.name if perspective else active
        pillars_json = json.dumps(
            [p.model_dump() for p in snapshot.pillars if p.perspective_id == active],
            ensure_ascii=False,
        )
        assignments_json = json.dumps(
            [a.model_dump() for a in snapshot.assignments if a.perspective_id == active],
            ensure_ascii=False,
        )
    return {
        "purpose": snapshot.purpose,
        "pieces_json": json.dumps(
            [p.model_dump() for p in snapshot.pieces], ensure_ascii=False
        ),
        "perspectives_json": json.dumps(
            [p.model_dump() for p in snapshot.perspectives], ensure_ascii=False
        ),
        "active_perspective": perspective_name,
        "pillars_json": pillars_json,
        "assignments_json": assignments_json,
    }


def load_prompt(stage: Stage) -> str:
    path = PROMPT_DIR / f"{stage}.md"
    return path.read_text() if path.exists() else ""


def render_prompt(stage: Stage, context: dict[str, str], question: str) -> str:
    template = load_prompt(stage)
    for key, value in context.items():
        template = template.replace("{" + key + "}", str(value))
    return template.replace("{question}", question)


def materialize(
    stage: Stage, output: BaseModel, snapshot: WorkspaceSnapshot
) -> tuple[str, list[Operation]]:
    """把结构化输出物化为 (reply, operations)。引用不存在时回退到安全默认。"""
    ops: list[Operation] = []

    if isinstance(output, PurposeOutput):
        reply = output.reply
        if output.rewritten_purpose.strip():
            ops.append(SetPurpose(text=output.rewritten_purpose.strip()))

    elif isinstance(output, PieceOutput):
        reply = output.reply
        root_id = snapshot.root_id
        for f in output.fragments:
            text = f.text.strip()
            if not text:
                continue
            parent_id = f.parent_id if (f.parent_id and snapshot.piece(f.parent_id)) else root_id
            ops.append(
                AddPiece(id=uuid.uuid4().hex, parent_id=parent_id, text=text, kind=f.kind)
            )

    elif isinstance(output, PerspectiveOutput):
        reply = output.reply
        for p in output.perspectives:
            name = p.name.strip()
            if not name:
                continue
            ops.append(
                AddPerspective(id=uuid.uuid4().hex, name=name, reason=p.reason.strip())
            )

    elif isinstance(output, PillarOutput):
        reply = output.reply
        active = snapshot.active_perspective_id
        if active:
            name_to_id = {
                pl.name: pl.id for pl in snapshot.pillars if pl.perspective_id == active
            }
            for pl in output.pillars:
                name = pl.name.strip()
                if not name or name in name_to_id:
                    continue
                pid = uuid.uuid4().hex
                name_to_id[name] = pid
                ops.append(AddPillar(id=pid, perspective_id=active, name=name))
            for a in output.assignments:
                if not snapshot.piece(a.piece_id):
                    continue
                pillar_id = name_to_id.get(a.pillar_name) if a.pillar_name else None
                ops.append(
                    AssignPiece(
                        perspective_id=active, piece_id=a.piece_id, pillar_id=pillar_id
                    )
                )

    elif isinstance(output, PresentationOutput):
        reply = output.reply
    else:  # pragma: no cover - 防御性分支
        raise OperationError(f"未知输出类型: {type(output).__name__}")

    return reply, ops


def validate_operations(stage: Stage, ops: list[Operation], snapshot: WorkspaceSnapshot) -> None:
    """阶段权限 + 引用校验（完整校验由 apply 阶段再做）。"""
    allowed = STAGE_ALLOWED_OPS[stage]
    for op in ops:
        if op.type not in allowed:
            raise OperationError(f"阶段 {stage} 不允许操作 {op.type}")
    # 引用的片段/视角须存在（apply 时还会再做一次）。
    for op in ops:
        if isinstance(op, AssignPiece) and not snapshot.piece(op.piece_id):
            raise OperationError(f"引用片段不存在: {op.piece_id}")
