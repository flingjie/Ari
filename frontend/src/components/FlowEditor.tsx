import { useMemo, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useStructureEditor } from "../lib/useStructureEditor";
import { DraftRemoteBanner } from "../lib/useDraft";
import { newId, type Flow, type FlowBranch, type FlowFeedback, type FlowStep } from "../lib/types";
import { EditorActions } from "./EditorActions";

type FlowDraft = {
  steps: FlowStep[];
  branches: FlowBranch[];
  feedback: FlowFeedback[];
};

export function FlowEditor({
  perspectiveId,
  flow,
  onSaved,
}: {
  perspectiveId: string;
  flow: Flow | null;
  onSaved: (ok: boolean) => void;
}) {
  const { snapshot } = useWorkspace();
  const pillars = (snapshot?.pillars ?? []).filter((p) => p.perspective_id === perspectiveId);

  const remote = useMemo<FlowDraft>(
    () => ({
      steps: flow?.steps ?? [],
      branches: flow?.branches ?? [],
      feedback: flow?.feedback ?? [],
    }),
    [flow],
  );
  const { draft, saving, error, save } = useStructureEditor(remote, onSaved);
  const { steps, branches, feedback } = draft.value;
  const [focusStepId, setFocusStepId] = useState<string | null>(null);

  function setSteps(updater: FlowStep[] | ((prev: FlowStep[]) => FlowStep[])) {
    draft.setValue((d) => ({
      ...d,
      steps: typeof updater === "function" ? updater(d.steps) : updater,
    }));
  }
  function setBranches(updater: FlowBranch[] | ((prev: FlowBranch[]) => FlowBranch[])) {
    draft.setValue((d) => ({
      ...d,
      branches: typeof updater === "function" ? updater(d.branches) : updater,
    }));
  }
  function setFeedback(updater: FlowFeedback[] | ((prev: FlowFeedback[]) => FlowFeedback[])) {
    draft.setValue((d) => ({
      ...d,
      feedback: typeof updater === "function" ? updater(d.feedback) : updater,
    }));
  }

  function addStep() {
    const id = newId();
    setSteps((s) => [...s, { id, text: "", pillar_id: null }]);
    setFocusStepId(id);
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

  const stepOptions = steps.map((s) => ({ id: s.id, label: s.text || s.id }));

  return (
    <div className="editor">
      <DraftRemoteBanner
        show={draft.dirty && draft.remoteChanged}
        onAccept={draft.acceptRemote}
      />
      <h4>步骤（顺序即流程顺序）</h4>
      {steps.map((s, i) => (
        <div key={s.id} className="editor-row">
          <span className="editor-row__order">{i + 1}</span>
          <input
            value={s.text}
            placeholder="步骤名称"
            autoFocus={focusStepId === s.id}
            onChange={(e) => updateStep(s.id, { text: e.target.value })}
            onBlur={() => {
              if (focusStepId === s.id) setFocusStepId(null);
            }}
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

      <EditorActions
        saving={saving}
        saveLabel="保存流程"
        error={error}
        onSave={() =>
          save(
            (value) => ({
              type: "set_flow",
              structure: {
                type: "flow",
                perspective_id: perspectiveId,
                steps: value.steps,
                branches: value.branches.filter((b) => b.from_step_id && b.to_step_id),
                feedback: value.feedback.filter((f) => f.from_step_id && f.to_step_id),
              },
            }),
            (value) => (value.steps.length < 2 ? "流程至少需要两个步骤" : null),
          )
        }
      />
    </div>
  );
}
