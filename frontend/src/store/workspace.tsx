// 共享工作区 store：单一快照 + revision，串行化提交队列，失败保留草稿可重试。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "../api/client";
import type { Operation, Snapshot } from "../lib/types";

export type LoadState = "idle" | "loading" | "ready" | "error";
export type SyncStatus = "idle" | "pending" | "conflict" | "error";

export interface SyncState {
  status: SyncStatus;
  message?: string;
  currentRevision?: number;
}

interface WorkspaceContextValue {
  workspaceId: string | null;
  loadState: LoadState;
  snapshot: Snapshot | null;
  revision: number;
  sync: SyncState;
  remoteRevision: number;
  load: (id: string) => Promise<void>;
  mutate: (ops: Operation[], requestId?: string) => Promise<boolean>;
  retry: () => Promise<boolean>;
  applyServerSnapshot: (revision: number, snapshot: Snapshot) => void;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace 必须在 WorkspaceProvider 内使用");
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [sync, setSync] = useState<SyncState>({ status: "idle" });
  const [remoteRevision, setRemoteRevision] = useState(0);

  // 队列执行时读取最新值，用 ref 避免闭包过期。
  const workspaceIdRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastReqRef = useRef<{ requestId: string; ops: Operation[] } | null>(null);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  const load = useCallback(async (id: string) => {
    // 切换工作区时清空旧提交队列。
    queueRef.current = Promise.resolve();
    lastReqRef.current = null;
    setLoadState("loading");
    try {
      const ws = await api.get(id);
      setWorkspaceId(ws.id);
      workspaceIdRef.current = ws.id;
      setSnapshot(ws.snapshot);
      setRevision(ws.revision);
      revisionRef.current = ws.revision;
      setSync({ status: "idle" });
      setLoadState("ready");
      setRemoteRevision((n) => n + 1);
    } catch {
      setLoadState("error");
    }
  }, []);

  const mutate = useCallback(
    (ops: Operation[], requestId?: string): Promise<boolean> => {
      const run = queueRef.current.then(async () => {
        const id = workspaceIdRef.current;
        if (!id) return false;
        const rid = requestId ?? crypto.randomUUID();
        lastReqRef.current = { requestId: rid, ops };
        setSync({ status: "pending" });
        try {
          const res = await api.patch(id, rid, revisionRef.current, ops);
          setSnapshot(res.snapshot);
          setRevision(res.revision);
          revisionRef.current = res.revision;
          lastReqRef.current = null;
          setSync({ status: "idle" });
          return true;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            const detail = e.detail as
              | { current_revision?: number; message?: string }
              | undefined;
            setSync({
              status: "conflict",
              message: detail?.message ?? "工作区已在别处更新",
              currentRevision: detail?.current_revision,
            });
          } else {
            setSync({ status: "error", message: "保存失败，已保留待同步" });
          }
          return false;
        }
      });
      // 吞掉错误，保持队列继续；返回原始 promise 给调用方判断成败。
      queueRef.current = run.then(
        () => {},
        () => {},
      );
      return run;
    },
    [],
  );

  const retry = useCallback((): Promise<boolean> => {
    const last = lastReqRef.current;
    if (!last) return Promise.resolve(false);
    return mutate(last.ops, last.requestId);
  }, [mutate]);

  const applyServerSnapshot = useCallback((rev: number, snap: Snapshot) => {
    setSnapshot(snap);
    setRevision(rev);
    revisionRef.current = rev;
    setSync({ status: "idle" });
    setRemoteRevision((n) => n + 1);
  }, []);

  return (
    <Ctx.Provider
      value={{
        workspaceId,
        loadState,
        snapshot,
        revision,
        sync,
        remoteRevision,
        load,
        mutate,
        retry,
        applyServerSnapshot,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
