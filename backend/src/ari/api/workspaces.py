"""工作区 REST 端点（相对 /api/workspaces）。"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import TypeAdapter

from ..agents.recommend_chart import RecommendChartOutput, render_recommend_prompt
from ..agents.stage import (
    OUTPUT_MODELS,
    build_context,
    materialize,
    render_prompt,
    validate_operations,
)
from ..domain.export import ExportError, render
from ..domain.grouping import GroupedViewError, build_grouped_view
from ..domain.operations import Operation, OperationError
from ..domain.proposals import (
    ProposalResolvedError,
    StaleProposalError,
    get_message_by_request_id,
    get_proposal,
    list_messages,
    list_pending_proposals,
    list_recent_messages,
    resolve_proposal,
    store_message_and_proposal,
)
from ..domain.recommend_chart import (
    RecommendChartError,
    build_recommend_context,
    existing_charts,
)
from ..domain.visualizations import VisualizationViewError, build_visualization_view
from ..domain.workspace import (
    ConflictError,
    NothingToUndoError,
    ReceiptConflictError,
    apply_patch,
    create_workspace,
    get_workspace,
    undo_last,
)
from ..llm.runner import create_runner
from .deps import get_conn, settings
from .schemas import (
    CreateRequest,
    ExportQuery,
    ExportResponse,
    GroupedViewQuery,
    GroupedViewResponse,
    MessagePageResponse,
    MessageRequest,
    MessageResponse,
    MessageSummary,
    PatchRequest,
    PatchResponse,
    ProposalSummary,
    RecommendChartRequest,
    RecommendChartResponse,
    ResolveRequest,
    ResolveResponse,
    UndoRequest,
    VisualizationQuery,
    VisualizationResponse,
    WorkspaceResponse,
)

router = APIRouter()

_operation_list = TypeAdapter(list[Operation])


def _proposal_summary_from_row(p: dict) -> ProposalSummary:
    return ProposalSummary(
        id=p["id"],
        stage=p["stage"],
        base_revision=p["base_revision"],
        refs=json.loads(p["refs"]),
        change_set=_operation_list.validate_python(json.loads(p["change_set"])),
        status=p["status"],
        created_at=p["created_at"],
    )


def _proposal_summaries(conn, workspace_id: str) -> list[ProposalSummary]:
    return [
        _proposal_summary_from_row(dict(p))
        for p in list_pending_proposals(conn, workspace_id)
    ]


def _message_proposal(conn, proposal_id: str | None) -> ProposalSummary | None:
    if not proposal_id:
        return None
    p = get_proposal(conn, proposal_id)
    return _proposal_summary_from_row(dict(p)) if p is not None else None


def _message_summary(conn, m: dict) -> MessageSummary:
    return MessageSummary(
        id=m["id"],
        stage=m["stage"],
        question=m["question"],
        reply=m["reply"],
        proposal_id=m["proposal_id"],
        piece_id=m["piece_id"],
        base_revision=m["base_revision"],
        created_at=m["created_at"],
        trigger=m["trigger"] if "trigger" in m.keys() else None,
        proposal=_message_proposal(conn, m["proposal_id"]),
    )


def _collect_piece_refs(ops: list[Operation]) -> list[str]:
    ids: set[str] = set()
    for op in ops:
        if hasattr(op, "piece_id"):
            ids.add(op.piece_id)
        if hasattr(op, "parent_id"):
            ids.add(op.parent_id)
        if hasattr(op, "before_piece_id") and op.before_piece_id is not None:
            ids.add(op.before_piece_id)
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


@router.post("/{workspace_id}/undo", response_model=PatchResponse)
def undo(workspace_id: str, body: UndoRequest, conn=Depends(get_conn)) -> PatchResponse:
    try:
        revision, snapshot = undo_last(
            conn, workspace_id, body.request_id, body.base_revision
        )
    except ConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "current_revision": exc.current_revision},
        ) from None
    except NothingToUndoError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except ReceiptConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    return PatchResponse(revision=revision, snapshot=snapshot)


@router.get("/{workspace_id}/messages", response_model=MessagePageResponse)
def list_messages_endpoint(
    workspace_id: str, limit: int = 30, before: str | None = None, conn=Depends(get_conn)
) -> MessagePageResponse:
    ws = get_workspace(conn, workspace_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作区不存在")
    limit = max(1, min(limit, 100))
    rows, next_before = list_messages(conn, workspace_id, limit, before)
    return MessagePageResponse(
        messages=[_message_summary(conn, m) for m in rows], next_before=next_before
    )


@router.post("/{workspace_id}/messages", response_model=MessageResponse)
async def send_message(
    workspace_id: str, body: MessageRequest, conn=Depends(get_conn)
) -> MessageResponse:
    # 幂等：同一 request_id 直接返回已存储的回复，但校验内容一致。
    existing = get_message_by_request_id(conn, body.request_id)
    if existing is not None:
        if existing["workspace_id"] != workspace_id:
            raise HTTPException(status_code=409, detail="request_id 属于另一个工作区")
        if existing["question"] != body.question or existing["stage"] != body.stage:
            raise HTTPException(status_code=409, detail="同一 request_id 对应不同载荷")
        return MessageResponse(
            reply=existing["reply"],
            proposal_id=existing["proposal_id"],
            revision=existing["base_revision"],
            proposal=_message_proposal(conn, existing["proposal_id"]),
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
    if body.piece_id is not None and snapshot.piece(body.piece_id) is None:
        raise HTTPException(status_code=422, detail="引用片段不存在或不属于当前工作区")

    runner = create_runner(settings.llm, body.stage)
    if runner is None:
        raise HTTPException(
            status_code=503, detail="AI 未配置（需 ari.yaml 的 llm.base_url/model 与 LLM_API_KEY）"
        )

    history = list_recent_messages(conn, workspace_id, limit=6)
    prompt = render_prompt(
        body.stage, build_context(snapshot, body.stage, history), body.question
    )
    try:
        # 异步 LLM：不占用 FastAPI 同步线程池。
        output = await runner.run(prompt, OUTPUT_MODELS[body.stage])
        reply, ops = materialize(body.stage, output, snapshot)
        validate_operations(body.stage, ops, snapshot)
    except Exception as exc:  # 模型失败保留工作区，返回可重试状态
        raise HTTPException(status_code=502, detail=f"模型调用失败：{exc}") from None

    refs = {"message": body.request_id, "piece_ids": _collect_piece_refs(ops)}
    if body.piece_id is not None:
        refs["piece_ids"] = sorted(set(refs.get("piece_ids", [])) | {body.piece_id})
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
        body.piece_id,
    )
    return MessageResponse(
        reply=reply,
        proposal_id=proposal_id,
        revision=ws["revision"],
        proposal=_message_proposal(conn, proposal_id),
    )


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
    except StaleProposalError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "reason": "proposal_stale",
                "current_revision": exc.current_revision,
            },
        ) from None
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


@router.get("/{workspace_id}/grouped-view", response_model=GroupedViewResponse)
def grouped_view(
    workspace_id: str, query: GroupedViewQuery = Depends(), conn=Depends(get_conn)
) -> GroupedViewResponse:
    ws = get_workspace(conn, workspace_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作区不存在")
    if ws["revision"] != query.revision:
        raise HTTPException(
            status_code=409,
            detail={"message": "版本已变，请刷新后再预览", "current_revision": ws["revision"]},
        )
    try:
        view = build_grouped_view(ws["snapshot"], query.perspective_id)
    except GroupedViewError as exc:
        raise HTTPException(
            status_code=422,
            detail={"message": str(exc), "recovery": exc.recovery},
        ) from None
    return GroupedViewResponse(revision=query.revision, view=view)


@router.get("/{workspace_id}/visualization", response_model=VisualizationResponse)
def visualization(
    workspace_id: str, query: VisualizationQuery = Depends(), conn=Depends(get_conn)
) -> VisualizationResponse:
    ws = get_workspace(conn, workspace_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="工作区不存在")
    if ws["revision"] != query.revision:
        raise HTTPException(
            status_code=409,
            detail={"message": "版本已变，请刷新后再预览", "current_revision": ws["revision"]},
        )
    try:
        view = build_visualization_view(ws["snapshot"], query.perspective_id)
    except VisualizationViewError as exc:
        raise HTTPException(
            status_code=422,
            detail={"message": str(exc), "recovery": exc.recovery},
        ) from None
    return VisualizationResponse(revision=query.revision, view=view)


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
