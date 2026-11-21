import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../store/workspace";
import { newId, type Piece, type Pillar } from "../lib/types";

function PillarName({ name, onRename }: { name: string; onRename: (v: string) => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  return (
    <input
      className="groupname"
      value={value}
      aria-label="支柱名"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const v = value.trim();
        if (v && v !== name) onRename(v);
      }}
    />
  );
}

function PieceRow({
  piece,
  pillars,
  pillarId,
  onMove,
}: {
  piece: Piece;
  pillars: Pillar[];
  pillarId: string | null;
  onMove: (pieceId: string, pillarId: string | null) => void;
}) {
  return (
    <div className="item">
      <span>{piece.text}</span>
      <select
        aria-label={`移动片段 ${piece.text}`}
        value={pillarId ?? ""}
        onChange={(e) => onMove(piece.id, e.target.value || null)}
      >
        <option value="">待归类</option>
        {pillars.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function PillarPage() {
  const { snapshot, mutate, workspaceId } = useWorkspace();
  if (!snapshot) return null;

  const active = snapshot.active_perspective_id;
  if (!active) {
    return (
      <div className="card">
        <p>还没有选择视角。</p>
        <p>
          <Link to={`/w/${workspaceId}/perspective`}>去选视角</Link>
        </p>
      </div>
    );
  }
  // 闭包内 TS 不保留收窄，这里用显式 string 固定类型。
  const activeId: string = active;

  const pillars = snapshot.pillars
    .filter((p) => p.perspective_id === active)
    .sort((a, b) => a.order - b.order);
  const pieces = snapshot.pieces
    .filter((p) => p.id !== snapshot.root_id)
    .sort((a, b) => a.order - b.order);
  const assign = new Map(
    snapshot.assignments
      .filter((a) => a.perspective_id === active)
      .map((a) => [a.piece_id, a.pillar_id]),
  );

  const members = (pillarId: string | null) =>
    pieces.filter((p) => (assign.get(p.id) ?? null) === pillarId);

  function renamePillar(id: string, name: string) {
    void mutate([{ type: "rename_pillar", id, name }]);
  }
  function addPillar() {
    const name = window.prompt("支柱名称");
    if (name && name.trim()) {
      void mutate([
        { type: "add_pillar", id: newId(), perspective_id: activeId, name: name.trim() },
      ]);
    }
  }
  function movePiece(pieceId: string, pillarId: string | null) {
    void mutate([
      {
        type: "assign_piece",
        perspective_id: activeId,
        piece_id: pieceId,
        pillar_id: pillarId,
      },
    ]);
  }

  // 支柱顺序 + 最后的「待归类」（null）。
  const columns: (string | null)[] = [...pillars.map((p) => p.id), null];

  return (
    <div>
      {columns.map((pillarId) => {
        const name = pillarId ? pillars.find((p) => p.id === pillarId)!.name : "待归类";
        const items = members(pillarId);
        return (
          <section key={pillarId ?? "__unassigned"} className="card">
            {pillarId ? (
              <PillarName name={name} onRename={(v) => renamePillar(pillarId, v)} />
            ) : (
              <b>待归类</b>
            )}
            {items.length === 0 ? (
              <p>暂无材料</p>
            ) : (
              items.map((p) => (
                <PieceRow
                  key={p.id}
                  piece={p}
                  pillars={pillars}
                  pillarId={assign.get(p.id) ?? null}
                  onMove={movePiece}
                />
              ))
            )}
          </section>
        );
      })}
      <button onClick={addPillar}>＋ 新支柱</button>
    </div>
  );
}
