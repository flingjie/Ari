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

  // revision 只在拉取时读取（缓存键 / 跨访问新鲜度），不作为触发依赖：
  // 停留在本页时 pillar/assign 保存导致 revision 前进，不应重跑 LLM 请求。
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const scopeRef = useRef(`${workspaceId}:${perspectiveId}`);

  // 仅在进入 / 切换工作区或视角 / 点击「重新推荐」时拉取推荐。
  useEffect(() => {
    const scope = `${workspaceId}:${perspectiveId}`;
    const scopeChanged = scopeRef.current !== scope;
    scopeRef.current = scope;
    const fetchRevision = revisionRef.current;
    const fetchKey = cacheKey(workspaceId, perspectiveId, fetchRevision);
    // 无论是否命中缓存都使旧的在途请求失效，避免其覆盖新 key 的状态。
    const seq = ++seqRef.current;
    const cached = recommendCache.get(fetchKey);
    if (cached) {
      setResult(cached);
      setStatus("ready");
      return;
    }
    // 切换视角时旧结果不属于新视角，必须清掉；同视角（含重新推荐）保持展示旧结果，
    // 编辑器不卸载，避免丢未保存草稿。
    let hasResult = result !== null;
    if (scopeChanged) {
      setResult(null);
      hasResult = false;
    }
    setStatus(hasResult ? "ready" : "loading");
    api
      .recommendChart(workspaceId, fetchRevision, perspectiveId)
      .then((r) => {
        if (seqRef.current !== seq) return;
        recommendCache.set(fetchKey, r);
        setResult(r);
        setStatus("ready");
      })
      .catch(() => {
        if (seqRef.current !== seq) return;
        setStatus("error");
      });
    // result / revision 故意不入依赖：result 仅用于决定是否显示骨架，revision 不触发重新拉取。
  }, [workspaceId, perspectiveId, refreshNonce]);

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
  // 以实时快照 props 为准，与（可能已过期的）接口返回取并集。
  const existingCharts: RecommendChart[] = ready
    ? ALL_CHARTS.filter(
        (c) => localExisting.includes(c) || result.existing_charts.includes(c),
      )
    : localExisting;
  const reason = ready ? result.reason : "";

  const hasConflictShape =
    recommended !== null &&
    existingCharts.length > 0 &&
    !existingCharts.includes(recommended);
  const showConflict =
    ready &&
    hasConflictShape &&
    prefs.manualChart == null &&
    prefs.dismissedConflictAtRevision === null;

  // 用户点过「继续编辑现有」后（任意 revision），保持停留在现有结构，
  // 避免保存导致 revision 前进时编辑器被推荐图形顶掉；
  // 已忽略后 revision 前进不再重复提示，仅「重新推荐」清除忽略状态后才可能再次出现 banner。
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
    updatePrefs({ manualChart: null, dismissedConflictAtRevision: null });
    onClearEditorParam?.();
    // 不清 result：重新拉取期间继续展示旧结果，避免编辑器被骨架顶掉。
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
