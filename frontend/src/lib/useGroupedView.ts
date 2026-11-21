import { useCallback } from "react";
import { api } from "../api/client";
import type { GroupedView } from "./types";
import { useRevisionResource, type ResourceState } from "./useRevisionResource";

export type GroupedViewState = ResourceState<GroupedView>;

/**
 * 按需读取某个视角的分组结果。以 [workspaceId, perspectiveId, revision, enabled]
 * 为 key 拉取；同 key 命中模块缓存则跳过网络。
 */
export function useGroupedView(
  workspaceId: string | null,
  perspectiveId: string | null,
  revision: number,
  enabled = true,
): GroupedViewState {
  const fetcher = useCallback(
    (id: string, rev: number, pid: string) => api.groupedView(id, rev, pid),
    [],
  );
  return useRevisionResource(
    "grouped",
    workspaceId,
    perspectiveId,
    revision,
    enabled,
    fetcher,
    "加载分组失败，请重试",
  );
}
