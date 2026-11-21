export function EditorActions({
  saving,
  saveLabel,
  onSave,
  error,
}: {
  saving: boolean;
  saveLabel: string;
  onSave: () => void;
  error?: string;
}) {
  return (
    <div className="editor-actions">
      <button className="primary" type="button" onClick={onSave} disabled={saving}>
        {saving ? "保存中…" : saveLabel}
      </button>
      {error ? <span className="editor-error">{error}</span> : null}
    </div>
  );
}
