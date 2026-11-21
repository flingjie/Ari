import type { ChartType, RecommendChart } from "./types";

// 图形选择、折叠与布局偏好按工作区×视角记录在客户端（localStorage），不入快照。

export interface ChartPrefs {
  selected: ChartType;
  collapsed: Record<string, boolean>;
  layout: Record<string, string>;
  returnTarget: { chart: ChartType; perspectiveId: string } | null;
  manualChart: RecommendChart | null;
  dismissedConflictAtRevision: number | null;
}

const DEFAULTS: ChartPrefs = {
  selected: "classification",
  collapsed: {},
  layout: {},
  returnTarget: null,
  manualChart: null,
  dismissedConflictAtRevision: null,
};

export function chartPrefsKey(workspaceId: string, perspectiveId: string): string {
  return `ari:chart-prefs:${workspaceId}:${perspectiveId}`;
}

export function loadChartPrefs(workspaceId: string, perspectiveId: string): ChartPrefs {
  try {
    const raw = localStorage.getItem(chartPrefsKey(workspaceId, perspectiveId));
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ChartPrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveChartPrefs(
  workspaceId: string,
  perspectiveId: string,
  prefs: ChartPrefs,
): void {
  try {
    localStorage.setItem(chartPrefsKey(workspaceId, perspectiveId), JSON.stringify(prefs));
  } catch {
    // 忽略存储失败（隐私模式/配额）。
  }
}
