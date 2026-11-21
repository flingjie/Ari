import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { loadChartPrefs, saveChartPrefs, type ChartPrefs } from "../lib/chartPrefs";
import {
  RECOMMEND_CHART_LABELS,
  editorParamToRecommendChart,
  resolveActiveChart,
} from "../lib/resolveActiveChart";
import type {
  Flow,
  LogicTree,
  MatrixStructure,
  Pyramid,
  RecommendChart,
  RecommendChartResult,
  SetsStructure,
} from "../lib/types";
import { FlowEditor } from "./FlowEditor";
import { VennEditor } from "./VennEditor";
import { MatrixEditor } from "./MatrixEditor";
import { PyramidEditor } from "./PyramidEditor";
import { LogicTreeEditor } from "./LogicTreeEditor";

const ALL_CHARTS: RecommendChart[] = ["flow", "venn", "matrix", "pyramid", "logic_tree"];

// 推荐结果的内存缓存：键 workspaceId:perspectiveId:revision。
// 放在模块级，切换视角（组件重挂载）后回来仍可命中。
const recommendCache = new Map<string, RecommendChartResult>();

function cacheKey(workspaceId: string, perspectiveId: string, revision: number): string {
  return `${workspaceId}:${perspectiveId}:${revision}`;
}

function clearPerspectiveCache(workspaceId: string, perspectiveId: string): void {
  const prefix = `${workspaceId}:${perspectiveId}:`;
  for (const k of Array.from(recommendCache.keys())) {
    if (k.startsWith(prefix)) recommendCache.delete(k);
  }
}

type Status = "loading" | "ready" | "error";

