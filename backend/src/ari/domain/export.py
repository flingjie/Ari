"""确定性 Markdown 渲染器（outline / table）。

移植 ari-demo.html 中 step 4 的导出逻辑：前端预览与下载都用后端这份文本，
避免两端渲染规则不一致。覆盖空组、待归类、竖线与换行转义。
"""

from __future__ import annotations

import re

from ..models import WorkspaceSnapshot


class ExportError(ValueError):
    """导出参数非法。"""


def _collapse_newlines(text: str) -> str:
    """把换行及两侧空白折叠为单个空格，保持列表/表格结构。"""
    return re.sub(r"\s*\n\s*", " ", text)


def _safe_table(text: str) -> str:
    """表格单元格：转义竖线 + 折叠换行。"""
    return _collapse_newlines(text).replace("|", "\\|")


def render(snapshot: WorkspaceSnapshot, perspective_id: str, fmt: str) -> str:
    """按指定视角渲染 Markdown。``fmt`` 为 ``outline`` 或 ``table``。"""
    perspective = snapshot.perspective(perspective_id)
    if perspective is None:
        raise ExportError(f"视角不存在: {perspective_id}")
    if fmt not in ("outline", "table"):
        raise ExportError(f"不支持的格式: {fmt}")

    table = fmt == "table"
    rows: list[str] = [f"# {snapshot.purpose}", "", f"视角 · {perspective.name}", ""]
    if table:
        rows += ["| 支柱 | 材料 |", "| --- | --- |"]

    # 非根片段按 order 排序（保持采集顺序）。
    pieces = sorted(
        (p for p in snapshot.pieces if p.id != snapshot.root_id),
        key=lambda p: (p.order, p.id),
    )
    pillars = sorted(
        (p for p in snapshot.pillars if p.perspective_id == perspective_id),
        key=lambda p: (p.order, p.id),
    )
    assign = {
        a.piece_id: a.pillar_id
        for a in snapshot.assignments
        if a.perspective_id == perspective_id
    }

    def members(pillar_id: str | None) -> list[str]:
        return [p.text for p in pieces if assign.get(p.id) == pillar_id]

    # 支柱顺序 + 最后的「待归类」（None）。
    for pillar in [*pillars, None]:
        group = pillar.name if pillar is not None else "待归类"
        items = members(pillar.id if pillar is not None else None)
        if not items:
            items = ["暂无材料"]
        if table:
            for item in items:
                rows.append(f"| {_safe_table(group)} | {_safe_table(item)} |")
        else:
            rows.append(f"## {_collapse_newlines(group)}")
            rows.extend(f"- {_collapse_newlines(item)}" for item in items)
            rows.append("")

    return "\n".join(rows)
