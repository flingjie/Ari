import { useCallback, useEffect, useRef, useState } from "react";
import "../vendor/jsmind.js";
import "../vendor/jsmind.draggable-node.js";
import { useWorkspace } from "../store/workspace";
import { useChat } from "../store/chat";
import { editEventToOperation, piecesToNodeArray } from "../lib/adapter";
import { newId, type Snapshot } from "../lib/types";

interface JsMindEvent {
  evt: string;
  data: unknown[];
  node?: string;
}

/** 采集树导图视图（jsMind）；由 Piece 页作为可选总览挂载。 */
export function MindMapView() {
  const { snapshot, mutate, undo, sync } = useWorkspace();
  const { setSelectedPieceId } = useChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const jmRef = useRef<any>(null);
  const snapshotRef = useRef<Snapshot | null>(snapshot);
  snapshotRef.current = snapshot;
  const suppressEditRef = useRef(false);

  const [hint, setHint] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showUndoHintRef = useRef(() => {});
  showUndoHintRef.current = () => {
    setHint("");
    setCanUndo(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setCanUndo(false), 6000);
  };

  const resync = useCallback((snap: Snapshot | null) => {
    const jm = jmRef.current;
    if (!jm || !snap) return;
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
          addchild: [9, 45],
          addbrother: 13,
          editnode: 113,
          delnode: [46, 8],
          toggle: 32,
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
        if (op) {
          void mutate([op]).then((ok) => {
            if (ok && op.type === "remove_piece") showUndoHintRef.current();
          });
        }
      } else if (type === jsMind.event_type.select) {
        setSelectedPieceId(data.node ?? null);
      }
    });
    jmRef.current = jm;
    return () => {
      jmRef.current = null;
      container.innerHTML = "";
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (jmRef.current) resync(snapshot);
  }, [snapshot, resync]);

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
    setHint("");
    setCanUndo(false);
    const id = newId();
    const node = jm.add_node(sel, id, "新片段");
    if (node) {
      jm.select_node(node.id);
      jm.begin_edit(node.id);
    }
  }

  function editNode() {
    const jm = jmRef.current;
    const sel = selected();
    if (!jm || !sel) return;
    setHint("");
    setCanUndo(false);
    jm.begin_edit(sel);
  }

  function deleteBranch() {
    const jm = jmRef.current;
    const sel = selected();
    if (!jm || !sel) return;
    if (sel.isroot) {
      setCanUndo(false);
      setHint("根节点不可删除");
      return;
    }
    setHint("");
    jm.remove_node(sel.id);
  }

  function handleUndo() {
    setCanUndo(false);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    void undo();
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
        <button type="button" onClick={addChild} disabled={busy}>
          ＋ 子片段
        </button>
        <button type="button" onClick={editNode} disabled={busy}>
          编辑节点
        </button>
        <button type="button" onClick={deleteBranch} disabled={busy}>
          删除分支
        </button>
        <button type="button" onClick={backToCenter}>
          回到中心
        </button>
      </div>
      {hint ? <p className="map-hint map-hint--error">{hint}</p> : null}
      {canUndo ? (
        <p className="map-hint map-hint--undo">
          已删除{" "}
          <button type="button" onClick={handleUndo} disabled={busy}>
            撤销
          </button>
        </p>
      ) : null}
      <p className="map-hint">
        双击或 F2 编辑 · Tab 加子片段 · Enter 加同级 · Delete 删除 · 拖拽移动
      </p>
    </>
  );
}
