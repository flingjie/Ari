import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspace } from "../store/workspace";
import { useGroupedView } from "../lib/useGroupedView";
import {
  newId,
  type Flow,
  type LogicTree,
  type MatrixStructure,
  type Pyramid,
  type SetsStructure,
} from "../lib/types";
import { PillarBoard, type CardOp } from "../components/PillarBoard";
import { PillarChartPanel } from "../components/PillarChartPanel";
import { GapCheck } from "../components/GapCheck";
import { useChat } from "../store/chat";

export default function PillarPage() {
  const { snapshot, mutate, load, workspaceId, revision } = useWorkspace();
  const { selectedPieceId, setSelectedPieceId, setPanelOpen } = useChat();
  const [pending, setPending] = useState<Record<string, CardOp>>({});
  const [failed, setFailed] = useState<Record<string, CardOp>>({});
  const activeRef = useRef<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusPillarId, setFocusPillarId] = useState<string | null>(null);
  const [showGap, setShowGap] = useState(false);

  const activeId = snapshot?.active_perspective_id ?? null;

  useEffect(() => {
    activeRef.current = activeId;
    setPending({});
    setFailed({});
    setFocusPillarId(null);
  }, [activeId]);

  useEffect(() => {
    return () => setSelectedPieceId(null);
  }, [setSelectedPieceId]);

  function clearEditorParam() {
    if (!searchParams.has("editor")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("editor");
    setSearchParams(next, { replace: true });
  }

  const { view, status, error } = useGroupedView(
    workspaceId,
    activeId,
    revision,
    activeId !== null,
  );

  if (!snapshot) return null;

  if (!activeId) {
    return (
      <div className="card">
        <p>还没有选择视角。</p>
        <p>
          <Link to={`/w/${workspaceId}/perspective`}>去选视角</Link>
        </p>
      </div>
    );
  }

  // 收窄后的当前视角 ID（闭包内固定为 string）。
  const currentActiveId: string = activeId;

  const flow = snapshot.visualizations.find(
    (v): v is Flow => v.type === "flow" && v.perspective_id === currentActiveId,
  );
  const sets = snapshot.visualizations.find(
    (v): v is SetsStructure => v.type === "sets" && v.perspective_id === currentActiveId,
  );
  const matrix = snapshot.visualizations.find(
    (v): v is MatrixStructure => v.type === "matrix" && v.perspective_id === currentActiveId,
  );
  const pyramid = snapshot.visualizations.find(
    (v): v is Pyramid => v.type === "pyramid" && v.perspective_id === currentActiveId,
  );
  const logicTree = snapshot.visualizations.find(
    (v): v is LogicTree => v.type === "logic_tree" && v.perspective_id === currentActiveId,
  );

  // 已确认归属（用于拖到同列 no-op）。
  const confirmedMap: Record<string, string | null> = {};
  if (view) {
    for (const p of view.pillars) {
      for (const pc of p.pieces) confirmedMap[pc.id] = p.id;
    }
    for (const pc of view.unassigned) confirmedMap[pc.id] = null;
  }

  function renamePillar(id: string, name: string) {
    void mutate([{ type: "rename_pillar", id, name }]);
  }
  function addPillar() {
    const id = newId();
    setFocusPillarId(id);
    void mutate([
      { type: "add_pillar", id, perspective_id: currentActiveId, name: "新支柱" },
    ]);
  }

  function commitAssignment(pieceId: string, pillarId: string | null) {
    if (pending[pieceId]) return; // 每张卡一次只允许一个在途请求
    if (confirmedMap[pieceId] === pillarId) return; // 拖到同列 no-op
    const perspectiveId = currentActiveId; // 绑定拖拽发生时的视角
    const requestId = crypto.randomUUID();
    setPending((prev) => ({ ...prev, [pieceId]: { perspectiveId, pillarId, requestId } }));
    setFailed((prev) => {
      const next = { ...prev };
      delete next[pieceId];
      return next;
    });
    void mutate(
      [{ type: "assign_piece", perspective_id: perspectiveId, piece_id: pieceId, pillar_id: pillarId }],
      requestId,
    ).then((ok) => {
      if (activeRef.current !== perspectiveId) return; // 已切视角，丢弃过期更新
      setPending((prev) => {
        const next = { ...prev };
        delete next[pieceId];
        return next;
      });
      if (!ok) {
        setFailed((prev) => ({ ...prev, [pieceId]: { perspectiveId, pillarId, requestId } }));
      }
    });
  }

  function retryCard(pieceId: string) {
    const f = failed[pieceId];
    if (!f) return;
    setFailed((prev) => {
      const next = { ...prev };
      delete next[pieceId];
      return next;
    });
    setPending((prev) => ({ ...prev, [pieceId]: f }));
    void mutate(
      [{ type: "assign_piece", perspective_id: f.perspectiveId, piece_id: pieceId, pillar_id: f.pillarId }],
      f.requestId,
    ).then((ok) => {
      if (activeRef.current !== f.perspectiveId) return;
      setPending((prev) => {
        const next = { ...prev };
        delete next[pieceId];
        return next;
      });
      if (!ok) setFailed((prev) => ({ ...prev, [pieceId]: f }));
    });
  }

  // 刷新分组时保留上一帧 view，避免卸掉结构编辑器丢失未保存草稿。
  if (status === "loading" && !view) {
    return <div className="card">加载中…</div>;
  }
  if (!view) {
    return (
      <div className="card">
        <p>{error ?? "加载分组失败，请重试"}</p>
        <button onClick={() => load(workspaceId!)}>重新加载</button>
      </div>
    );
  }

  function selectPiece(pieceId: string) {
    setSelectedPieceId(pieceId);
    setPanelOpen(true);
  }

  return (
    <div>
      <div className="actions">
        <button type="button" onClick={addPillar}>
          ＋ 新支柱
        </button>
        <button
          type="button"
          aria-pressed={showGap}
          onClick={() => setShowGap((v) => !v)}
        >
          检查缺口
        </button>
      </div>

      {showGap ? <GapCheck view={view} snapshot={snapshot} /> : null}

      <PillarBoard
        key={currentActiveId}
        view={view}
        onMove={commitAssignment}
        onRetryCard={retryCard}
        onRenamePillar={renamePillar}
        pending={pending}
        failed={failed}
        focusPillarId={focusPillarId}
        onFocusPillarConsumed={() => setFocusPillarId(null)}
        selectedPieceId={selectedPieceId}
        onSelectPiece={selectPiece}
      />

      <PillarChartPanel
        key={currentActiveId}
        workspaceId={workspaceId!}
        revision={revision}
        perspectiveId={currentActiveId}
        editorParam={searchParams.get("editor")}
        onClearEditorParam={clearEditorParam}
        flow={flow ?? null}
        sets={sets ?? null}
        matrix={matrix ?? null}
        pyramid={pyramid ?? null}
        logicTree={logicTree ?? null}
      />
    </div>
  );
}
