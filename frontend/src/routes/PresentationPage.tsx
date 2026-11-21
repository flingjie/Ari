import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useWorkspace } from "../store/workspace";
import { useGroupedView } from "../lib/useGroupedView";
import { useVisualization } from "../lib/useVisualization";
import { loadChartPrefs, saveChartPrefs } from "../lib/chartPrefs";
import { GroupedViewGraph } from "../components/GroupedViewGraph";
import { ChartSelector } from "../components/ChartSelector";
import { FlowGraph } from "../components/FlowGraph";
import { VennGraph } from "../components/VennGraph";
import { MatrixGraph } from "../components/MatrixGraph";
import { PyramidGraph } from "../components/PyramidGraph";
import { LogicTreeGraph } from "../components/LogicTreeGraph";
import type { ChartType, FillTarget } from "../lib/types";

type PresentationFormat = "outline" | "table" | "chart";

const CHART_TO_EDITOR: Record<ChartType, string> = {
  classification: "flow",
  flow: "flow",
  cycle: "flow",
  venn: "sets",
  matrix: "matrix",
  pyramid: "pyramid",
  logic_tree: "logic_tree",
};

export default function PresentationPage() {
  const { snapshot, revision, workspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [format, setFormat] = useState<PresentationFormat>("outline");
  const [selectedChart, setSelectedChart] = useState<ChartType>("classification");
  const [content, setContent] = useState("");
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const [error, setError] = useState("");

  const perspectiveId = snapshot?.active_perspective_id ?? null;

  // 载入图形偏好；若带返回定位则恢复并清除。
  useEffect(() => {
    if (!workspaceId || !perspectiveId) return;
    const prefs = loadChartPrefs(workspaceId, perspectiveId);
    if (prefs.returnTarget && prefs.returnTarget.perspectiveId === perspectiveId) {
      setSelectedChart(prefs.returnTarget.chart);
      prefs.returnTarget = null;
      saveChartPrefs(workspaceId, perspectiveId, prefs);
    } else {
      setSelectedChart(prefs.selected);
    }
  }, [workspaceId, perspectiveId]);

  const grouped = useGroupedView(workspaceId, perspectiveId, revision, format === "chart");
  const viz = useVisualization(workspaceId, perspectiveId, revision, format === "chart");

  useEffect(() => {
    if (format === "chart") {
      setContent("");
      setError("");
      return;
    }
    if (!snapshot || !workspaceId || !perspectiveId) {
      setContent("");
      setError("");
      return;
    }
    let cancelled = false;
    api
      .export(workspaceId, revision, perspectiveId, format)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setPreviewRevision(res.revision);
        setError("");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError && e.status === 409
            ? "内容已更新，预览即将刷新"
            : "预览失败，请重试",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot, revision, format, workspaceId, perspectiveId]);

  function download() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ari-notes.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function selectChart(chart: ChartType) {
    setSelectedChart(chart);
    if (workspaceId && perspectiveId) {
      const prefs = loadChartPrefs(workspaceId, perspectiveId);
      prefs.selected = chart;
      saveChartPrefs(workspaceId, perspectiveId, prefs);
    }
  }

  function fillChart(chart: ChartType, target: FillTarget) {
    if (workspaceId && perspectiveId) {
      const prefs = loadChartPrefs(workspaceId, perspectiveId);
      prefs.returnTarget = { chart, perspectiveId };
      saveChartPrefs(workspaceId, perspectiveId, prefs);
    }
    navigate(`/w/${workspaceId}/${target}?editor=${CHART_TO_EDITOR[chart]}`);
  }

  if (!snapshot) return null;

  if (!perspectiveId) {
    return (
      <div className="card">
        <p>还没有选择视角，无法预览。</p>
        <p>
          <Link to={`/w/${workspaceId}/perspective`}>去选视角</Link>
        </p>
      </div>
    );
  }

  const pieces = snapshot.pieces
    .filter((p) => p.id !== snapshot.root_id)
    .map((p) => ({ id: p.id, text: p.text }));

  return (
    <div>
      <div className="actions">
        <select
          aria-label="表达形式"
          value={format}
          onChange={(e) => setFormat(e.target.value as PresentationFormat)}
        >
          <option value="outline">提纲</option>
          <option value="table">Markdown 表格</option>
          <option value="chart">图形</option>
        </select>
        <small>
          预览版本 r{format === "chart" ? revision : (previewRevision ?? revision)}
          {format !== "chart" && previewRevision !== null && previewRevision !== revision
            ? "（待刷新）"
            : ""}
        </small>
        <button
          className="primary"
          onClick={download}
          disabled={!content || format === "chart"}
        >
          下载 Markdown
        </button>
      </div>

      {format === "chart" ? (
        <>
          {viz.status === "loading" ? <div className="card">加载中…</div> : null}
          {viz.status === "error" ? (
            <p className="sync-status error">{viz.error}</p>
          ) : null}
          {viz.status === "ready" && viz.view ? (
            <>
              <ChartSelector
                view={viz.view}
                selected={selectedChart}
                onSelect={selectChart}
                onFill={fillChart}
              />
              {selectedChart === "classification" ? (
                grouped.status === "ready" && grouped.view ? (
                  <GroupedViewGraph view={grouped.view} />
                ) : null
              ) : selectedChart === "flow" || selectedChart === "cycle" ? (
                viz.view?.flow ? (
                  <FlowGraph flow={viz.view.flow} variant={selectedChart} />
                ) : (
                  <div className="card">尚未定义流程，请到支柱页补齐</div>
                )
              ) : selectedChart === "venn" ? (
                viz.view?.sets ? (
                  <VennGraph sets={viz.view.sets} pieces={pieces} />
                ) : (
                  <div className="card">尚未定义集合，请到支柱页补齐</div>
                )
              ) : selectedChart === "matrix" ? (
                viz.view?.matrix ? (
                  <MatrixGraph matrix={viz.view.matrix} pieces={pieces} />
                ) : (
                  <div className="card">尚未定义矩阵，请到支柱页补齐</div>
                )
              ) : selectedChart === "pyramid" ? (
                viz.view?.pyramid ? (
                  <PyramidGraph pyramid={viz.view.pyramid} pieces={pieces} />
                ) : (
                  <div className="card">尚未定义金字塔，请到支柱页补齐</div>
                )
              ) : selectedChart === "logic_tree" ? (
                viz.view?.logic_tree ? (
                  <LogicTreeGraph tree={viz.view.logic_tree} pieces={pieces} />
                ) : (
                  <div className="card">尚未定义逻辑树，请到支柱页补齐</div>
                )
              ) : (
                <div className="card">该图形的编辑器将在后续版本提供</div>
              )}
            </>
          ) : null}
        </>
      ) : (
        <>
          {error ? <p className="sync-status error">{error}</p> : null}
          <pre className="card">{content}</pre>
        </>
      )}
    </div>
  );
}
