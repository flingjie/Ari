import { useState } from "react";
import { useGroupedView } from "../lib/useGroupedView";
import type { Perspective } from "../lib/types";

export function PerspectiveCard({
  perspective,
  active,
  workspaceId,
  revision,
  onSelect,
}: {
  perspective: Perspective;
  active: boolean;
  workspaceId: string;
  revision: number;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(active);
  const { view, status, error } = useGroupedView(
    workspaceId,
    perspective.id,
    revision,
    expanded,
  );

  const summary = (() => {
    if (!view) return null;
    const pillarNames = view.pillars.map((p) => p.name);
    const counts = view.pillars.map((p) => p.pieces.length);
    const unassignedCount = view.unassigned.length;
    const samples = view.pillars
      .flatMap((p) => p.pieces.slice(0, 2).map((x) => x.text))
      .concat(view.unassigned.slice(0, 2).map((x) => x.text))
      .slice(0, 4);
    return { pillarNames, counts, unassignedCount, samples };
  })();

  return (
    <div
      className="perspective-card"
      data-expanded={expanded}
      aria-pressed={active ? "true" : "false"}
    >
      <button className="perspective-card__main" onClick={() => setExpanded((v) => !v)}>
        <b>{perspective.name}</b>
        {perspective.reason ? (
          <span className="perspective-card__reason">能回答的问题 · {perspective.reason}</span>
        ) : null}
      </button>

      {expanded ? (
        <div className="perspective-preview">
          {status === "loading" ? <p>加载中…</p> : null}
          {status === "error" ? <p className="perspective-preview__error">{error}</p> : null}
          {summary ? (
            <>
              <ul>
                {summary.pillarNames.map((name, i) => (
                  <li key={name}>
                    {name} · {summary.counts[i]} 件
                  </li>
                ))}
                <li>待归类 · {summary.unassignedCount} 件</li>
              </ul>
              {summary.samples.length ? (
                <p className="perspective-preview__samples">如：{summary.samples.join("、")}</p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <button
        className="primary"
        onClick={() => onSelect(perspective.id)}
        disabled={active}
      >
        {active ? "当前视角" : "选用"}
      </button>
    </div>
  );
}
