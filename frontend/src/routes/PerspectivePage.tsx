import { useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useChat } from "../store/chat";
import { newId } from "../lib/types";
import { PerspectiveCard } from "../components/PerspectiveCard";

export default function PerspectivePage() {
  const { snapshot, mutate, workspaceId, revision } = useWorkspace();
  const chat = useChat();
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftReason, setDraftReason] = useState("");

  if (!snapshot) return null;

  const active = snapshot.active_perspective_id;

  function select(id: string) {
    void mutate([{ type: "set_active_perspective", id }]);
  }

  function openDraft() {
    setDraftOpen(true);
    setDraftName("");
    setDraftReason("");
  }

  function cancelDraft() {
    setDraftOpen(false);
    setDraftName("");
    setDraftReason("");
  }

  function submitDraft() {
    const name = draftName.trim();
    if (!name) return;
    void mutate([
      { type: "add_perspective", id: newId(), name, reason: draftReason.trim() },
    ]);
    cancelDraft();
  }

  function suggestWithAI() {
    chat.setPanelOpen(true);
    chat.setDraft("请从两个有实质区别的角度帮我看看这些材料");
  }

  const draftForm = (
    <div className="perspective-draft">
      <div className="editor-row">
        <input
          value={draftName}
          placeholder="视角名称"
          autoFocus
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitDraft();
          }}
        />
      </div>
      <div className="editor-row">
        <input
          value={draftReason}
          placeholder="这个角度能回答什么？"
          onChange={(e) => setDraftReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitDraft();
          }}
        />
      </div>
      <div className="editor-actions">
        <button className="primary" type="button" onClick={submitDraft} disabled={!draftName.trim()}>
          添加
        </button>
        <button type="button" onClick={cancelDraft}>
          取消
        </button>
      </div>
    </div>
  );

  if (snapshot.perspectives.length === 0) {
    return (
      <div className="card perspective-empty">
        <p>还没有视角。从一个能区分材料的角度开始。</p>
        {draftOpen ? (
          draftForm
        ) : (
          <>
            <p>
              <button onClick={openDraft}>＋ 自定义视角</button>
            </p>
            <p>
              <button onClick={suggestWithAI}>让 AI 建议视角</button>
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="perspective-grid">
      {snapshot.perspectives.map((p) => (
        <PerspectiveCard
          key={p.id}
          perspective={p}
          active={p.id === active}
          workspaceId={workspaceId!}
          revision={revision}
          onSelect={select}
        />
      ))}
      {draftOpen ? (
        draftForm
      ) : (
        <button className="perspective-grid__add" onClick={openDraft}>
          ＋ 自定义视角
        </button>
      )}
    </div>
  );
}
