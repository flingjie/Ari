"""API 请求/响应模型。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..domain.operations import Operation
from ..domain.grouping import GroupedView
from ..domain.visualizations import VisualizationView
from ..models import WorkspaceSnapshot

Stage = Literal["purpose", "piece", "perspective", "pillar", "presentation"]


class CreateRequest(BaseModel):
    """新建工作区；``template`` 为空则空白，``tutorial`` 为教程案例。"""

    template: str | None = None


class ProposalSummary(BaseModel):
    id: str
    stage: Stage
    base_revision: int
    refs: dict
    change_set: list[Operation]
    status: str
    created_at: str


class WorkspaceResponse(BaseModel):
    id: str
    revision: int
    snapshot: WorkspaceSnapshot
    proposals: list[ProposalSummary] = Field(default_factory=list)


class PatchRequest(BaseModel):
    request_id: str
    base_revision: int
    operations: list[Operation]


class PatchResponse(BaseModel):
    revision: int
    snapshot: WorkspaceSnapshot


class MessageRequest(BaseModel):
    request_id: str
    stage: Stage
    question: str
    base_revision: int
    piece_id: str | None = None


class MessageResponse(BaseModel):
    reply: str
    proposal_id: str | None
    revision: int
    proposal: ProposalSummary | None = None


class MessageSummary(BaseModel):
    id: str
    stage: Stage
    question: str
    reply: str | None
    proposal_id: str | None
    piece_id: str | None
    base_revision: int
    created_at: str
    proposal: ProposalSummary | None = None


class MessagePageResponse(BaseModel):
    messages: list[MessageSummary]
    next_before: str | None = None


class ResolveRequest(BaseModel):
    request_id: str
    base_revision: int
    action: Literal["accept", "edit", "ignore"]
    operations: list[Operation] | None = None


class ResolveResponse(BaseModel):
    revision: int
    snapshot: WorkspaceSnapshot
    status: str


class ExportQuery(BaseModel):
    revision: int
    perspective_id: str
    format: Literal["outline", "table"]


class ExportResponse(BaseModel):
    revision: int
    format: str
    content: str


class GroupedViewQuery(BaseModel):
    revision: int
    perspective_id: str


class GroupedViewResponse(BaseModel):
    revision: int
    view: GroupedView


class VisualizationQuery(BaseModel):
    revision: int
    perspective_id: str


class VisualizationResponse(BaseModel):
    revision: int
    view: VisualizationView
