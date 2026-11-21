"""统一分组计算与读取接口测试。"""

import pytest
from fastapi import HTTPException

from ari.api.schemas import GroupedViewQuery
from ari.api.workspaces import grouped_view
from ari.domain.grouping import GroupedViewError, build_grouped_view
from ari.domain.operations import AddPerspective, AssignPiece, SetPurpose, apply
from ari.domain.seed import tutorial_snapshot
from ari.domain.workspace import apply_patch, get_workspace


# —— 纯函数 ——


def test_grouped_view_tutorial_adoption():
    s = tutorial_snapshot()
    view = build_grouped_view(s, "v-adoption")
    assert view.purpose == "下一次分享后，怎样判断读者是否实际用过教程？"
    assert view.perspective.name == "按采用阶段"
    assert [p.id for p in view.pillars] == ["pl-interest", "pl-try", "pl-keep"]
    assert [p.name for p in view.pillars] == ["产生兴趣", "动手尝试", "持续使用"]
    assert [p.id for p in view.pillars[0].pieces] == ["p-star"]
    assert view.pillars[1].pieces == []
    assert view.pillars[2].pieces == []
    assert [p.id for p in view.unassigned] == ["p-reply", "p-unknown"]


def test_grouped_view_tutorial_evidence():
    s = tutorial_snapshot()
    view = build_grouped_view(s, "v-evidence")
    assert view.perspective.name == "按证据强弱"
    assert [p.id for p in view.pillars] == ["pl-observed", "pl-verify"]
    assert [p.id for p in view.pillars[0].pieces] == ["p-star", "p-reply"]
    assert [p.id for p in view.pillars[1].pieces] == ["p-unknown"]
    assert view.unassigned == []


def test_grouped_view_missing_perspective_error():
    s = tutorial_snapshot()
    with pytest.raises(GroupedViewError) as exc:
        build_grouped_view(s, "nope")
    assert exc.value.recovery


def test_grouped_view_no_pillars_all_unassigned():
    s = tutorial_snapshot()
    apply(s, AddPerspective(id="v-x", name="无支柱视角"))
    view = build_grouped_view(s, "v-x")
    assert view.pillars == []
    assert [p.id for p in view.unassigned] == ["p-star", "p-reply", "p-unknown"]


def test_grouped_view_empty_pillars_included():
    s = tutorial_snapshot()
    view = build_grouped_view(s, "v-adoption")
    assert len(view.pillars) == 3
    assert all(len(p.pieces) == 0 for p in view.pillars[1:])


def test_grouped_view_cross_perspective_isolation():
    s = tutorial_snapshot()
    apply(s, AssignPiece(perspective_id="v-adoption", piece_id="p-reply", pillar_id="pl-interest"))
    # 改 v-adoption 不应影响 v-evidence。
    evidence = build_grouped_view(s, "v-evidence")
    assert [p.id for p in evidence.pillars[0].pieces] == ["p-star", "p-reply"]
    adoption = build_grouped_view(s, "v-adoption")
    assert [p.id for p in adoption.pillars[0].pieces] == ["p-star", "p-reply"]


def test_grouped_view_does_not_mutate_snapshot():
    s = tutorial_snapshot()
    build_grouped_view(s, "v-evidence")
    assert s.active_perspective_id == "v-adoption"
    assert len(s.pieces) == 4
    assert len(s.pillars) == 5
    assert len(s.assignments) == 4


# —— 端点 ——


def test_grouped_view_endpoint_ok(tutorial, conn):
    wid, rev, _ = tutorial
    res = grouped_view(wid, GroupedViewQuery(revision=rev, perspective_id="v-adoption"), conn=conn)
    assert res.revision == rev
    assert res.view.perspective.name == "按采用阶段"


def test_grouped_view_endpoint_stale_revision_409(tutorial, conn):
    wid, rev, _ = tutorial
    apply_patch(conn, wid, "req-stale", rev, [SetPurpose(text="新目的")])
    with pytest.raises(HTTPException) as exc:
        grouped_view(wid, GroupedViewQuery(revision=rev, perspective_id="v-adoption"), conn=conn)
    assert exc.value.status_code == 409
    assert exc.value.detail["current_revision"] == rev + 1


def test_grouped_view_endpoint_missing_perspective_422(tutorial, conn):
    wid, rev, _ = tutorial
    with pytest.raises(HTTPException) as exc:
        grouped_view(wid, GroupedViewQuery(revision=rev, perspective_id="nope"), conn=conn)
    assert exc.value.status_code == 422
    assert exc.value.detail["recovery"]


def test_grouped_view_endpoint_workspace_not_found_404(conn):
    with pytest.raises(HTTPException) as exc:
        grouped_view("missing", GroupedViewQuery(revision=1, perspective_id="x"), conn=conn)
    assert exc.value.status_code == 404


def test_grouped_view_endpoint_does_not_switch_active_perspective(tutorial, conn):
    wid, rev, _ = tutorial
    grouped_view(wid, GroupedViewQuery(revision=rev, perspective_id="v-evidence"), conn=conn)
    assert get_workspace(conn, wid)["snapshot"].active_perspective_id == "v-adoption"
