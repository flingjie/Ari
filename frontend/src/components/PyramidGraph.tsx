import type { Pyramid } from "../lib/types";

export function PyramidGraph({
  pyramid,
  pieces,
}: {
  pyramid: Pyramid;
  pieces: { id: string; text: string }[];
}) {
  const text = new Map(pieces.map((p) => [p.id, p.text]));
  return (
    <div className="pyramid">
      <div className="pyramid-layer pyramid-layer--conclusion">
        <h3>结论</h3>
        <p>{pyramid.conclusion || "（缺结论）"}</p>
      </div>
      <div className="pyramid-layer pyramid-layer--points">
        <h3>要点</h3>
        {pyramid.points.map((pt) => (
          <div key={pt.id} className="pyramid-point">
            <div className="pyramid-point__head">
              <b>{pt.text}</b>
              {pt.evidence.length === 0 ? (
                <span className="pyramid-missing">缺证据</span>
              ) : null}
            </div>
            {pt.evidence.length ? (
              <div className="pyramid-point__evidence">
                {pt.evidence.map((e) => (
                  <span key={e} className="graph-card">
                    {text.get(e) ?? e}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
