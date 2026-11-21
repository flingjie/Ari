import { useCallback } from "react";
import { api } from "../api/client";
import type { VisualizationView } from "./types";
import { useRevisionResource, type ResourceState } from "./useRevisionResource";

export type VisualizationState = ResourceState<VisualizationView>;

/**
 * 按需读取某视角的可视化状态与关系结构（与 useGroupedView 共用缓存层）。
 */
export function useVisualization(
  workspaceId: string | null,
  perspectiveId: string | null,
  revision: number,
  enabled = true,
): VisualizationState {
  const fetcher = useCallback(
    (id: string, rev: number, pid: string) => api.visualization(id, rev, pid),
    [],
  );
  return useRevisionResource(
    "visualization",
    workspaceId,
    perspectiveId,
    revision,
    enabled,
    fetcher,
    "加载图形失败，请重试",
  );
}
