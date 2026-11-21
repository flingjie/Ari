// 右侧对话栏：消息列表、输入框、提案卡（采纳/忽略/重新生成）。

import { useEffect, useRef, type KeyboardEvent } from "react";
import { STAGE_NAMES, type Snapshot, type Stage } from "../lib/types";
import { describeChangeSet } from "../lib/describe";
import { useChat } from "../store/chat";
import { useWorkspace } from "../store/workspace";

function pieceLabel(snapshot: Snapshot, id: string): string {
  const p = snapshot.pieces.find((x) => x.id === id);
  return p ? p.text : id;
}

export function ChatPanel({ stage }: { stage: Stage }) {
  const {
    messages,
    sending,
    draft,
    setDraft,
    error,
    selectedPieceId,
    setSelectedPieceId,
    panelOpen,
    setPanelOpen,
    send,
    retry,
    resolve,
    regenerate,
  } = useChat();
  const { snapshot } = useWorkspace();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <aside className="chat-panel" data-open={panelOpen ? "true" : "false"}>
      <header className="chat-panel-header">
        <span>
          对话 · <b>{STAGE_NAMES[stage]}</b>
        </span>
        <button
          type="button"
          className="chat-panel-close"
          aria-label="关闭对话栏"
          onClick={() => setPanelOpen(false)}
        >
          返回
        </button>
      </header>

      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && !sending ? (
          <p className="chat-empty">在当前阶段向阿理提问，或附上一个片段。</p>
        ) : null}

        {messages.map((m) => (
          <div key={m.id} className="chat-turn">
            <div className="bubble bubble-user">
              {m.pieceId && snapshot ? (
                <span className="bubble-ref">
                  引用「{pieceLabel(snapshot, m.pieceId)}」
                </span>
              ) : null}
              {m.question}
            </div>

            {m.error ? (
              <div className="bubble bubble-error">
                {m.error}
                <button
                  type="button"
                  onClick={() => void retry(m.id)}
                  disabled={sending}
                >
                  重试
                </button>
              </div>
            ) : m.reply === null ? (
              <div className="bubble bubble-assistant">思考中…</div>
            ) : (
              <>
                <div className="bubble bubble-assistant">{m.reply}</div>
                {m.proposal ? (
                  <div className="proposal-card">
                    {m.proposalStatus === "pending" ? (
                      <>
                        <ul>
                          {snapshot
                            ? describeChangeSet(m.proposal.change_set, snapshot).map(
                                (line, i) => <li key={i}>{line}</li>,
                              )
                            : null}
                        </ul>
                        <div className="actions">
                          <button
                            type="button"
                            className="primary"
                            onClick={() => void resolve(m.proposalId!, "accept")}
                            disabled={sending}
                          >
                            采纳
                          </button>
                          <button
                            type="button"
                            onClick={() => void resolve(m.proposalId!, "ignore")}
                            disabled={sending}
                          >
                            忽略
                          </button>
                        </div>
                      </>
                    ) : m.proposalStatus === "accept" ? (
                      <p className="proposal-result">已采纳</p>
                    ) : m.proposalStatus === "ignore" ? (
                      <p className="proposal-result">已忽略</p>
                    ) : m.proposalStatus === "stale" ? (
                      <div className="proposal-stale">
                        <p>该提案基于旧内容生成。</p>
                        <button
                          type="button"
                          onClick={() => void regenerate(m.id)}
                          disabled={sending}
                        >
                          基于最新内容重新生成
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ))}

        {error ? <p className="sync-status error">{error}</p> : null}
      </div>

      <footer className="chat-composer">
        {selectedPieceId && snapshot ? (
          <div className="piece-ref">
            引用「{pieceLabel(snapshot, selectedPieceId)}」
            <button
              type="button"
              aria-label="移除引用"
              onClick={() => setSelectedPieceId(null)}
            >
              ×
            </button>
          </div>
        ) : null}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="向阿理提问（Enter 发送，Shift+Enter 换行）"
          disabled={sending}
        />
        <button
          type="button"
          className="primary"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
        >
          {sending ? "思考中…" : "发送"}
        </button>
      </footer>
    </aside>
  );
}
