import { useEffect, useMemo, useState } from "react";
import { MindMapView } from "../components/MindMapView";
import { PieceInbox } from "../components/PieceInbox";
import { useChat } from "../store/chat";
import type { Operation } from "../lib/types";

type PieceView = "inbox" | "map";

function collectAddedPieceIds(changeSet: Operation[] | undefined): string[] {
  if (!changeSet) return [];
  const ids: string[] = [];
  for (const op of changeSet) {
    if (op.type === "add_piece") ids.push(op.id);
  }
  return ids;
}

export default function PiecePage() {
  const { setSelectedPieceId, messages } = useChat();
  const [view, setView] = useState<PieceView>("inbox");

  // 最近一次已采纳提案里新增的片段，收件箱短暂高亮。
  const highlightIds = useMemo(() => {
    const ids = new Set<string>();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.proposalStatus === "accept" && m.proposal?.change_set) {
        for (const id of collectAddedPieceIds(m.proposal.change_set)) {
          ids.add(id);
        }
        break;
      }
    }
    return ids;
  }, [messages]);

  useEffect(() => {
    return () => setSelectedPieceId(null);
  }, [setSelectedPieceId]);

  return (
    <div className="piece-page">
      <div className="view-toggle" role="tablist" aria-label="片段视图">
        <button
          type="button"
          role="tab"
          aria-selected={view === "inbox"}
          onClick={() => setView("inbox")}
        >
          收件箱
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "map"}
          onClick={() => setView("map")}
        >
          导图总览
        </button>
      </div>

      {view === "inbox" ? (
        <PieceInbox highlightIds={highlightIds} />
      ) : (
        <MindMapView />
      )}
    </div>
  );
}
