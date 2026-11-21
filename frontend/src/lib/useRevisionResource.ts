// 按 workspace + perspective + revision 拉取只读资源，带模块级缓存，减少重复请求。

import { useEffect, useState } from "react";
import { ApiError } from "../api/client";

export type ResourceStatus = "idle" | "loading" | "ready" | "error";

export interface ResourceState<T> {
  view: T | null;
  status: ResourceStatus;
  error: string | null;
}

type CacheEntry<T> = { view: T; revision: number };

const caches = new Map<string, Map<string, CacheEntry<unknown>>>();

function cacheBucket(kind: string): Map<string, CacheEntry<unknown>> {
  let bucket = caches.get(kind);
  if (!bucket) {
    bucket = new Map();
    caches.set(kind, bucket);
  }
  return bucket;
}

function cacheKey(workspaceId: string, perspectiveId: string): string {
  return `${workspaceId}:${perspectiveId}`;
}

export function useRevisionResource<T>(
  kind: string,
  workspaceId: string | null,
  perspectiveId: string | null,
  revision: number,
  enabled: boolean,
  fetcher: (workspaceId: string, revision: number, perspectiveId: string) => Promise<{ view: T }>,
  errorFallback: string,
): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({
    view: null,
    status: "idle",
    error: null,
  });

  useEffect(() => {
    if (!enabled || !workspaceId || !perspectiveId) {
      setState({ view: null, status: "idle", error: null });
      return;
    }

    const bucket = cacheBucket(kind);
    const key = cacheKey(workspaceId, perspectiveId);
    const hit = bucket.get(key) as CacheEntry<T> | undefined;
    if (hit && hit.revision === revision) {
      setState({ view: hit.view, status: "ready", error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({
      ...prev,
      // 命中同视角旧 revision 时先展示旧数据，避免闪空白。
      view: hit?.view ?? prev.view,
      status: "loading",
      error: null,
    }));

    fetcher(workspaceId, revision, perspectiveId)
      .then((res) => {
        if (cancelled) return;
        bucket.set(key, { view: res.view, revision });
        setState({ view: res.view, status: "ready", error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        const message =
          e instanceof ApiError && e.status === 409
            ? "内容已更新，请重新加载"
            : e instanceof ApiError && e.status === 422
              ? "视角不存在，请回到视角阶段重新选择"
              : errorFallback;
        setState({ view: null, status: "error", error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [kind, workspaceId, perspectiveId, revision, enabled, fetcher, errorFallback]);

  return state;
}
