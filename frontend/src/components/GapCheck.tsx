import type { GroupedView, Snapshot } from "../lib/types";

/** 支柱材料缺口只读诊断：数量 ≠ 质量。 */
export function GapCheck({
  view,
  snapshot,
}: {
  view: GroupedView;
  snapshot: Snapshot;
}) {
  const byId = new Map(snapshot.pieces.map((p) => [p.id, p]));

  const rows = view.pillars.map((pillar) => {
    let withSource = 0;
    let quotes = 0;
    let inferredOnly = 0;
    for (const gp of pillar.pieces) {
      const full = byId.get(gp.id);
      if (!full) continue;
      if (full.source.trim()) withSource += 1;
      if (full.kind === "quote") quotes += 1;
      else inferredOnly += 1;
    }
    const gaps: string[] = [];
    if (pillar.pieces.length === 0) gaps.push("尚无材料");
    else {
      if (quotes === 0) gaps.push("缺少原话/例子");
      if (withSource === 0) gaps.push("均无来源");
      if (inferredOnly > 0 && quotes === 0) gaps.push("仅有推测");
    }
    return {
      id: pillar.id,
      name: pillar.name,
      total: pillar.pieces.length,
      withSource,
      quotes,
      gaps,
    };
  });

  const unassigned = view.unassigned.length;

  return (
    <div className="gap-check">
      <h3 className="gap-check-title">检查缺口</h3>
      <p className="gap-check-lead">
        看每个支柱有没有站得住的材料，而不是节点够不够多。
      </p>
      {unassigned > 0 ? (
        <p className="gap-check-unassigned">还有 {unassigned} 条待归类。</p>
      ) : null}
      <table className="gap-check-table">
        <thead>
          <tr>
            <th>支柱</th>
            <th>材料</th>
            <th>原话</th>
            <th>有来源</th>
            <th>还缺什么</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-empty={r.gaps.length > 0 ? "true" : "false"}>
              <td>{r.name}</td>
              <td>{r.total}</td>
              <td>{r.quotes}</td>
              <td>{r.withSource}</td>
              <td>{r.gaps.length ? r.gaps.join("；") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
