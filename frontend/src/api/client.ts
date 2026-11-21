// API 客户端：fetch 封装，统一解析错误（含 409 的 current_revision）。

import type {
  GroupedView,
  Operation,
  RecommendChartResult,
  Snapshot,
  Stage,
  VisualizationView,
} from "../lib/types";

const BASE = "/api/workspaces";

export interface WorkspacePayload {
  id: string;
  revision: number;
  snapshot: Snapshot;
  proposals?: ProposalSummary[];
}

export interface ProposalSummary {
  id: string;
  stage: Stage;
  base_revision: number;
  refs: Record<string, unknown>;
  change_set: Operation[];
  status: string;
  created_at: string;
}

export interface PatchResult {
  revision: number;
  snapshot: Snapshot;
}

export interface ExportResult {
  revision: number;
  format: string;
  content: string;
}

export interface GroupedViewResult {
  revision: number;
  view: GroupedView;
}

export interface VisualizationResult {
  revision: number;
  view: VisualizationView;
}

export interface MessageResult {
  reply: string;
  proposal_id: string | null;
  revision: number;
  proposal?: ProposalSummary | null;
}

export interface MessageSummary {
  id: string;
  stage: Stage;
  question: string;
  reply: string | null;
  proposal_id: string | null;
  piece_id: string | null;
  base_revision: number;
  created_at: string;
  proposal: ProposalSummary | null;
}

export interface MessagePageResult {
  messages: MessageSummary[];
  next_before: string | null;
}

export interface ResolveResult {
  revision: number;
  snapshot: Snapshot;
  status: string;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : `请求失败 (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body;
    } catch {
      // 非 JSON 错误体，保留 statusText。
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const api = {
  create(template?: string): Promise<WorkspacePayload> {
    return request<WorkspacePayload>("/", {
      method: "POST",
      body: JSON.stringify({ template: template ?? null }),
    });
  },

  get(id: string): Promise<WorkspacePayload> {
    return request<WorkspacePayload>(`/${id}`);
  },

  patch(
    id: string,
    requestId: string,
    baseRevision: number,
    operations: Operation[],
  ): Promise<PatchResult> {
    return request<PatchResult>(`/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        request_id: requestId,
        base_revision: baseRevision,
        operations,
      }),
    });
  },

  undo(id: string, requestId: string, baseRevision: number): Promise<PatchResult> {
    return request<PatchResult>(`/${id}/undo`, {
      method: "POST",
      body: JSON.stringify({
        request_id: requestId,
        base_revision: baseRevision,
      }),
    });
  },

  export(
    id: string,
    revision: number,
    perspectiveId: string,
    format: "outline" | "table",
  ): Promise<ExportResult> {
    const params = new URLSearchParams({
      revision: String(revision),
      perspective_id: perspectiveId,
      format,
    });
    return request<ExportResult>(`/${id}/export?${params.toString()}`);
  },

  groupedView(
    id: string,
    revision: number,
    perspectiveId: string,
  ): Promise<GroupedViewResult> {
    const params = new URLSearchParams({
      revision: String(revision),
      perspective_id: perspectiveId,
    });
    return request<GroupedViewResult>(`/${id}/grouped-view?${params.toString()}`);
  },

  visualization(
    id: string,
    revision: number,
    perspectiveId: string,
  ): Promise<VisualizationResult> {
    const params = new URLSearchParams({
      revision: String(revision),
      perspective_id: perspectiveId,
    });
    return request<VisualizationResult>(`/${id}/visualization?${params.toString()}`);
  },

  recommendChart(
    id: string,
    baseRevision: number,
    perspectiveId: string,
  ): Promise<RecommendChartResult> {
    return request<RecommendChartResult>(`/${id}/recommend-chart`, {
      method: "POST",
      body: JSON.stringify({
        base_revision: baseRevision,
        perspective_id: perspectiveId,
      }),
    });
  },

  sendMessage(
    id: string,
    requestId: string,
    stage: Stage,
    question: string,
    baseRevision: number,
    pieceId?: string,
  ): Promise<MessageResult> {
    return request<MessageResult>(`/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        request_id: requestId,
        stage,
        question,
        base_revision: baseRevision,
        piece_id: pieceId ?? null,
      }),
    });
  },

  listMessages(
    id: string,
    limit = 30,
    before?: string,
  ): Promise<MessagePageResult> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set("before", before);
    return request<MessagePageResult>(`/${id}/messages?${params.toString()}`);
  },

  resolveProposal(
    id: string,
    proposalId: string,
    requestId: string,
    baseRevision: number,
    action: "accept" | "edit" | "ignore",
    operations?: Operation[],
  ): Promise<ResolveResult> {
    return request<ResolveResult>(`/${id}/proposals/${proposalId}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        request_id: requestId,
        base_revision: baseRevision,
        action,
        operations: operations ?? null,
      }),
    });
  },
};
