import { useWorkspace } from "../store/workspace";
import { newId } from "../lib/types";
import { StageAssistant } from "../components/StageAssistant";

export default function PerspectivePage() {
  const { snapshot, mutate } = useWorkspace();
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

  return (
    <div>
      {snapshot.perspectives.map((p) => (
        <button
          key={p.id}
          className="choice"
          aria-pressed={p.id === active ? "true" : "false"}
          onClick={() => select(p.id)}
        >
          {p.name}
          {p.reason ? <span>{p.reason}</span> : null}
        </button>
      ))}
      <button onClick={addPerspective}>＋ 自定义视角</button>
      <StageAssistant stage="perspective" />
    </div>
  );
}