export function PillarChartPanel({
  workspaceId,
  revision,
  perspectiveId,
  editorParam,
  onClearEditorParam,
  flow,
  sets,
  matrix,
  pyramid,
  logicTree,
}: {
  workspaceId: string;
  revision: number;
  perspectiveId: string;
  editorParam: string | null;
  /** 用户在本页主动选择图形时，清掉 URL ?editor=，否则 URL 优先级会压住选择。 */
  onClearEditorParam?: () => void;
  flow: Flow | null;
  sets: SetsStructure | null;
  matrix: MatrixStructure | null;
  pyramid: Pyramid | null;
  logicTree: LogicTree | null;
}) {
  const key = cacheKey(workspaceId, perspectiveId, revision);
  const [result, setResult] = useState<RecommendChartResult | null>(
    () => recommendCache.get(key) ?? null,
  );
  const [status, setStatus] = useState<Status>(() =>
    recommendCache.has(key) ? "ready" : "loading",
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prefs, setPrefs] = useState<ChartPrefs>(() =>
    loadChartPrefs(workspaceId, perspectiveId),
  );
  const [refreshNonce, setRefreshNonce] = useState(0);
  const seqRef = useRef(0);

  // 本视角本地已有的结构（接口失败时的降级来源）。
  const localExisting: RecommendChart[] = [];
  if (flow) localExisting.push("flow");
  if (sets) localExisting.push("venn");
  if (matrix) localExisting.push("matrix");
  if (pyramid) localExisting.push("pyramid");
  if (logicTree) localExisting.push("logic_tree");

  // 进入 / 切换视角 / revision 变化时拉取推荐。
  useEffect(() => {
    const cached = recommendCache.get(key);
    if (cached) {
      setResult(cached);
      setStatus("ready");
      return;
    }
    const seq = ++seqRef.current;
    // 已有上一份结果时保持展示（编辑器不卸载，避免丢未保存草稿），仅无结果时显示骨架。
    if (!result) setStatus("loading");
    api
      .recommendChart(workspaceId, revision, perspectiveId)
      .then((r) => {
        if (seqRef.current !== seq) return;
        recommendCache.set(key, r);
        setResult(r);
        setStatus("ready");
      })
      .catch(() => {
        if (seqRef.current !== seq) return;
        setStatus("error");
      });
    // result 故意不入依赖：它只用于决定是否显示骨架。
  }, [key, refreshNonce]);

  useEffect(
    () => () => {
      seqRef.current++;
    },
    [],
  );

  const updatePrefs = useCallback(
    (patch: Partial<ChartPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        saveChartPrefs(workspaceId, perspectiveId, next);
        return next;
      });
    },
    [workspaceId, perspectiveId],
  );

  const ready = status === "ready" && result !== null;
  const recommended = ready ? result.chart : null;
  const existingCharts = ready ? result.existing_charts : localExisting;
  const reason = ready ? result.reason : "";

  const hasConflictShape =
    recommended !== null &&
    existingCharts.length > 0 &&
    !existingCharts.includes(recommended);
  const showConflict =
    ready &&
    hasConflictShape &&
    prefs.manualChart == null &&
    prefs.dismissedConflictAtRevision !== revision;

  // 用户点过「继续编辑现有」后（任意 revision），保持停留在现有结构，
  // 避免保存导致 revision 前进时编辑器被推荐图形顶掉；banner 仅在 revision 变化后再次提示。
  const keepExisting = hasConflictShape && prefs.dismissedConflictAtRevision !== null;

  const active = resolveActiveChart({
    editorParam,
    manualChart: prefs.manualChart,
    recommended: keepExisting ? null : recommended,
    existingCharts,
  });

  function pickChart(chart: RecommendChart) {
    updatePrefs({ manualChart: chart });
    onClearEditorParam?.();
    setPickerOpen(false);
  }

  function useRecommended() {
    if (!recommended) return;
    updatePrefs({ manualChart: recommended, dismissedConflictAtRevision: null });
    onClearEditorParam?.();
  }

  function keepEditingExisting() {
    updatePrefs({ dismissedConflictAtRevision: revision });
    onClearEditorParam?.();
  }

  function rerecommend() {
    clearPerspectiveCache(workspaceId, perspectiveId);
    updatePrefs({ manualChart: null });
    onClearEditorParam?.();
    setResult(null);
    setStatus("loading");
    setRefreshNonce((n) => n + 1);
  }

  if (status === "loading" && !result) {
    return (
      <section className="card" aria-busy="true" aria-label="图形推荐加载中">
        <p>正在推荐合适图形…</p>
        <div
          aria-hidden="true"
          style={{
            height: 120,
            borderRadius: 6,
            background: "rgba(128, 128, 128, 0.15)",
          }}
        />
      </section>
    );
  }

  const urlChart = editorParamToRecommendChart(editorParam);
  const isManual = urlChart === null && prefs.manualChart !== null;
  const title = isManual || urlChart !== null || !ready
    ? `当前：${RECOMMEND_CHART_LABELS[active]}`
    : `推荐：${RECOMMEND_CHART_LABELS[active]}`;
  const otherCharts = ALL_CHARTS.filter((c) => c !== active);

  return (
    <section className="card">
      {showConflict && recommended ? (
        <div role="status" className="chart-conflict-banner">
          <p>
            AI 推荐「{RECOMMEND_CHART_LABELS[recommended]}」，但你已有
            {existingCharts.map((c) => `「${RECOMMEND_CHART_LABELS[c]}」`).join("、")}
            结构。
          </p>
          <button type="button" onClick={useRecommended}>
            改用推荐
          </button>{" "}
          <button type="button" onClick={keepEditingExisting}>
            继续编辑现有
          </button>
        </div>
      ) : null}

      <div>
        <strong>{title}</strong>
        {ready && reason ? <span> — {reason}</span> : null}
        {status === "error" ? <span role="alert"> 推荐暂时不可用</span> : null}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
        >
          换一种图形 {pickerOpen ? "▴" : "▾"}
        </button>{" "}
        <button type="button" onClick={rerecommend}>
          重新推荐
        </button>
      </div>

      {pickerOpen ? (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {otherCharts.map((c) => (
            <li key={c}>
              <button type="button" onClick={() => pickChart(c)}>
                {RECOMMEND_CHART_LABELS[c]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 只挂载当前选中图形的编辑器 */}
      {active === "flow" ? (
        <FlowEditor key="flow" perspectiveId={perspectiveId} flow={flow} onSaved={() => {}} />
      ) : null}
      {active === "venn" ? (
        <VennEditor key="venn" perspectiveId={perspectiveId} sets={sets} onSaved={() => {}} />
      ) : null}
      {active === "matrix" ? (
        <MatrixEditor key="matrix" perspectiveId={perspectiveId} matrix={matrix} onSaved={() => {}} />
      ) : null}
      {active === "pyramid" ? (
        <PyramidEditor key="pyramid" perspectiveId={perspectiveId} pyramid={pyramid} onSaved={() => {}} />
      ) : null}
      {active === "logic_tree" ? (
        <LogicTreeEditor key="logic_tree" perspectiveId={perspectiveId} tree={logicTree} onSaved={() => {}} />
      ) : null}
    </section>
  );
}
