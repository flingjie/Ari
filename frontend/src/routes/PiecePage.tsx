import { useCallback, useEffect, useRef } from "react";
import "../vendor/jsmind.js";
import "../vendor/jsmind.draggable-node.js";
import { useWorkspace } from "../store/workspace";
import { useChat } from "../store/chat";
import { editEventToOperation, piecesToNodeArray } from "../lib/adapter";
import { newId, type Snapshot } from "../lib/types";

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
  const { snapshot, mutate, sync } = useWorkspace();
  const { setSelectedPieceId } = useChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const jmRef = useRef<any>(null);
  // 始终指向最近一次已确认快照（供 edit 事件解析 _first_/失败回滚）。
  const snapshotRef = useRef<Snapshot | null>(snapshot);
  snapshotRef.current = snapshot;
  // 重绘导图时抑制 edit 事件（避免把 show 误判为用户编辑）。
  const suppressEditRef = useRef(false);

  // 用已确认快照重同步既有 jsMind 实例，尽量恢复选中/折叠/视口。
  const resync = useCallback((snap: Snapshot | null) => {
    const jm = jmRef.current;
    if (!jm || !snap) return;
    // 首次 show 前 mind 未初始化，get_root 会抛错，此时跳过状态保存。
    const root = jm.mind ? jm.get_root() : null;
    const selected = jm.mind ? jm.get_selected_node() : null;
    const selectedId: string | null = selected ? selected.id : null;
    const collapsed: string[] = [];
    const collect = (node: any) => {
      if (!node) return;
      if (node.children && node.children.length > 0 && node.expanded === false) {
        collapsed.push(node.id);
      }
      for (const child of node.children ?? []) collect(child);
    };
    if (root) collect(root);

    suppressEditRef.current = true;
    try {
      jm.show({ meta: { name: "ari" }, format: "node_array", data: piecesToNodeArray(snap) });
    } finally {
      suppressEditRef.current = false;
    }

    if (selectedId) {
      const node = jm.get_node(selectedId);
      if (node) {
        jm.select_node(node.id);
        jm.scroll_node_to_center(node);
      }
    }
    for (const id of collapsed) {
      const node = jm.get_node(id);
      if (node && node.children && node.children.length > 0) jm.collapse_node(id);
    }
  }, []);

  // 一次性建实例（拖拽插件已由副作用 import 注册）+ 绑定 edit/select 监听。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const jsMind = window.jsMind;
    const jm = new jsMind({
      container,
      editable: true,
      support_html: false,
      mode: window.innerWidth < 600 ? "side" : "full",
      shortcut: {
        enable: true,
        mapping: {
          addchild: [9, 45], // Tab / Insert：添加子片段
          addbrother: 13, // Enter：添加同级片段
          editnode: 113, // F2：编辑
          delnode: [46, 8], // Delete / Backspace：删除
          toggle: 32, // Space：折叠/展开
          left: 37,
          up: 38,
          right: 39,
          down: 40,
        },
      },
    });
    jm.add_event_listener((type: number, data: JsMindEvent) => {
      if (type === jsMind.event_type.edit) {
        if (suppressEditRef.current) return;
        const op = editEventToOperation(data.evt, data.data, snapshotRef.current);
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

  // 已确认快照变化（本地保存成功 / 远端提案 / 重新加载）→ 重同步既有实例。
  useEffect(() => {
    if (jmRef.current) resync(snapshot);
  }, [snapshot, resync]);

  // 提交中锁结构编辑（含键盘快捷键与拖拽）；失败/冲突时用最后确认快照撤销本地移动。
  useEffect(() => {
    const jm = jmRef.current;
    if (!jm) return;
    if (sync.status === "pending") {
      jm.disable_edit();
      jm.shortcut.disable_shortcut();
    } else {
      jm.enable_edit();
      jm.shortcut.enable_shortcut();
      if (sync.status === "error" || sync.status === "conflict") {
        if (snapshotRef.current) resync(snapshotRef.current);
      }
    }
  }, [sync.status, resync]);

  // 离开片段页时清除选中的片段引用。
  useEffect(() => {
    return () => setSelectedPieceId(null);
  }, [setSelectedPieceId]);

  const busy = sync.status === "pending";

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
        <button onClick={addChild} disabled={busy}>
          ＋ 子片段
        </button>
        <button onClick={editNode} disabled={busy}>
          编辑节点
        </button>
        <button onClick={deleteBranch} disabled={busy}>
          删除分支
        </button>
        <button onClick={backToCenter}>回到中心</button>
      </div>
      <p className="map-hint">
        双击或 F2 编辑 · Tab 加子片段 · Enter 加同级 · Delete 删除 · 拖拽移动
      </p>
    </>
  );
}
