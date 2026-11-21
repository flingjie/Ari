import { useEffect, useRef } from "react";
import "../vendor/jsmind.js";
import { useWorkspace } from "../store/workspace";
import { useChat } from "../store/chat";
import { editEventToOperation, piecesToNodeArray } from "../lib/adapter";
import { newId } from "../lib/types";

function countSubtree(node: any): number {
  let count = 0;
  const walk = (n: any) => {
    count += 1;
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return count;
}

interface JsMindEvent {
  evt: string;
  data: unknown[];
  node?: string;
}

export default function PiecePage() {
  const { snapshot, mutate, remoteRevision } = useWorkspace();
  const { setSelectedPieceId } = useChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const jmRef = useRef<any>(null);
  const suppressEditRef = useRef(false);

  // 创建 jsMind 实例（仅一次）。
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
    jm.add_event_listener((type: number, data: JsMindEvent) => {
      if (type === jsMind.event_type.edit) {
        if (suppressEditRef.current) return;
        const op = editEventToOperation(data.evt, data.data);
        if (op) void mutate([op]);
      } else if (type === jsMind.event_type.select) {
        setSelectedPieceId(data.node ?? null);
      }
    });
    jmRef.current = jm;
    return () => {
      jmRef.current = null;
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 远端快照更新（提案采纳 / 重新加载）时重绘导图；本地编辑不触发。
  useEffect(() => {
    const jm = jmRef.current;
    if (!jm || !snapshot) return;
    const prev = jm.get_selected_node();
    const prevId = prev ? prev.id : null;
    suppressEditRef.current = true;
    try {
      jm.show({
        meta: { name: "ari" },
        format: "node_array",
        data: piecesToNodeArray(snapshot),
      });
    } finally {
      suppressEditRef.current = false;
    }
    if (prevId && snapshot.pieces.some((p) => p.id === prevId)) {
      jm.select_node(prevId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteRevision]);

  // 离开片段页时清除引用。
  useEffect(() => {
    return () => setSelectedPieceId(null);
  }, [setSelectedPieceId]);

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
    </>
  );
}
