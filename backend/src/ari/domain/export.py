"""确定性 Markdown 渲染器（outline / table）。

移植 ari-demo.html 中 step 4 的导出逻辑：前端预览与下载都用后端这份文本，
避免两端渲染规则不一致。覆盖空组、待归类、竖线与换行转义。
"""

from __future__ import annotations

import re

from ..models import WorkspaceSnapshot
from .grouping import GroupedViewError, build_grouped_view


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
    if fmt not in ("outline", "table"):
        raise ExportError(f"不支持的格式: {fmt}")
    try:
        view = build_grouped_view(snapshot, perspective_id)
    except GroupedViewError as exc:
        raise ExportError(str(exc)) from None

    table = fmt == "table"
    rows: list[str] = [f"# {view.purpose}", "", f"视角 · {view.perspective.name}", ""]
    if table:
        rows += ["| 支柱 | 材料 |", "| --- | --- |"]

    # 支柱顺序 + 最后的「待归类」（unassigned）。
    groups = [(p.name, p.pieces) for p in view.pillars] + [("待归类", view.unassigned)]
    for group_name, group_pieces in groups:
        items = [p.text for p in group_pieces]
        if not items:
            items = ["暂无材料"]
        if table:
            for item in items:
                rows.append(f"| {_safe_table(group_name)} | {_safe_table(item)} |")
        else:
            rows.append(f"## {_collapse_newlines(group_name)}")
            rows.extend(f"- {_collapse_newlines(item)}" for item in items)
            rows.append("")

    return "\n".join(rows)
