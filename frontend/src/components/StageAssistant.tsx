import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useWorkspace } from "../store/workspace";
import type { Stage } from "../lib/types";

// 阶段助手：请阿理给建议 → 展示回复 + 接受/忽略。
export function StageAssistant({ stage }: { stage: Stage }) {
  const { workspaceId, revision, load } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!workspaceId) return null;

  async function ask() {
    const question = window.prompt("告诉阿理你的问题或上下文", "") ?? "";
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.sendMessage(
        workspaceId!,
        crypto.randomUUID(),
        stage,
        question.trim(),
        revision,
      );
      setReply(res.reply);
      setProposalId(res.proposal_id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "调用失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(action: "accept" | "ignore") {
    if (!proposalId) return;
    setBusy(true);
    try {
      await api.resolveProposal(
        workspaceId!,
        proposalId,
        crypto.randomUUID(),
        revision,
        action,
      );
      await load(workspaceId!);
      setReply(null);
      setProposalId(null);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "处理失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card proposal-card">
      <div className="actions">
        <button onClick={() => void ask()} disabled={busy}>
          请阿理建议
        </button>
      </div>
      {error ? <p className="sync-status error">{error}</p> : null}
      {reply !== null ? (
        <div>
          <p>{reply}</p>
          {proposalId ? (
            <div className="actions">
              <button
                className="primary"
                onClick={() => void resolve("accept")}
                disabled={busy}
              >
                接受
              </button>
              <button onClick={() => void resolve("ignore")} disabled={busy}>
                忽略
              </button>
            </div>
          ) : (
            <p>
              <small>（无结构建议，仅提示）</small>
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
