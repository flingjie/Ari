"""示例工作区初始化：空工作区 + 教程案例（对齐 ari-demo.html 的预置数据）。"""

from __future__ import annotations

from ..models import Assignment, Perspective, Piece, Pillar, WorkspaceSnapshot


def empty_snapshot() -> WorkspaceSnapshot:
    """空白工作区：只有根节点，无视角/支柱/材料。"""
    return WorkspaceSnapshot(
        purpose="",
        root_id="root",
        pieces=[Piece(id="root", parent_id=None, text="未命名主题", order=0)],
        perspectives=[],
        pillars=[],
        assignments=[],
    )


def tutorial_snapshot() -> WorkspaceSnapshot:
    """教程案例：读者反馈判断（含两张视角卡与分组，用于演示与验收脚本）。"""
    pieces = [
        Piece(id="root", parent_id=None, text="分享后的反馈", order=0),
        Piece(id="p-star", parent_id="root", text="分享后有 6 个 star", order=0, source="帖子"),
        Piece(id="p-reply", parent_id="root", text="帖子有 3 条回复", order=1, source="帖子"),
        Piece(
            id="p-unknown",
            parent_id="root",
            text="还不知道有没有人跑通示例",
            order=2,
            source="帖子",
        ),
    ]
    perspectives = [
        Perspective(
            id="v-adoption",
            name="按采用阶段",
            reason="沿着读者从关注到尝试的过程，寻找缺少反馈的环节。",
        ),
        Perspective(
            id="v-evidence",
            name="按证据强弱",
            reason="把观察和待验证的判断分开，决定接下来要核实什么。",
        ),
    ]
    pillars = [
        Pillar(id="pl-interest", perspective_id="v-adoption", name="产生兴趣", order=0),
        Pillar(id="pl-try", perspective_id="v-adoption", name="动手尝试", order=1),
        Pillar(id="pl-keep", perspective_id="v-adoption", name="持续使用", order=2),
        Pillar(id="pl-observed", perspective_id="v-evidence", name="已观察到", order=0),
        Pillar(id="pl-verify", perspective_id="v-evidence", name="待验证", order=1),
    ]
    assignments = [
        Assignment(perspective_id="v-adoption", piece_id="p-star", pillar_id="pl-interest"),
        Assignment(perspective_id="v-evidence", piece_id="p-star", pillar_id="pl-observed"),
        Assignment(perspective_id="v-evidence", piece_id="p-reply", pillar_id="pl-observed"),
        Assignment(perspective_id="v-evidence", piece_id="p-unknown", pillar_id="pl-verify"),
    ]
    return WorkspaceSnapshot(
        purpose="下一次分享后，怎样判断读者是否实际用过教程？",
        root_id="root",
        active_perspective_id="v-adoption",
        pieces=pieces,
        perspectives=perspectives,
        pillars=pillars,
        assignments=assignments,
    )


def build_snapshot(template: str | None) -> WorkspaceSnapshot:
    """按模板名构建初始快照；空或未知 → 空工作区。"""
    if template == "tutorial":
        return tutorial_snapshot()
    return empty_snapshot()
