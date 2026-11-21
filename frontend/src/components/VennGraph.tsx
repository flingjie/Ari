import type { SetsStructure } from "../lib/types";

export function VennGraph({
  sets,
  pieces,
}: {
  sets: SetsStructure;
  pieces: { id: string; text: string }[];
}) {
  const text = new Map(pieces.map((p) => [p.id, p.text]));
  const region = (r: "a" | "b" | "both") =>
    sets.members.filter((m) => m.region === r).map((m) => text.get(m.piece_id) ?? m.piece_id);

  const columns = [
    { name: sets.set_a.name || "集合 A", items: region("a") },
    { name: "交集", items: region("both") },
    { name: sets.set_b.name || "集合 B", items: region("b") },
  ];

  return (
    <div className="venn">
      {columns.map((c) => (
        <section key={c.name} className="venn-column">
          <h3>{c.name}</h3>
          {c.items.length === 0 ? (
            <p className="graph-empty">暂无材料</p>
          ) : (
            c.items.map((t, i) => (
              <div key={i} className="graph-card">
                {t}
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
