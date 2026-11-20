"""API 请求/响应模型。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..domain.operations import Operation
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


class MessageResponse(BaseModel):
    reply: str
    proposal_id: str | None
    revision: int


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
