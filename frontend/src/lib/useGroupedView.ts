import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { GroupedView } from "./types";

export interface GroupedViewState {
  view: GroupedView | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

/**
 * 按需读取某个视角的分组结果。以 [workspaceId, perspectiveId, revision, enabled]
 * 为 key 拉取，cancelled 清理守卫过期响应，避免慢请求覆盖新画面。
 */
export function useGroupedView(
  workspaceId: string | null,
  perspectiveId: string | null,
  revision: number,
  enabled = true,
): GroupedViewState {
  const [state, setState] = useState<GroupedViewState>({
    view: null,
    status: "idle",
    error: null,
  });

  useEffect(() => {
    if (!enabled || !workspaceId || !perspectiveId) {
      setState({ view: null, status: "idle", error: null });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    api
      .groupedView(workspaceId, revision, perspectiveId)
      .then((res) => {
        if (cancelled) return;
        setState({ view: res.view, status: "ready", error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        const message =
          e instanceof ApiError && e.status === 409
            ? "内容已更新，请重新加载"
            : e instanceof ApiError && e.status === 422
              ? "视角不存在，请回到视角阶段重新选择"
              : "加载分组失败，请重试";
        setState({ view: null, status: "error", error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, perspectiveId, revision, enabled]);

  return state;
}
