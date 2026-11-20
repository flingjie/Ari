"""领域操作与校验测试。"""

import pytest

from ari.domain.operations import (
    AddPiece,
    AssignPiece,
    OperationError,
    RemovePiece,
    RemovePillar,
    RenamePillar,
    SetPurpose,
    UpdatePiece,
    apply,
    apply_all,
)
from ari.domain.seed import tutorial_snapshot


def test_set_purpose():
    s = tutorial_snapshot()
    apply(s, SetPurpose(text="新目的"))
    assert s.purpose == "新目的"


def test_add_piece_requires_existing_parent():
    s = tutorial_snapshot()
    with pytest.raises(OperationError, match="片段不存在"):
        apply(s, AddPiece(id="x", parent_id="nope", text="t"))


def test_add_piece_and_update():
    s = tutorial_snapshot()
    apply(s, AddPiece(id="child", parent_id="p-star", text="子片段"))
    assert s.piece("child") is not None
    assert s.piece("child").parent_id == "p-star"
    apply(s, UpdatePiece(piece_id="child", text="改写"))
    assert s.piece("child").text == "改写"


def test_remove_piece_deletes_subtree_and_assignments():
    s = tutorial_snapshot()
    apply(s, AddPiece(id="g1", parent_id="p-star", text="孙"))
    apply(s, AssignPiece(perspective_id="v-adoption", piece_id="g1", pillar_id="pl-try"))
    # p-star 在 v-evidence 已归属 pl-observed
    apply(s, RemovePiece(piece_id="p-star"))
    assert s.piece("p-star") is None
    assert s.piece("g1") is None  # 子树一并删除
    assert all(a.piece_id != "p-star" for a in s.assignments)
    assert all(a.piece_id != "g1" for a in s.assignments)


def test_remove_root_rejected():
    s = tutorial_snapshot()
    with pytest.raises(OperationError, match="根节点"):
        apply(s, RemovePiece(piece_id=s.root_id))


def test_assign_piece_requires_same_perspective_pillar():
    s = tutorial_snapshot()
    # pl-observed 属于 v-evidence，不能用于 v-adoption
    with pytest.raises(OperationError, match="不属于该视角"):
        apply(
            s,
            AssignPiece(perspective_id="v-adoption", piece_id="p-reply", pillar_id="pl-observed"),
        )


def test_assign_piece_isolation_between_perspectives():
    s = tutorial_snapshot()
    apply(s, AssignPiece(perspective_id="v-adoption", piece_id="p-reply", pillar_id="pl-keep"))
    # v-adoption 里 p-reply 归 pl-keep
    ad = next(
        a for a in s.assignments if a.perspective_id == "v-adoption" and a.piece_id == "p-reply"
    )
    assert ad.pillar_id == "pl-keep"
    # v-evidence 里 p-reply 仍归 pl-observed（两视角独立）
    ev = next(
        a for a in s.assignments if a.perspective_id == "v-evidence" and a.piece_id == "p-reply"
    )
    assert ev.pillar_id == "pl-observed"


def test_assign_piece_null_is_unassigned():
    s = tutorial_snapshot()
    apply(s, AssignPiece(perspective_id="v-adoption", piece_id="p-reply", pillar_id=None))
    ad = next(
        a for a in s.assignments if a.perspective_id == "v-adoption" and a.piece_id == "p-reply"
    )
    assert ad.pillar_id is None


def test_remove_pillar_moves_assignments_to_unassigned():
    s = tutorial_snapshot()
    apply(s, RemovePillar(id="pl-observed"))
    assert s.pillar("pl-observed") is None
    # 原本在 pl-observed 的片段不再有归属（待归类），pl-verify 的保留。
    ev_assign = {a.piece_id: a.pillar_id for a in s.assignments if a.perspective_id == "v-evidence"}
    assert "p-star" not in ev_assign
    assert "p-reply" not in ev_assign
    assert ev_assign["p-unknown"] == "pl-verify"


def test_rename_pillar_keeps_references():
    s = tutorial_snapshot()
    apply(s, RenamePillar(id="pl-interest", name="引起兴趣"))
    assert s.pillar("pl-interest").name == "引起兴趣"
    # 引用不受影响
    a = next(a for a in s.assignments if a.pillar_id == "pl-interest")
    assert a.piece_id == "p-star"


def test_apply_all_stops_on_error():
    s = tutorial_snapshot()
    with pytest.raises(OperationError):
        apply_all(s, [SetPurpose(text="ok"), RemovePiece(piece_id="nope")])
    # 第一个操作已应用，第二个失败；apply_all 不回滚（调用方在事务内回滚）
    assert s.purpose == "ok"
