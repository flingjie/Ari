import { useEffect, useState } from "react";
import type { GroupedPiece, GroupedView } from "../lib/types";
import { PieceCard } from "./PieceCard";

export interface CardOp {
  perspectiveId: string;
  pillarId: string | null;
  requestId: string;
}

function PillarName({
  name,
  onRename,
  autoFocus,
  onFocused,
}: {
  name: string;
  onRename: (v: string) => void;
  autoFocus?: boolean;
  onFocused?: () => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  return (
    <input
      className="groupname"
      value={value}
      aria-label="支柱名"
      autoFocus={autoFocus}
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => {
        if (autoFocus) onFocused?.();
      }}
      onBlur={() => {
        const v = value.trim();
        if (v && v !== name) onRename(v);
      }}
    />
  );
}

export function PillarBoard({
  view,
  onMove,
  onRetryCard,
  onRenamePillar,
  pending,
  failed,
  focusPillarId,
  onFocusPillarConsumed,
  selectedPieceId,
  onSelectPiece,
}: {
  view: GroupedView;
  onMove: (pieceId: string, pillarId: string | null) => void;
  onRetryCard: (pieceId: string) => void;
  onRenamePillar: (id: string, name: string) => void;
  pending: Record<string, CardOp>;
  failed: Record<string, CardOp>;
  focusPillarId?: string | null;
  onFocusPillarConsumed?: () => void;
  selectedPieceId?: string | null;
  onSelectPiece?: (pieceId: string) => void;
}) {
  const [overKey, setOverKey] = useState<string | null>(null);

  type Flat = { piece: GroupedPiece; confirmedPillarId: string | null };
  const flat: Flat[] = [
    ...view.pillars.flatMap((p) =>
      p.pieces.map((pc) => ({ piece: pc, confirmedPillarId: p.id as string | null })),
    ),
    ...view.unassigned.map((pc) => ({ piece: pc, confirmedPillarId: null as string | null })),
  ];

  const columns: { id: string | null; name: string }[] = [
    ...view.pillars.map((p) => ({ id: p.id as string | null, name: p.name })),
    { id: null, name: "待归类" },
  ];

  const displayColumn = (f: Flat): string | null =>
    pending[f.piece.id]?.pillarId ?? f.confirmedPillarId;

  return (
    <div className="board">
      {columns.map((col) => {
        const key = col.id ?? "__unassigned";
        const pieces = flat.filter((f) => displayColumn(f) === col.id).map((f) => f.piece);
        return (
          <section
            key={key}
            className="board-column"
            data-over={overKey === key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverKey(key);
            }}
            onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              setOverKey(null);
              const pieceId = e.dataTransfer.getData("text/plain");
              if (pieceId) onMove(pieceId, col.id);
            }}
          >
            {col.id !== null ? (
              <PillarName
                name={col.name}
                onRename={(v) => onRenamePillar(col.id as string, v)}
                autoFocus={focusPillarId === col.id}
                onFocused={onFocusPillarConsumed}
              />
            ) : (
              <b>待归类</b>
            )}
            {pieces.length === 0 ? (
              <p className="board-empty">暂无材料</p>
            ) : (
              pieces.map((piece) => (
                <PieceCard
                  key={piece.id}
                  piece={piece}
                  pillarId={col.id}
                  pillars={view.pillars}
                  pending={!!pending[piece.id]}
                  failed={!!failed[piece.id]}
                  selected={selectedPieceId === piece.id}
                  onSelect={onSelectPiece}
                  onMove={onMove}
                  onRetry={onRetryCard}
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}
