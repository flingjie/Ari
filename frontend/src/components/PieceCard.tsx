import type { GroupedPiece, GroupedPillar } from "../lib/types";

export function PieceCard({
  piece,
  pillarId,
  pillars,
  pending,
  failed,
  onMove,
  onRetry,
}: {
  piece: GroupedPiece;
  pillarId: string | null;
  pillars: GroupedPillar[];
  pending: boolean;
  failed: boolean;
  onMove: (pieceId: string, pillarId: string | null) => void;
  onRetry: (pieceId: string) => void;
}) {
  return (
    <div
      className="piece-card"
      data-pending={pending}
      draggable={!pending}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", piece.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <span>{piece.text}</span>
      <select
        aria-label={`移动片段 ${piece.text}`}
        value={pillarId ?? ""}
        disabled={pending}
        onChange={(e) => onMove(piece.id, e.target.value || null)}
      >
        <option value="">待归类</option>
        {pillars.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {pending ? <span className="piece-pending">保存中…</span> : null}
      {failed ? (
        <span className="piece-failed">
          保存失败
          <button type="button" onClick={() => onRetry(piece.id)}>
            重试
          </button>
        </span>
      ) : null}
    </div>
  );
}
