import type { RecommendChart } from "./types";

const ALL: RecommendChart[] = [
  "flow",
  "venn",
  "matrix",
  "pyramid",
  "logic_tree",
];

export function editorParamToRecommendChart(
  param: string | null,
): RecommendChart | null {
  if (!param) return null;
  if (param === "sets") return "venn";
  if (param === "flow" || param === "matrix" || param === "pyramid" || param === "logic_tree") {
    return param;
  }
  return null;
}

export function resolveActiveChart(input: {
  editorParam: string | null;
  manualChart: RecommendChart | null;
  recommended: RecommendChart | null;
  existingCharts: RecommendChart[];
}): RecommendChart {
  const fromUrl = editorParamToRecommendChart(input.editorParam);
  if (fromUrl) return fromUrl;
  if (input.manualChart && ALL.includes(input.manualChart)) return input.manualChart;
  if (input.recommended && ALL.includes(input.recommended)) return input.recommended;
  if (input.existingCharts.length > 0) return input.existingCharts[0]!;
  return "flow";
}

export const RECOMMEND_CHART_LABELS: Record<RecommendChart, string> = {
  flow: "流程 / 循环",
  venn: "维恩集合",
  matrix: "矩阵",
  pyramid: "金字塔",
  logic_tree: "逻辑树",
};
