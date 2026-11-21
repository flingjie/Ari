import { useEffect, useState } from "react";
import { useWorkspace } from "../store/workspace";
import {
  newId,
  type MatrixAxis,
  type MatrixCoordinate,
  type MatrixStructure,
} from "../lib/types";

export function MatrixEditor({
  perspectiveId,
  matrix,
  onSaved,
}: {
  perspectiveId: string;
  matrix: MatrixStructure | null;
  onSaved: (ok: boolean) => void;
}) {
  const { snapshot, mutate } = useWorkspace();
  const pieces = (snapshot?.pieces ?? []).filter((p) => p.id !== snapshot?.root_id);

  const [xAxis, setXAxis] = useState<MatrixAxis>(
    matrix?.x_axis ?? { id: newId(), name: "", values: [] },
  );
  const [yAxis, setYAxis] = useState<MatrixAxis>(
    matrix?.y_axis ?? { id: newId(), name: "", values: [] },
  );
  const [coordinates, setCoordinates] = useState<MatrixCoordinate[]>(
    matrix?.coordinates ?? [],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setXAxis(matrix?.x_axis ?? { id: newId(), name: "", values: [] });
    setYAxis(matrix?.y_axis ?? { id: newId(), name: "", values: [] });
    setCoordinates(matrix?.coordinates ?? []);
  }, [matrix]);

  function addValue(axis: "x" | "y") {
    const name = window.prompt("取值名称");
    if (!name || !name.trim()) return;
    const patch = (a: MatrixAxis): MatrixAxis => ({
      ...a,
      values: [...a.values, { id: newId(), name: name.trim() }],
    });
    if (axis === "x") setXAxis(patch);
    else setYAxis(patch);
  }

  function deleteValue(axis: "x" | "y", id: string) {
    if (axis === "x") {
      setXAxis((a) => ({ ...a, values: a.values.filter((v) => v.id !== id) }));
      setCoordinates((cs) => cs.filter((c) => c.x_value_id !== id));
    } else {
      setYAxis((a) => ({ ...a, values: a.values.filter((v) => v.id !== id) }));
      setCoordinates((cs) => cs.filter((c) => c.y_value_id !== id));
    }
  }

  function renameValue(axis: "x" | "y", id: string, name: string) {
    const patch = (a: MatrixAxis): MatrixAxis => ({
      ...a,
      values: a.values.map((v) => (v.id === id ? { ...v, name } : v)),
    });
    if (axis === "x") setXAxis(patch);
    else setYAxis(patch);
  }

  function coordOf(pieceId: string): MatrixCoordinate | undefined {
    return coordinates.find((c) => c.piece_id === pieceId);
  }

  function setCoord(pieceId: string, xId: string, yId: string) {
    setCoordinates((prev) => {
      const rest = prev.filter((c) => c.piece_id !== pieceId);
      if (!xId || !yId) return rest; // 未定位
      return [...rest, { piece_id: pieceId, x_value_id: xId, y_value_id: yId }];
    });
  }

  function save() {
    const structure: MatrixStructure = {
      type: "matrix",
      perspective_id: perspectiveId,
      x_axis: xAxis,
      y_axis: yAxis,
      coordinates,
    };
    setSaving(true);
    void mutate([{ type: "set_matrix", structure }]).then((ok) => {
      setSaving(false);
      onSaved(ok);
    });
  }

  const axisEditor = (
    label: string,
    axis: MatrixAxis,
    kind: "x" | "y",
  ) => (
    <div className="editor-block">
      <div className="editor-row">
        <input
          value={axis.name}
          placeholder={`${label}名称`}
          onChange={(e) =>
            (kind === "x" ? setXAxis : setYAxis)((a) => ({ ...a, name: e.target.value }))
          }
        />
        <button type="button" onClick={() => addValue(kind)}>
          ＋ 取值
        </button>
      </div>
      {axis.values.map((v) => (
        <div key={v.id} className="editor-row">
          <input
            value={v.name}
            onChange={(e) => renameValue(kind, v.id, e.target.value)}
          />
          <button type="button" onClick={() => deleteValue(kind, v.id)}>
            删
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="editor">
      <h4>横轴（X）</h4>
      {axisEditor("横轴", xAxis, "x")}
      <h4>纵轴（Y）</h4>
      {axisEditor("纵轴", yAxis, "y")}

      <h4>片段定位</h4>
      {pieces.map((p) => {
        const c = coordOf(p.id);
        return (
          <div key={p.id} className="editor-row">
            <span className="editor-row__label">{p.text}</span>
            <select
              value={c?.x_value_id ?? ""}
              onChange={(e) => setCoord(p.id, e.target.value, c?.y_value_id ?? "")}
            >
              <option value="">横轴…</option>
              {xAxis.values.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              value={c?.y_value_id ?? ""}
              onChange={(e) => setCoord(p.id, c?.x_value_id ?? "", e.target.value)}
            >
              <option value="">纵轴…</option>
              {yAxis.values.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}

      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存矩阵"}
        </button>
      </div>
    </div>
  );
}
