import { useId } from "react";
import type { Flow } from "../lib/types";

const NODE_W = 240;
const NODE_H = 68;
const GAP = 44;
const PITCH = NODE_H + GAP;

export function FlowGraph({
  flow,
  variant = "flow",
}: {
  flow: Flow;
  variant?: "flow" | "cycle";
}) {
  const markerId = useId();
  const steps = flow.steps;
  const idx = new Map(steps.map((s, i) => [s.id, i]));

  // 有显式分支则用分支，否则线性流程按相邻步骤生成边。
  const edges = flow.branches.length
    ? flow.branches.map((b) => ({
        key: b.id,
        from: b.from_step_id,
        to: b.to_step_id,
        label: b.condition,
      }))
    : steps
        .slice(0, -1)
        .map((s, i) => ({ key: `adj-${i}`, from: s.id, to: steps[i + 1].id, label: "" }));

  const totalH = steps.length * PITCH;
  const cx = NODE_W / 2;
  const laneX = NODE_W + 28;

  return (
    <div className="flow">
      <div className="flow-canvas" style={{ height: totalH }}>
        <svg
          className="flow-links"
          width={NODE_W + 120}
          height={totalH}
          viewBox={`0 0 ${NODE_W + 120} ${totalH}`}
          aria-hidden="true"
        >
          <defs>
            <marker
              id={markerId}
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" className="flow-arrow" />
            </marker>
          </defs>

          {edges.map((e, i) => {
            const a = idx.get(e.from);
            const b = idx.get(e.to);
            if (a === undefined || b === undefined) return null;
            const y1 = a * PITCH + NODE_H;
            const y2 = b * PITCH;
            let d: string;
            let labelX = cx;
            let labelY = (y1 + y2) / 2;
            if (b === a + 1) {
              d = `M ${cx} ${y1} L ${cx} ${y2}`;
            } else {
              const x = laneX + (i % 3) * 22;
              d = `M ${cx} ${y1} L ${x} ${y1} L ${x} ${y2} L ${cx} ${y2}`;
              labelX = x + 6;
            }
            return (
              <g key={e.key}>
                <path d={d} className="flow-edge" markerEnd={`url(#${markerId})`} />
                {e.label ? (
                  <text x={labelX} y={labelY} className="flow-edge-label">
                    {e.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {variant === "cycle"
            ? flow.feedback.map((f, i) => {
                const a = idx.get(f.from_step_id);
                const b = idx.get(f.to_step_id);
                if (a === undefined || b === undefined) return null;
                const y1 = a * PITCH + NODE_H / 2;
                const y2 = b * PITCH + NODE_H / 2;
                const x = 16 + i * 22;
                const d = `M ${cx - NODE_W / 2} ${y1} L ${x} ${y1} L ${x} ${y2} L ${cx - NODE_W / 2} ${y2}`;
                return (
                  <g key={f.id}>
                    <path d={d} className="flow-edge flow-edge--feedback" markerEnd={`url(#${markerId})`} />
                    {f.meaning ? (
                      <text x={x + 6} y={(y1 + y2) / 2} className="flow-edge-label">
                        {f.meaning}
                      </text>
                    ) : null}
                  </g>
                );
              })
            : null}
        </svg>

        {steps.map((s, i) => (
          <div
            key={s.id}
            className="flow-node"
            style={{ top: i * PITCH, width: NODE_W }}
          >
            <span className="flow-node__order">{i + 1}</span>
            <span className="flow-node__text">{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
