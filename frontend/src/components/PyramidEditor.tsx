import { useMemo, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useStructureEditor } from "../lib/useStructureEditor";
import { DraftRemoteBanner } from "../lib/useDraft";
import { newId, type Pyramid, type PyramidPoint } from "../lib/types";
import { EditorActions } from "./EditorActions";
import { MaterialPicker } from "./MaterialPicker";

type PyramidDraft = {
  conclusion: string;
  points: PyramidPoint[];
};

export function PyramidEditor({
  perspectiveId,
  pyramid,
  onSaved,
}: {
  perspectiveId: string;
  pyramid: Pyramid | null;
  onSaved: (ok: boolean) => void;
}) {
  const { snapshot } = useWorkspace();
  const pillars = (snapshot?.pillars ?? []).filter((p) => p.perspective_id === perspectiveId);
  const pieces = (snapshot?.pieces ?? [])
    .filter((p) => p.id !== snapshot?.root_id)
    .map((p) => ({ id: p.id, text: p.text }));

  const remote = useMemo<PyramidDraft>(
    () => ({
      conclusion: pyramid?.conclusion ?? "",
      points: pyramid?.points ?? [],
    }),
    [pyramid],
  );
  const { draft, saving, error, save } = useStructureEditor(remote, onSaved);
  const { conclusion, points } = draft.value;
  const [focusPointId, setFocusPointId] = useState<string | null>(null);

  function setPoints(updater: PyramidPoint[] | ((prev: PyramidPoint[]) => PyramidPoint[])) {
    draft.setValue((d) => ({
      ...d,
      points: typeof updater === "function" ? updater(d.points) : updater,
    }));
  }

  function addPoint() {
    const id = newId();
    setPoints((p) => [...p, { id, text: "", pillar_id: null, evidence: [] }]);
    setFocusPointId(id);
  }

  function updatePoint(id: string, patch: Partial<PyramidPoint>) {
    setPoints((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  return (
    <div className="editor">
      <DraftRemoteBanner
        show={draft.dirty && draft.remoteChanged}
        onAccept={draft.acceptRemote}
      />
      <div className="editor-row">
        <input
          value={conclusion}
          placeholder="核心结论"
          onChange={(e) => draft.setValue((d) => ({ ...d, conclusion: e.target.value }))}
        />
      </div>

      <h4>要点（可引用支柱，关联证据）</h4>
      {points.map((pt) => (
        <div key={pt.id} className="editor-block">
          <div className="editor-row">
            <input
              value={pt.text}
              placeholder="要点"
              autoFocus={focusPointId === pt.id}
              onChange={(e) => updatePoint(pt.id, { text: e.target.value })}
              onBlur={() => {
                if (focusPointId === pt.id) setFocusPointId(null);
              }}
            />
            <select
              value={pt.pillar_id ?? ""}
              onChange={(e) => updatePoint(pt.id, { pillar_id: e.target.value || null })}
            >
              <option value="">（无支柱）</option>
              {pillars.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setPoints((p) => p.filter((x) => x.id !== pt.id))}>
              删
            </button>
          </div>
          <MaterialPicker
            pieces={pieces}
            selected={pt.evidence}
            onChange={(ids) => updatePoint(pt.id, { evidence: ids })}
          />
        </div>
      ))}
      <button type="button" onClick={addPoint}>
        ＋ 要点
      </button>

      <EditorActions
        saving={saving}
        saveLabel="保存金字塔"
        error={error}
        onSave={() =>
          save((value) => ({
            type: "set_pyramid",
            structure: {
              type: "pyramid",
              perspective_id: perspectiveId,
              conclusion: value.conclusion,
              points: value.points,
            },
          }))
        }
      />
    </div>
  );
}
