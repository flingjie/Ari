import type { MatrixStructure } from "../lib/types";

export function MatrixGraph({
  matrix,
  pieces,
}: {
  matrix: MatrixStructure;
  pieces: { id: string; text: string }[];
}) {
  const text = new Map(pieces.map((p) => [p.id, p.text]));
  const placedIds = new Set(matrix.coordinates.map((c) => c.piece_id));
  const xValues = matrix.x_axis.values;
  const yValues = matrix.y_axis.values;

  const cellPieces = (xId: string, yId: string) =>
    matrix.coordinates
      .filter((c) => c.x_value_id === xId && c.y_value_id === yId)
      .map((c) => text.get(c.piece_id) ?? c.piece_id);

  const unplaced = pieces.filter((p) => !placedIds.has(p.id));

  return (
    <div className="matrix">
      <div className="matrix-scroll">
        <table className="matrix-grid">
          <thead>
            <tr>
              <th>{matrix.y_axis.name || "纵轴"}</th>
              {xValues.map((v) => (
                <th key={v.id}>{v.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {yValues.map((y) => (
              <tr key={y.id}>
                <th>{y.name}</th>
                {xValues.map((x) => {
                  const items = cellPieces(x.id, y.id);
                  return (
                    <td key={x.id}>
                      {items.length
                        ? items.map((t, i) => (
                            <div key={i} className="matrix-cell-piece">
                              {t}
                            </div>
                          ))
                        : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="matrix-unplaced">
        <h4>未定位（{unplaced.length}）</h4>
        {unplaced.length === 0 ? (
          <p className="graph-empty">全部已定位</p>
        ) : (
          unplaced.map((p) => (
            <span key={p.id} className="graph-card">
              {p.text}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
