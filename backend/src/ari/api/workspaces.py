"""工作区 REST 端点（相对 /api/workspaces）。"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import TypeAdapter

from ..agents.stage import (
    OUTPUT_MODELS,
    build_context,
    materialize,
    render_prompt,
    validate_operations,
)
from ..domain.export import ExportError, render
from ..domain.operations import Operation, OperationError
from ..domain.proposals import (
    ProposalResolvedError,
    get_message_by_request_id,
    list_pending_proposals,
    resolve_proposal,
    store_message_and_proposal,
)
from ..domain.workspace import (
    ConflictError,
    ReceiptConflictError,
    apply_patch,
    create_workspace,
    get_workspace,
)
from ..llm.runner import create_runner
from .deps import get_conn, settings
from .schemas import (
    CreateRequest,
    ExportQuery,
    ExportResponse,
    MessageRequest,
    MessageResponse,
    PatchRequest,
    PatchResponse,
    ProposalSummary,
    ResolveRequest,
    ResolveResponse,
    WorkspaceResponse,
)

router = APIRouter()

_operation_list = TypeAdapter(list[Operation])


def _proposal_summaries(conn, workspace_id: str) -> list[ProposalSummary]:
    out = []
    for p in list_pending_proposals(conn, workspace_id):
        out.append(
            ProposalSummary(
                id=p["id"],
                stage=p["stage"],
                base_revision=p["base_revision"],
                refs=json.loads(p["refs"]),
                change_set=_operation_list.validate_python(json.loads(p["change_set"])),
                status=p["status"],
                created_at=p["created_at"],
            )
        )
    return out


def _collect_piece_refs(ops: list[Operation]) -> list[str]:
    ids: set[str] = set()
    for op in ops:
        if hasattr(op, "piece_id"):
            ids.add(op.piece_id)
        if hasattr(op, "parent_id"):
            ids.add(op.parent_id)
    return sorted(ids)


@router.post("/", response_model=WorkspaceResponse, status_code=201)
def create(body: CreateRequest, conn=Depends(get_conn)) -> WorkspaceResponse:
    workspace_id, revision, snapshot = create_workspace(conn, body.template)
    return WorkspaceResponse(id=workspace_id, revision=revision, snapshot=snapshot)


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
def get(workspace_id: str, conn=Depends(get_conn)) -> WorkspaceResponse:
    ws = get_workspace(conn, workspace_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作区不存在")
    return WorkspaceResponse(
        id=ws["id"],
        revision=ws["revision"],
        snapshot=ws["snapshot"],
        proposals=_proposal_summaries(conn, workspace_id),
    )


@router.patch("/{workspace_id}", response_model=PatchResponse)
def patch(workspace_id: str, body: PatchRequest, conn=Depends(get_conn)) -> PatchResponse:
    try:
        revision, snapshot = apply_patch(
            conn, workspace_id, body.request_id, body.base_revision, body.operations
        )
    except ConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "current_revision": exc.current_revision},
        ) from None
    except ReceiptConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except OperationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return PatchResponse(revision=revision, snapshot=snapshot)


@router.post("/{workspace_id}/messages", response_model=MessageResponse)
def send_message(
    workspace_id: str, body: MessageRequest, conn=Depends(get_conn)
) -> MessageResponse:
    # 幂等：同一 request_id 直接返回已存储的回复。
    existing = get_message_by_request_id(conn, body.request_id)
    if existing is not None:
        return MessageResponse(
            reply=existing["reply"],
            proposal_id=existing["proposal_id"],
            revision=existing["base_revision"],
        )

    runner = create_runner(settings.llm, body.stage)
    if runner is None:
        raise HTTPException(
            status_code=503, detail="AI 未配置（需 ari.yaml 的 llm.base_url/model 与 LLM_API_KEY）"
        )

    ws = get_workspace(conn, workspace_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作区不存在")
    if body.base_revision != ws["revision"]:
        raise HTTPException(
            status_code=409,
            detail={"message": "版本已变，请刷新后重试", "current_revision": ws["revision"]},
        )

    snapshot = ws["snapshot"]
    prompt = render_prompt(
        body.stage, build_context(snapshot, body.stage), body.question
    )
    try:
        output = runner.run(prompt, OUTPUT_MODELS[body.stage])
        reply, ops = materialize(body.stage, output, snapshot)
        validate_operations(body.stage, ops, snapshot)
    except Exception as exc:  # 模型失败保留工作区，返回可重试状态
        raise HTTPException(status_code=502, detail=f"模型调用失败：{exc}") from None

    refs = {"message": body.request_id, "piece_ids": _collect_piece_refs(ops)}
    proposal_id = store_message_and_proposal(
        conn,
        workspace_id,
        body.stage,
        body.request_id,
        body.question,
        body.base_revision,
        reply,
        ops,
        refs,
    )
    return MessageResponse(reply=reply, proposal_id=proposal_id, revision=ws["revision"])


@router.post("/{workspace_id}/proposals/{proposal_id}/resolve", response_model=ResolveResponse)
def resolve(
    workspace_id: str,
    proposal_id: str,
    body: ResolveRequest,
    conn=Depends(get_conn),
) -> ResolveResponse:
    try:
        revision, snapshot = resolve_proposal(
            conn,
            workspace_id,
            proposal_id,
            body.request_id,
            body.base_revision,
            body.action,
            body.operations,
        )
    except ProposalResolvedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except ConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "current_revision": exc.current_revision},
        ) from None
    except ReceiptConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except OperationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return ResolveResponse(revision=revision, snapshot=snapshot, status=body.action)


@router.get("/{workspace_id}/export", response_model=ExportResponse)
def export(
    workspace_id: str, query: ExportQuery = Depends(), conn=Depends(get_conn)
) -> ExportResponse:
    ws = get_workspace(conn, workspace_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作区不存在")
    if ws["revision"] != query.revision:
        raise HTTPException(
            status_code=409,
            detail={"message": "版本已变，请刷新后再预览", "current_revision": ws["revision"]},
        )
    try:
        content = render(ws["snapshot"], query.perspective_id, query.format)
    except ExportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return ExportResponse(revision=query.revision, format=query.format, content=content)
