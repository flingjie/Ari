import type { GroupedView } from "../lib/types";

export function GroupedViewGraph({ view }: { view: GroupedView }) {
  const columns: { id: string | null; name: string; pieces: { id: string; text: string }[] }[] =
    [
      ...view.pillars.map((p) => ({ id: p.id as string | null, name: p.name, pieces: p.pieces })),
      { id: null, name: "待归类", pieces: view.unassigned },
    ];
  const n = columns.length;

  return (
    <div className="graph">
      <div className="graph-header">
        <h2>{view.purpose}</h2>
        <span className="graph-perspective">视角 · {view.perspective.name}</span>
      </div>
      <div
        className="graph-body"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(200px, 1fr))` }}
      >
        <svg
          className="graph-links"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line x1="0" y1="12" x2="100" y2="12" />
          {columns.map((c, i) => (
            <line
              key={c.id ?? "__unassigned"}
              x1={((i + 0.5) * 100) / n}
              y1="0"
              x2={((i + 0.5) * 100) / n}
              y2="24"
            />
          ))}
        </svg>
        {columns.map((c) => (
          <section key={c.id ?? "__unassigned"} className="graph-column">
            <h3 className="graph-column-head">{c.name}</h3>
            {c.pieces.length === 0 ? (
              <p className="graph-empty">暂无材料</p>
            ) : (
              c.pieces.map((p) => (
                <div key={p.id} className="graph-card">
                  {p.text}
                </div>
              ))
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
