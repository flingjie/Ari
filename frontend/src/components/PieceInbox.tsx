import { useMemo, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useChat } from "../store/chat";
import { newId, type Piece } from "../lib/types";

function kindLabel(kind: Piece["kind"]): string {
  return kind === "inferred" ? "推测" : "原话";
}

/** 按采集树深度优先排出非根片段（平铺展示）。 */
function flattenMaterials(pieces: Piece[], rootId: string): Piece[] {
  const byParent = new Map<string | null, Piece[]>();
  for (const p of pieces) {
    const key = p.parent_id;
    const list = byParent.get(key) ?? [];
    list.push(p);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  const out: Piece[] = [];
  const walk = (parentId: string) => {
    for (const child of byParent.get(parentId) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(rootId);
  return out;
}

export function PieceInbox({
  highlightIds,
}: {
  highlightIds?: ReadonlySet<string>;
}) {
  const { snapshot, mutate, sync } = useWorkspace();
  const { selectedPieceId, setSelectedPieceId, setPanelOpen } = useChat();
  const [draft, setDraft] = useState("");
  const busy = sync.status === "pending";

  const root = snapshot?.pieces.find((p) => p.id === snapshot.root_id) ?? null;
  const materials = useMemo(
    () => (snapshot ? flattenMaterials(snapshot.pieces, snapshot.root_id) : []),
    [snapshot],
  );

  if (!snapshot || !root) return null;

  function selectPiece(id: string) {
    setSelectedPieceId(id);
    setPanelOpen(true);
  }

  function addMaterial() {
    const text = draft.trim();
    if (!text || !snapshot) return;
    const id = newId();
    void mutate([
      {
        type: "add_piece",
        id,
        parent_id: snapshot.root_id,
        text,
        kind: "quote",
      },
    ]).then((ok) => {
      if (ok) {
        setDraft("");
        selectPiece(id);
      }
    });
  }

  function removeMaterial(id: string) {
    void mutate([{ type: "remove_piece", piece_id: id }]);
    if (selectedPieceId === id) setSelectedPieceId(null);
  }

  function saveTheme(text: string) {
    const t = text.trim();
    if (!t || t === root!.text) return;
    void mutate([{ type: "update_piece", piece_id: root!.id, text: t }]);
  }

  return (
    <div className="piece-inbox">
      <label className="piece-theme">
        <span className="piece-theme-label">主题</span>
        <input
          className="piece-theme-input"
          defaultValue={root.text}
          key={root.id + root.text}
          disabled={busy}
          onBlur={(e) => saveTheme(e.target.value)}
          aria-label="主题名称"
        />
      </label>

      <div className="piece-inbox-compose">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              addMaterial();
            }
          }}
          placeholder="记下一条事实、例子或疑问…"
          disabled={busy}
          aria-label="新素材"
        />
        <button
          type="button"
          className="primary"
          onClick={addMaterial}
          disabled={busy || !draft.trim()}
        >
          加入
        </button>
      </div>

      {materials.length === 0 ? (
        <p className="board-empty">还没有素材。先记几条，或在对话里让阿理帮你拆。</p>
      ) : (
        <ul className="piece-inbox-list">
          {materials.map((p) => {
            const selected = selectedPieceId === p.id;
            const highlighted = highlightIds?.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="inbox-card"
                  data-selected={selected ? "true" : "false"}
                  data-highlight={highlighted ? "true" : "false"}
                  onClick={() => selectPiece(p.id)}
                >
                  <span className="inbox-card-text">{p.text}</span>
                  <span className="inbox-card-meta">
                    <span className="inbox-badge" data-kind={p.kind}>
                      {kindLabel(p.kind)}
                    </span>
                    {p.source.trim() ? (
                      <span className="inbox-source">有来源</span>
                    ) : (
                      <span className="inbox-source inbox-source--missing">无来源</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="inbox-card-delete"
                  aria-label={`删除「${p.text}」`}
                  disabled={busy}
                  onClick={() => removeMaterial(p.id)}
                >
                  删除
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
