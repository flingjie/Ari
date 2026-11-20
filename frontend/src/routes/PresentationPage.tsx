import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useWorkspace } from "../store/workspace";
import { StageAssistant } from "../components/StageAssistant";

export default function PresentationPage() {
  const { snapshot, revision, workspaceId } = useWorkspace();
  const [format, setFormat] = useState<"outline" | "table">("outline");
  const [content, setContent] = useState("");
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const [error, setError] = useState("");

  const perspectiveId = snapshot?.active_perspective_id ?? null;

  useEffect(() => {
    if (!snapshot || !workspaceId || !perspectiveId) {
      setContent("");
      setError("");
      return;
    }
    let cancelled = false;
    api
      .export(workspaceId, revision, perspectiveId, format)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setPreviewRevision(res.revision);
        setError("");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError && e.status === 409
            ? "内容已更新，预览即将刷新"
            : "预览失败，请重试",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot, revision, format, workspaceId, perspectiveId]);

  function download() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ari-notes.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!snapshot) return null;

  if (!perspectiveId) {
    return (
      <div className="card">
        <p>还没有选择视角，无法预览。</p>
        <p>
          <Link to={`/w/${workspaceId}/perspective`}>去选视角</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="actions">
        <select
          aria-label="表达形式"
          value={format}
          onChange={(e) => setFormat(e.target.value as "outline" | "table")}
        >
          <option value="outline">提纲</option>
          <option value="table">Markdown 表格</option>
        </select>
        <small>
          预览版本 r{previewRevision ?? revision}
          {previewRevision !== null && previewRevision !== revision ? "（待刷新）" : ""}
        </small>
        <button className="primary" onClick={download} disabled={!content}>
          下载 Markdown
        </button>
      </div>
      {error ? <p className="sync-status error">{error}</p> : null}
      <pre className="card">{content}</pre>
      <StageAssistant stage="presentation" />
    </div>
  );
}
