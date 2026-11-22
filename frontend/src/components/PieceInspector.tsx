import { useEffect, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useChat } from "../store/chat";

/** 侧栏素材详情：改文案/来源，并提示质量追问。 */
export function PieceInspector() {
  const { snapshot, mutate, sync } = useWorkspace();
  const { selectedPieceId, setSelectedPieceId } = useChat();
  const piece = snapshot?.pieces.find((p) => p.id === selectedPieceId) ?? null;
  const isRoot = piece && snapshot ? piece.id === snapshot.root_id : false;

  const [text, setText] = useState("");
  const [source, setSource] = useState("");

  useEffect(() => {
    if (!piece) {
      setText("");
      setSource("");
      return;
    }
    setText(piece.text);
    setSource(piece.source);
  }, [piece?.id, piece?.text, piece?.source]);

  if (!piece || !snapshot) return null;

  const busy = sync.status === "pending";
  const dirty =
    text.trim() !== piece.text || source.trim() !== piece.source.trim();

  function save() {
    if (!piece || !dirty) return;
    const nextText = text.trim() || piece.text;
    void mutate([
      {
        type: "update_piece",
        piece_id: piece.id,
        text: nextText,
        source: source.trim(),
      },
    ]);
  }

  return (
    <div className="piece-inspector">
      <header className="piece-inspector-header">
        <strong>{isRoot ? "主题" : "素材详情"}</strong>
        <button
          type="button"
          aria-label="关闭素材详情"
          onClick={() => setSelectedPieceId(null)}
        >
          ×
        </button>
      </header>
      <label className="piece-inspector-field">
        <span>内容</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          disabled={busy}
          rows={4}
        />
      </label>
      {!isRoot ? (
        <label className="piece-inspector-field">
          <span>来源</span>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onBlur={save}
            disabled={busy}
            placeholder="例如：访谈、帖子、文档…"
          />
        </label>
      ) : null}
      {!isRoot ? (
        <p className="piece-inspector-hint">
          {piece.kind === "inferred" ? "推测 · " : "原话 · "}
          问阿理：这条能说明什么？还不能说明什么？
        </p>
      ) : null}
      {dirty ? (
        <button type="button" className="primary" onClick={save} disabled={busy}>
          保存
        </button>
      ) : null}
    </div>
  );
}
