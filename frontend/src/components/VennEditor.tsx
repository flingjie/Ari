import { useMemo } from "react";
import { useWorkspace } from "../store/workspace";
import { useStructureEditor } from "../lib/useStructureEditor";
import { DraftRemoteBanner } from "../lib/useDraft";
import {
  newId,
  type SetMember,
  type SetsStructure,
  type VennSet,
} from "../lib/types";
import { EditorActions } from "./EditorActions";

type VennDraft = {
  setA: VennSet;
  setB: VennSet;
  members: SetMember[];
};

export function VennEditor({
  perspectiveId,
  sets,
  onSaved,
}: {
  perspectiveId: string;
  sets: SetsStructure | null;
  onSaved: (ok: boolean) => void;
}) {
  const { snapshot } = useWorkspace();
  const pieces = (snapshot?.pieces ?? []).filter((p) => p.id !== snapshot?.root_id);

  const remote = useMemo<VennDraft>(
    () => ({
      setA: sets?.set_a ?? { id: newId(), name: "" },
      setB: sets?.set_b ?? { id: newId(), name: "" },
      members: sets?.members ?? [],
    }),
    [sets],
  );
  const { draft, saving, error, save } = useStructureEditor(remote, onSaved);
  const { setA, setB, members } = draft.value;

  function regionOf(pieceId: string): "" | "a" | "b" | "both" {
    return members.find((m) => m.piece_id === pieceId)?.region ?? "";
  }

  function setRegion(pieceId: string, region: "" | "a" | "b" | "both") {
    draft.setValue((d) => {
      const rest = d.members.filter((m) => m.piece_id !== pieceId);
      return {
        ...d,
        members: region === "" ? rest : [...rest, { piece_id: pieceId, region }],
      };
    });
  }

  return (
    <div className="editor">
      <DraftRemoteBanner
        show={draft.dirty && draft.remoteChanged}
        onAccept={draft.acceptRemote}
      />
      <div className="editor-row">
        <input
          value={setA.name}
          placeholder="集合 A 名称"
          onChange={(e) =>
            draft.setValue((d) => ({ ...d, setA: { ...d.setA, name: e.target.value } }))
          }
        />
        <input
          value={setB.name}
          placeholder="集合 B 名称"
          onChange={(e) =>
            draft.setValue((d) => ({ ...d, setB: { ...d.setB, name: e.target.value } }))
          }
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

      <EditorActions
        saving={saving}
        saveLabel="保存集合"
        error={error}
        onSave={() =>
          save((value) => ({
            type: "set_sets",
            structure: {
              type: "sets",
              perspective_id: perspectiveId,
              set_a: value.setA,
              set_b: value.setB,
              members: value.members,
            },
          }))
        }
      />
    </div>
  );
}
