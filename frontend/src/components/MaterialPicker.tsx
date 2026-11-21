export interface MaterialRef {
  id: string;
  text: string;
}

// 片段引用选择器：勾选若干片段（维恩成员 / 金字塔证据 / 逻辑树材料复用）。
export function MaterialPicker({
  pieces,
  selected,
  onChange,
}: {
  pieces: MaterialRef[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="material-picker">
      {pieces.map((p) => {
        const checked = selected.includes(p.id);
        return (
          <label key={p.id} className="material-picker__item">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                onChange(
                  e.target.checked
                    ? [...selected, p.id]
                    : selected.filter((id) => id !== p.id),
                );
              }}
            />
            <span>{p.text}</span>
          </label>
        );
      })}
      {pieces.length === 0 ? <p className="material-picker__empty">暂无片段</p> : null}
    </div>
  );
}
