from __future__ import annotations

import json
from typing import Literal

from ..models import WorkspaceSnapshot

RecommendChart = Literal["flow", "venn", "matrix", "pyramid", "logic_tree"]

RECOMMEND_CHARTS: tuple[RecommendChart, ...] = (
    "flow",
    "venn",
    "matrix",
    "pyramid",
    "logic_tree",
)

_TYPE_TO_CHART: dict[str, RecommendChart] = {
    "flow": "flow",
    "sets": "venn",
    "matrix": "matrix",
    "pyramid": "pyramid",
    "logic_tree": "logic_tree",
}


class RecommendChartError(ValueError):
    def __init__(self, message: str, recovery: str) -> None:
        super().__init__(message)
        self.recovery = recovery


def existing_charts(
    snapshot: WorkspaceSnapshot, perspective_id: str
) -> list[RecommendChart]:
    seen: list[RecommendChart] = []
    for v in snapshot.visualizations:
        if v.perspective_id != perspective_id:
            continue
        chart = _TYPE_TO_CHART.get(v.type)
        if chart and chart not in seen:
            seen.append(chart)
    return seen


def build_recommend_context(
    snapshot: WorkspaceSnapshot, perspective_id: str
) -> dict[str, str]:
    perspective = snapshot.perspective(perspective_id)
    if perspective is None:
        raise RecommendChartError(
            f"视角不存在: {perspective_id}",
            recovery="请选择一个有效视角后再试",
        )
    pieces = [
        {"id": p.id, "text": p.text, "kind": p.kind}
        for p in snapshot.pieces
        if p.parent_id is not None  # 跳过主题根，减噪；若全树需要可改为全部
    ]
    pillars = [
        p.model_dump()
        for p in snapshot.pillars
        if p.perspective_id == perspective_id
    ]
    existing = existing_charts(snapshot, perspective_id)
    return {
        "purpose": snapshot.purpose,
        "perspective_name": perspective.name,
        "perspective_reason": perspective.reason,
        "pieces_json": json.dumps(pieces, ensure_ascii=False),
        "pillars_json": json.dumps(pillars, ensure_ascii=False),
        "existing_charts_json": json.dumps(existing, ensure_ascii=False),
        "candidates": "、".join(RECOMMEND_CHARTS),
    }
