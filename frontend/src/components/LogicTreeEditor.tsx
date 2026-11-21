import { useEffect, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { newId, type LogicTree, type LogicTreeNode } from "../lib/types";
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
  const { snapshot, mutate } = useWorkspace();
  const pieces = (snapshot?.pieces ?? [])
    .filter((p) => p.id !== snapshot?.root_id)
    .map((p) => ({ id: p.id, text: p.text }));

  const [nodes, setNodes] = useState<LogicTreeNode[]>(tree?.nodes ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => setNodes(tree?.nodes ?? []), [tree]);

  function addNode() {
    const text = window.prompt("问题名称");
    if (!text || !text.trim()) return;
    const parent = nodes.length ? nodes[0].id : null;
    setNodes((n) => [
      ...n,
      { id: newId(), text: text.trim(), parent_id: parent, materials: [] },
    ]);
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
    if (doomed.size > 1 && !window.confirm(`将删除该问题及其 ${doomed.size - 1} 个子问题，继续？`)) {
      return;
    }
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

  function save() {
    const structure: LogicTree = {
      type: "logic_tree",
      perspective_id: perspectiveId,
      nodes,
    };
    setSaving(true);
    void mutate([{ type: "set_logic_tree", structure }]).then((ok) => {
      setSaving(false);
      onSaved(ok);
    });
  }

  return (
    <div className="editor">
      {nodes.map((n) => (
        <div key={n.id} className="editor-block">
          <div className="editor-row">
            <input
              value={n.text}
              placeholder="问题"
              onChange={(e) => updateNode(n.id, { text: e.target.value })}
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

      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存逻辑树"}
        </button>
      </div>
    </div>
  );
}
