import { useEffect, useState } from "react";
import { useWorkspace } from "../store/workspace";
import {
  newId,
  type SetMember,
  type SetsStructure,
  type VennSet,
} from "../lib/types";

export function VennEditor({
  perspectiveId,
  sets,
  onSaved,
}: {
  perspectiveId: string;
  sets: SetsStructure | null;
  onSaved: (ok: boolean) => void;
}) {
  const { snapshot, mutate } = useWorkspace();
  const pieces = (snapshot?.pieces ?? []).filter((p) => p.id !== snapshot?.root_id);

  const [setA, setSetA] = useState<VennSet>(sets?.set_a ?? { id: newId(), name: "" });
  const [setB, setSetB] = useState<VennSet>(sets?.set_b ?? { id: newId(), name: "" });
  const [members, setMembers] = useState<SetMember[]>(sets?.members ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSetA(sets?.set_a ?? { id: newId(), name: "" });
    setSetB(sets?.set_b ?? { id: newId(), name: "" });
    setMembers(sets?.members ?? []);
  }, [sets]);

  function regionOf(pieceId: string): "" | "a" | "b" | "both" {
    return members.find((m) => m.piece_id === pieceId)?.region ?? "";
  }

  function setRegion(pieceId: string, region: "" | "a" | "b" | "both") {
    setMembers((prev) => {
      const rest = prev.filter((m) => m.piece_id !== pieceId);
      return region === "" ? rest : [...rest, { piece_id: pieceId, region }];
    });
  }

  function save() {
    const structure: SetsStructure = {
      type: "sets",
      perspective_id: perspectiveId,
      set_a: setA,
      set_b: setB,
      members,
    };
    setSaving(true);
    void mutate([{ type: "set_sets", structure }]).then((ok) => {
      setSaving(false);
      onSaved(ok);
    });
  }

  return (
    <div className="editor">
      <div className="editor-row">
        <input
          value={setA.name}
          placeholder="集合 A 名称"
          onChange={(e) => setSetA((s) => ({ ...s, name: e.target.value }))}
        />
        <input
          value={setB.name}
          placeholder="集合 B 名称"
          onChange={(e) => setSetB((s) => ({ ...s, name: e.target.value }))}
        />
      </div>

      <h4>为每条材料勾选归属</h4>
      {pieces.map((p) => (
        <div key={p.id} className="editor-row">
          <span className="editor-row__label">{p.text}</span>
          <select
            value={regionOf(p.id)}
            onChange={(e) => setRegion(p.id, e.target.value as "" | "a" | "b" | "both")}
          >
            <option value="">未选</option>
            <option value="a">{setA.name || "A"}</option>
            <option value="b">{setB.name || "B"}</option>
            <option value="both">两者</option>
          </select>
        </div>
      ))}

      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存集合"}
        </button>
      </div>
    </div>
  );
}
