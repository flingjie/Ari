import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

export function LandingPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(template?: string) {
    setBusy(true);
    setError("");
    try {
      const ws = await api.create(template);
      navigate(`/w/${ws.id}/purpose`);
    } catch {
      setBusy(false);
      setError("创建工作区失败，请确认后端已启动");
    }
  }

  return (
    <div className="app">
      <header>
        <b>阿理 / Ari</b>
        <small>五阶段思考手记</small>
      </header>
      <h1>阿理 · 5P 思考手记</h1>
      <p>在五个独立页面完成一次真实思考任务：目的 → 片段 → 视角 → 支柱 → 表达。</p>
      <div className="card">
        <p>选择一种方式开始：</p>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => void start()}>
            新建空白工作区
          </button>
          <button disabled={busy} onClick={() => void start("tutorial")}>
            使用教程示例
          </button>
        </div>
        {error ? <p className="editor-error">{error}</p> : null}
      </div>
    </div>
  );
}
