import { useWorkspace } from "../store/workspace";
import { useChat } from "../store/chat";
import { newId } from "../lib/types";
import { PerspectiveCard } from "../components/PerspectiveCard";

export default function PerspectivePage() {
  const { snapshot, mutate, workspaceId, revision } = useWorkspace();
  const chat = useChat();
  if (!snapshot) return null;

  const active = snapshot.active_perspective_id;

  function select(id: string) {
    void mutate([{ type: "set_active_perspective", id }]);
  }

  function addPerspective() {
    const name = window.prompt("视角名称");
    if (!name || !name.trim()) return;
    const reason = window.prompt("这个角度能回答什么？") || "";
    void mutate([
      { type: "add_perspective", id: newId(), name: name.trim(), reason: reason.trim() },
    ]);
  }

  function suggestWithAI() {
    chat.setPanelOpen(true);
    chat.setDraft("请从两个有实质区别的角度帮我看看这些材料");
  }

  if (snapshot.perspectives.length === 0) {
    return (
      <div className="card perspective-empty">
        <p>还没有视角。从一个能区分材料的角度开始。</p>
        <p>
          <button onClick={addPerspective}>＋ 自定义视角</button>
        </p>
        <p>
          <button onClick={suggestWithAI}>让 AI 建议视角</button>
        </p>
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
      <button className="perspective-grid__add" onClick={addPerspective}>
        ＋ 自定义视角
      </button>
    </div>
  );
}
