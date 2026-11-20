import { useEffect, useRef } from "react";
import "../vendor/jsmind.js";
import { useWorkspace } from "../store/workspace";
import { editEventToOperation, piecesToNodeArray } from "../lib/adapter";
import { newId } from "../lib/types";
import { StageAssistant } from "../components/StageAssistant";

function countSubtree(node: any): number {
  let count = 0;
  const walk = (n: any) => {
    count += 1;
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return count;
}

export default function PiecePage() {
  const { snapshot, mutate } = useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const jmRef = useRef<any>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !snapshot) return;
    const jsMind = window.jsMind;
    const jm = new jsMind({
      container,
      editable: true,
      support_html: false,
      mode: window.innerWidth < 600 ? "side" : "full",
      shortcut: { enable: false },
    });
    jm.show({
      meta: { name: "ari" },
      format: "node_array",
      data: piecesToNodeArray(snapshot),
    });
    jm.add_event_listener((type: number, data: { evt: string; data: unknown[] }) => {
      if (type === jsMind.event_type.edit) {
        const op = editEventToOperation(data.evt, data.data);
        if (op) void mutate([op]);
      }
    });
    jmRef.current = jm;
    return () => {
      jmRef.current = null;
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = () => {
    const jm = jmRef.current;
    if (!jm) return null;
    return jm.get_selected_node() || jm.get_root();
  };

  function addChild() {
    const jm = jmRef.current;
    const sel = selected();
    if (!jm || !sel) return;
    const text = window.prompt("新片段");
    if (text && text.trim()) {
      const node = jm.add_node(sel, newId(), text.trim());
      if (node) jm.select_node(node.id);
    }
  }

  function editNode() {
    const jm = jmRef.current;
    const sel = selected();
    if (!jm || !sel) return;
    const text = window.prompt("节点内容", sel.topic);
    if (text && text.trim()) {
      jm.update_node(sel.id, text.trim());
    }
  }

  function deleteBranch() {
    const jm = jmRef.current;
    const sel = selected();
    if (!jm || !sel) return;
    if (sel.isroot) {
      window.alert("根节点不可删除");
      return;
    }
    const affected = countSubtree(sel);
    if (window.confirm(`删除这个节点及其 ${affected - 1} 个子节点？`)) {
      jm.remove_node(sel.id);
    }
  }

  function backToCenter() {
    const jm = jmRef.current;
    if (!jm) return;
    jm.scroll_node_to_center(jm.get_root());
  }

  return (
    <>
      <div ref={containerRef} className="map-container" />
      <div className="actions">
        <button onClick={addChild}>＋ 子片段</button>
        <button onClick={editNode}>编辑节点</button>
        <button onClick={deleteBranch}>删除分支</button>
        <button onClick={backToCenter}>回到中心</button>
      </div>
      <StageAssistant stage="piece" />
    </>
  );
}
