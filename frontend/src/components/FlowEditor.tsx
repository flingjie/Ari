import { useEffect, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { newId, type Flow, type FlowBranch, type FlowFeedback, type FlowStep } from "../lib/types";

export function FlowEditor({
  perspectiveId,
  flow,
  onSaved,
}: {
  perspectiveId: string;
  flow: Flow | null;
  onSaved: (ok: boolean) => void;
}) {
  const { snapshot, mutate } = useWorkspace();
  const pillars = (snapshot?.pillars ?? []).filter((p) => p.perspective_id === perspectiveId);

  const [steps, setSteps] = useState<FlowStep[]>(flow?.steps ?? []);
  const [branches, setBranches] = useState<FlowBranch[]>(flow?.branches ?? []);
  const [feedback, setFeedback] = useState<FlowFeedback[]>(flow?.feedback ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSteps(flow?.steps ?? []);
    setBranches(flow?.branches ?? []);
    setFeedback(flow?.feedback ?? []);
  }, [flow]);

  function addStep() {
    const text = window.prompt("步骤名称");
    if (!text || !text.trim()) return;
    setSteps((s) => [...s, { id: newId(), text: text.trim(), pillar_id: null }]);
  }

  function updateStep(id: string, patch: Partial<FlowStep>) {
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function moveStep(index: number, dir: -1 | 1) {
    setSteps((s) => {
      const next = [...s];
      const j = index + dir;
      if (j < 0 || j >= next.length) return s;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function removeStep(id: string) {
    setSteps((s) => s.filter((x) => x.id !== id));
    setBranches((b) => b.filter((x) => x.from_step_id !== id && x.to_step_id !== id));
    setFeedback((f) => f.filter((x) => x.from_step_id !== id && x.to_step_id !== id));
  }

  function addBranch() {
    setBranches((b) => [...b, { id: newId(), from_step_id: "", to_step_id: "", condition: "" }]);
  }

  function updateBranch(id: string, patch: Partial<FlowBranch>) {
    setBranches((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function addFeedback() {
    setFeedback((f) => [...f, { id: newId(), from_step_id: "", to_step_id: "", meaning: "" }]);
  }

  function updateFeedback(id: string, patch: Partial<FlowFeedback>) {
    setFeedback((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function save() {
    if (steps.length < 2) {
      setError("流程至少需要两个步骤");
      return;
    }
    const structure: Flow = {
      type: "flow",
      perspective_id: perspectiveId,
      steps,
      branches: branches.filter((b) => b.from_step_id && b.to_step_id),
      feedback: feedback.filter((f) => f.from_step_id && f.to_step_id),
    };
    setSaving(true);
    setError("");
    void mutate([{ type: "set_flow", structure }]).then((ok) => {
      setSaving(false);
      if (!ok) setError("保存失败，请检查流程结构");
      onSaved(ok);
    });
  }

  const stepOptions = steps.map((s) => ({ id: s.id, label: s.text || s.id }));

  return (
    <div className="editor">
      <h4>步骤（顺序即流程顺序）</h4>
      {steps.map((s, i) => (
        <div key={s.id} className="editor-row">
          <span className="editor-row__order">{i + 1}</span>
          <input
            value={s.text}
            placeholder="步骤名称"
            onChange={(e) => updateStep(s.id, { text: e.target.value })}
          />
          <select
            value={s.pillar_id ?? ""}
            onChange={(e) => updateStep(s.id, { pillar_id: e.target.value || null })}
          >
            <option value="">（无支柱）</option>
            {pillars.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0}>
            ↑
          </button>
          <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>
            ↓
          </button>
          <button type="button" onClick={() => removeStep(s.id)}>
            删
          </button>
        </div>
      ))}
      <button type="button" onClick={addStep}>
        ＋ 步骤
      </button>

      <h4>分支（从一步到另一步，多出边需填条件）</h4>
      {branches.map((b) => (
        <div key={b.id} className="editor-row">
          <select
            value={b.from_step_id}
            onChange={(e) => updateBranch(b.id, { from_step_id: e.target.value })}
          >
            <option value="">起点…</option>
            {stepOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={b.to_step_id}
            onChange={(e) => updateBranch(b.id, { to_step_id: e.target.value })}
          >
            <option value="">终点…</option>
            {stepOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            value={b.condition}
            placeholder="条件"
            onChange={(e) => updateBranch(b.id, { condition: e.target.value })}
          />
          <button
            type="button"
            onClick={() => setBranches((x) => x.filter((y) => y.id !== b.id))}
          >
            删
          </button>
        </div>
      ))}
      <button type="button" onClick={addBranch}>
        ＋ 分支
      </button>

      <h4>反馈（回到上游步骤）</h4>
      {feedback.map((f) => (
        <div key={f.id} className="editor-row">
          <select
            value={f.from_step_id}
            onChange={(e) => updateFeedback(f.id, { from_step_id: e.target.value })}
          >
            <option value="">起点…</option>
            {stepOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={f.to_step_id}
            onChange={(e) => updateFeedback(f.id, { to_step_id: e.target.value })}
          >
            <option value="">回到…</option>
            {stepOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            value={f.meaning}
            placeholder="含义"
            onChange={(e) => updateFeedback(f.id, { meaning: e.target.value })}
          />
          <button
            type="button"
            onClick={() => setFeedback((x) => x.filter((y) => y.id !== f.id))}
          >
            删
          </button>
        </div>
      ))}
      <button type="button" onClick={addFeedback}>
        ＋ 反馈
      </button>

      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存流程"}
        </button>
        {error ? <span className="editor-error">{error}</span> : null}
      </div>
    </div>
  );
}
