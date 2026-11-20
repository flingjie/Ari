"""确定性 Markdown 渲染器测试。"""

import pytest

from ari.domain.export import ExportError, render
from ari.domain.operations import AddPiece, apply
from ari.domain.seed import tutorial_snapshot


def test_outline():
    s = tutorial_snapshot()
    out = render(s, "v-adoption", "outline")
    assert out.startswith("# 下一次分享后")
    assert "视角 · 按采用阶段" in out
    assert "## 产生兴趣" in out
    assert "- 分享后有 6 个 star" in out
    assert "## 动手尝试" in out
    assert "暂无材料" in out
    assert "## 待归类" in out


def test_table_escapes_pipe():
    s = tutorial_snapshot()
    apply(s, AddPiece(id="p-pipe", parent_id="root", text="a|b"))
    out = render(s, "v-adoption", "table")
    assert "| 支柱 | 材料 |" in out
    assert "a\\|b" in out


def test_invalid_perspective():
    s = tutorial_snapshot()
    with pytest.raises(ExportError):
        render(s, "nope", "outline")


def test_invalid_format():
    s = tutorial_snapshot()
    with pytest.raises(ExportError):
        render(s, "v-adoption", "pdf")
