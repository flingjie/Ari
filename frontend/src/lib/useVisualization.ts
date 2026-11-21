import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { VisualizationView } from "./types";

export interface VisualizationState {
  view: VisualizationView | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

/**
 * 按需读取某视角的可视化状态与关系结构。镜像 useGroupedView：
 * cancelled 清理守卫过期响应，key = [workspaceId, perspectiveId, revision, enabled]。
 */
export function useVisualization(
  workspaceId: string | null,
  perspectiveId: string | null,
  revision: number,
  enabled = true,
): VisualizationState {
  const [state, setState] = useState<VisualizationState>({
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
      .visualization(workspaceId, revision, perspectiveId)
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
              : "加载图形失败，请重试";
        setState({ view: null, status: "error", error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, perspectiveId, revision, enabled]);

  return state;
}
