import type {
  ChartStatus,
  ChartType,
  FillTarget,
  VisualizationView,
} from "../lib/types";

const CHART_NAMES: Record<ChartType, string> = {
  classification: "分类图",
  flow: "流程图",
  cycle: "循环图",
  venn: "维恩图",
  matrix: "矩阵图",
  pyramid: "金字塔图",
  logic_tree: "逻辑树",
};

export function ChartSelector({
  view,
  selected,
  onSelect,
  onFill,
}: {
  view: VisualizationView;
  selected: ChartType;
  onSelect: (chart: ChartType) => void;
  onFill: (chart: ChartType, target: FillTarget) => void;
}) {
  return (
    <div className="chart-selector">
      {view.charts.map((c) => (
        <ChartEntry
          key={c.chart}
          status={c}
          selected={selected === c.chart}
          onSelect={onSelect}
          onFill={onFill}
        />
      ))}
    </div>
  );
}

function ChartEntry({
  status,
  selected,
  onSelect,
  onFill,
}: {
  status: ChartStatus;
  selected: boolean;
  onSelect: (chart: ChartType) => void;
  onFill: (chart: ChartType, target: FillTarget) => void;
}) {
  const previewable = status.status !== "missing";
  return (
    <div className="chart-entry" data-selected={selected} data-status={status.status}>
      <button
        className="chart-entry__main"
        disabled={!previewable}
        aria-pressed={selected ? "true" : "false"}
        onClick={() => onSelect(status.chart)}
      >
        <span>{CHART_NAMES[status.chart]}</span>
        <span className={`chart-badge ${previewable ? "chart-badge--ok" : "chart-badge--missing"}`}>
          {previewable ? "可预览" : "待补充"}
        </span>
      </button>
      {status.missing.length ? (
        <div className="chart-entry__missing">
          <ul>
            {status.missing.map((m) => (
              <li key={m.code}>{m.message}</li>
            ))}
          </ul>
          {!previewable ? (
            <button onClick={() => onFill(status.chart, status.missing[0]?.target ?? "pillar")}>
              去补齐
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
