import { useMemo, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useStructureEditor } from "../lib/useStructureEditor";
import { DraftRemoteBanner } from "../lib/useDraft";
import { newId, type LogicTree, type LogicTreeNode } from "../lib/types";
import { EditorActions } from "./EditorActions";
import { MaterialPicker } from "./MaterialPicker";

export function LogicTreeEditor({
  perspectiveId,
  tree,
  onSaved,
}: {
  perspectiveId: string;
  tree: LogicTree | null;
  onSaved: (ok: boolean) => void;
}) {
  const { snapshot } = useWorkspace();
  const pieces = (snapshot?.pieces ?? [])
    .filter((p) => p.id !== snapshot?.root_id)
    .map((p) => ({ id: p.id, text: p.text }));

  const remote = useMemo(() => tree?.nodes ?? [], [tree]);
  const { draft, saving, error, save } = useStructureEditor(remote, onSaved);
  const nodes = draft.value;
  const setNodes = draft.setValue;
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  function addNode() {
    const id = newId();
    const parent = nodes.length ? nodes[0].id : null;
    setNodes((n) => [...n, { id, text: "", parent_id: parent, materials: [] }]);
    setFocusNodeId(id);
  }

  function updateNode(id: string, patch: Partial<LogicTreeNode>) {
    setNodes((n) => n.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function descendantsOf(id: string): Set<string> {
    const out = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (n.parent_id && out.has(n.parent_id) && !out.has(n.id)) {
          out.add(n.id);
          changed = true;
        }
      }
    }
    return out;
  }

  function removeNode(id: string) {
    const doomed = descendantsOf(id);
    setNodes((n) => n.filter((x) => !doomed.has(x.id)));
  }

  function moveNode(id: string, dir: -1 | 1) {
    setNodes((n) => {
      const idx = n.findIndex((x) => x.id === id);
      if (idx < 0) return n;
      const node = n[idx];
      const siblingIdxs = n
        .map((x, i) => ({ parent: x.parent_id, i }))
        .filter(({ parent }) => parent === node.parent_id)
        .map(({ i }) => i);
      const pos = siblingIdxs.indexOf(idx);
      const targetPos = pos + dir;
      if (targetPos < 0 || targetPos >= siblingIdxs.length) return n;
      const targetIdx = siblingIdxs[targetPos];
      const next = [...n];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next;
    });
  }

  return (
    <div className="editor">
      <DraftRemoteBanner
        show={draft.dirty && draft.remoteChanged}
        onAccept={draft.acceptRemote}
      />
      {nodes.map((n) => (
        <div key={n.id} className="editor-block">
          <div className="editor-row">
            <input
              value={n.text}
              placeholder="问题"
              autoFocus={focusNodeId === n.id}
              onChange={(e) => updateNode(n.id, { text: e.target.value })}
              onBlur={() => {
                if (focusNodeId === n.id) setFocusNodeId(null);
              }}
            />
            <select
              value={n.parent_id ?? ""}
              onChange={(e) => updateNode(n.id, { parent_id: e.target.value || null })}
            >
              <option value="">（根问题）</option>
              {nodes
                .filter((x) => x.id !== n.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.text || x.id}
                  </option>
                ))}
            </select>
            <button type="button" onClick={() => moveNode(n.id, -1)}>
              ↑
            </button>
            <button type="button" onClick={() => moveNode(n.id, 1)}>
              ↓
            </button>
            <button type="button" onClick={() => removeNode(n.id)}>
              删
            </button>
          </div>
          <details className="editor-details">
            <summary>材料（{n.materials.length}）</summary>
            <MaterialPicker
              pieces={pieces}
              selected={n.materials}
              onChange={(ids) => updateNode(n.id, { materials: ids })}
            />
          </details>
        </div>
      ))}
      <button type="button" onClick={addNode}>
        ＋ 问题
      </button>

      <EditorActions
        saving={saving}
        saveLabel="保存逻辑树"
        error={error}
        onSave={() =>
          save((value) => ({
            type: "set_logic_tree",
            structure: {
              type: "logic_tree",
              perspective_id: perspectiveId,
              nodes: value,
            },
          }))
        }
      />
    </div>
  );
}
