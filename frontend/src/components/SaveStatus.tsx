import { useWorkspace } from "../store/workspace";

export function SaveStatus() {
  const { sync, retry, load, workspaceId } = useWorkspace();

  if (sync.status === "pending") {
    return <span className="sync-status">保存中…</span>;
  }
  if (sync.status === "error") {
    return (
      <span className="sync-status error">
        待同步 <button onClick={() => void retry()}>重试</button>
      </span>
    );
  }
  if (sync.status === "conflict") {
    return (
      <span className="sync-status conflict">
        已在别处更新
        {workspaceId ? (
          <button onClick={() => void load(workspaceId)}>重新加载</button>
        ) : null}
      </span>
    );
  }
  return <span className="sync-status">已保存</span>;
}
