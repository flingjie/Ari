import { useMemo, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useStructureEditor } from "../lib/useStructureEditor";
import { DraftRemoteBanner } from "../lib/useDraft";
import {
  newId,
  type MatrixAxis,
  type MatrixCoordinate,
  type MatrixStructure,
} from "../lib/types";
import { EditorActions } from "./EditorActions";

type MatrixDraft = {
  xAxis: MatrixAxis;
  yAxis: MatrixAxis;
  coordinates: MatrixCoordinate[];
};

export function MatrixEditor({
  perspectiveId,
  matrix,
  onSaved,
}: {
  perspectiveId: string;
  matrix: MatrixStructure | null;
  onSaved: (ok: boolean) => void;
}) {
  const { snapshot } = useWorkspace();
  const pieces = (snapshot?.pieces ?? []).filter((p) => p.id !== snapshot?.root_id);

  const remote = useMemo<MatrixDraft>(
    () => ({
      xAxis: matrix?.x_axis ?? { id: newId(), name: "", values: [] },
      yAxis: matrix?.y_axis ?? { id: newId(), name: "", values: [] },
      coordinates: matrix?.coordinates ?? [],
    }),
    [matrix],
  );
  const { draft, saving, error, save } = useStructureEditor(remote, onSaved);
  const { xAxis, yAxis, coordinates } = draft.value;
  const [focusValueId, setFocusValueId] = useState<string | null>(null);

  function setXAxis(updater: MatrixAxis | ((prev: MatrixAxis) => MatrixAxis)) {
    draft.setValue((d) => ({
      ...d,
      xAxis: typeof updater === "function" ? updater(d.xAxis) : updater,
    }));
  }
  function setYAxis(updater: MatrixAxis | ((prev: MatrixAxis) => MatrixAxis)) {
    draft.setValue((d) => ({
      ...d,
      yAxis: typeof updater === "function" ? updater(d.yAxis) : updater,
    }));
  }
  function setCoordinates(
    updater: MatrixCoordinate[] | ((prev: MatrixCoordinate[]) => MatrixCoordinate[]),
  ) {
    draft.setValue((d) => ({
      ...d,
      coordinates: typeof updater === "function" ? updater(d.coordinates) : updater,
    }));
  }

  function addValue(axis: "x" | "y") {
    const id = newId();
    const patch = (a: MatrixAxis): MatrixAxis => ({
      ...a,
      values: [...a.values, { id, name: "" }],
    });
    if (axis === "x") setXAxis(patch);
    else setYAxis(patch);
    setFocusValueId(id);
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
      if (!xId || !yId) return rest;
      return [...rest, { piece_id: pieceId, x_value_id: xId, y_value_id: yId }];
    });
  }

  const axisEditor = (label: string, axis: MatrixAxis, kind: "x" | "y") => (
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
            placeholder="取值名称"
            autoFocus={focusValueId === v.id}
            onChange={(e) => renameValue(kind, v.id, e.target.value)}
            onBlur={() => {
              if (focusValueId === v.id) setFocusValueId(null);
            }}
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
      <DraftRemoteBanner
        show={draft.dirty && draft.remoteChanged}
        onAccept={draft.acceptRemote}
      />
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

      <EditorActions
        saving={saving}
        saveLabel="保存矩阵"
        error={error}
        onSave={() =>
          save((value) => ({
            type: "set_matrix",
            structure: {
              type: "matrix",
              perspective_id: perspectiveId,
              x_axis: value.xAxis,
              y_axis: value.yAxis,
              coordinates: value.coordinates,
            },
          }))
        }
      />
    </div>
  );
}
