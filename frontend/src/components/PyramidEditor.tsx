import { useEffect, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { newId, type Pyramid, type PyramidPoint } from "../lib/types";
import { MaterialPicker } from "./MaterialPicker";

export function PyramidEditor({
  perspectiveId,
  pyramid,
  onSaved,
}: {
  perspectiveId: string;
  pyramid: Pyramid | null;
  onSaved: (ok: boolean) => void;
}) {
  const { snapshot, mutate } = useWorkspace();
  const pillars = (snapshot?.pillars ?? []).filter((p) => p.perspective_id === perspectiveId);
  const pieces = (snapshot?.pieces ?? [])
    .filter((p) => p.id !== snapshot?.root_id)
    .map((p) => ({ id: p.id, text: p.text }));

  const [conclusion, setConclusion] = useState(pyramid?.conclusion ?? "");
  const [points, setPoints] = useState<PyramidPoint[]>(pyramid?.points ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setConclusion(pyramid?.conclusion ?? "");
    setPoints(pyramid?.points ?? []);
  }, [pyramid]);

  function addPoint() {
    const text = window.prompt("要点名称");
    if (!text || !text.trim()) return;
    setPoints((p) => [...p, { id: newId(), text: text.trim(), pillar_id: null, evidence: [] }]);
  }

  function updatePoint(id: string, patch: Partial<PyramidPoint>) {
    setPoints((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function save() {
    const structure: Pyramid = {
      type: "pyramid",
      perspective_id: perspectiveId,
      conclusion,
      points,
    };
    setSaving(true);
    void mutate([{ type: "set_pyramid", structure }]).then((ok) => {
      setSaving(false);
      onSaved(ok);
    });
  }

  return (
    <div className="editor">
      <div className="editor-row">
        <input
          value={conclusion}
          placeholder="核心结论"
          onChange={(e) => setConclusion(e.target.value)}
        />
      </div>

      <h4>要点（可引用支柱，关联证据）</h4>
      {points.map((pt) => (
        <div key={pt.id} className="editor-block">
          <div className="editor-row">
            <input
              value={pt.text}
              placeholder="要点"
              onChange={(e) => updatePoint(pt.id, { text: e.target.value })}
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

      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存金字塔"}
        </button>
      </div>
    </div>
  );
}
