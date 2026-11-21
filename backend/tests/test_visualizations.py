"""可视化关系结构的校验、读取与端点测试（PR 1：读取侧）。"""

import pytest
from fastapi import HTTPException

from ari.api.schemas import VisualizationQuery
from ari.api.workspaces import visualization
from ari.domain.seed import tutorial_snapshot
from ari.domain.visualizations import (
    build_visualization_view,
    flow_problems,
    logic_tree_problems,
    matrix_problems,
    pyramid_problems,
    sets_problems,
)
from ari.domain.workspace import apply_patch
from ari.domain.operations import (
    OperationError,
    RemoveFlow,
    RemoveLogicTree,
    RemoveMatrix,
    RemovePiece,
    RemovePillar,
    RemovePyramid,
    RemoveSets,
    SetFlow,
    SetLogicTree,
    SetMatrix,
    SetPurpose,
    SetPyramid,
    SetSets,
    apply,
)
from ari.models import (
    Flow,
    FlowBranch,
    FlowFeedback,
    FlowStep,
    LogicTree,
    LogicTreeNode,
    MatrixAxis,
    MatrixAxisValue,
    MatrixCoordinate,
    MatrixStructure,
    Pyramid,
    PyramidPoint,
    SetMember,
    SetsStructure,
    VennSet,
    WorkspaceSnapshot,
)


# —— 向后兼容与序列化 ——


def test_tutorial_snapshot_has_no_visualizations():
    assert tutorial_snapshot().visualizations == []


def test_old_snapshot_without_visualizations_field():
    data = {
        "purpose": "",
        "root_id": "root",
        "active_perspective_id": None,
        "pieces": [{"id": "root", "parent_id": None, "text": "x", "order": 0}],
        "perspectives": [],
        "pillars": [],
        "assignments": [],
    }
    s = WorkspaceSnapshot.model_validate(data)
    assert s.visualizations == []


def test_visualization_roundtrip():
    s = tutorial_snapshot()
    flow = Flow(
        perspective_id="v-adoption",
        steps=[FlowStep(id="s1", text="开始"), FlowStep(id="s2", text="结束")],
        branches=[FlowBranch(id="b1", from_step_id="s1", to_step_id="s2")],
    )
    s.visualizations.append(flow)
    s2 = WorkspaceSnapshot.model_validate_json(s.model_dump_json())
    got = s2.visualization("v-adoption", "flow")
    assert got is not None
    assert got.type == "flow"
    assert [x.id for x in got.steps] == ["s1", "s2"]


# —— 校验函数 ——


def _flow(**kw) -> Flow:
    steps = kw.pop("steps", [FlowStep(id="s1", text="一"), FlowStep(id="s2", text="二")])
    branches = kw.pop("branches", [])
    feedback = kw.pop("feedback", [])
    return Flow(perspective_id="v-adoption", steps=steps, branches=branches, feedback=feedback, **kw)


def test_flow_problems_valid():
    hard, soft = flow_problems(tutorial_snapshot(), _flow())
    assert hard == [] and soft == []


def test_flow_problems_too_few_steps():
    hard, _ = flow_problems(tutorial_snapshot(), _flow(steps=[FlowStep(id="s1", text="一")]))
    assert any("至少需要两个步骤" in h for h in hard)


def test_flow_problems_branch_cycle():
    flow = _flow(
        branches=[
            FlowBranch(id="b1", from_step_id="s1", to_step_id="s2"),
            FlowBranch(id="b2", from_step_id="s2", to_step_id="s1"),
        ]
    )
    hard, _ = flow_problems(tutorial_snapshot(), flow)
    assert any("环" in h for h in hard)


def test_flow_problems_feedback_not_upstream():
    flow = _flow(feedback=[FlowFeedback(id="f1", from_step_id="s1", to_step_id="s2")])
    hard, _ = flow_problems(tutorial_snapshot(), flow)
    assert any("上游" in h for h in hard)


def test_sets_problems():
    s = tutorial_snapshot()
    sets = SetsStructure(
        perspective_id="v-adoption",
        set_a=VennSet(id="a", name="A"),
        set_b=VennSet(id="a", name="B"),
    )
    hard, soft = sets_problems(s, sets)
    assert any("id 不能相同" in h for h in hard)
    ok = SetsStructure(perspective_id="v-adoption", set_a=VennSet(id="a", name=""), set_b=VennSet(id="b", name="B"))
    hard2, soft2 = sets_problems(s, ok)
    assert hard2 == [] and any("名称" in x for x in soft2)


def test_matrix_problems_too_few_values():
    s = tutorial_snapshot()
    matrix = MatrixStructure(
        perspective_id="v-adoption",
        x_axis=MatrixAxis(id="x", name="X", values=[MatrixAxisValue(id="x1", name="一")]),
        y_axis=MatrixAxis(id="y", name="Y", values=[MatrixAxisValue(id="y1", name="一")]),
    )
    hard, _ = matrix_problems(s, matrix)
    assert any("横轴" in h for h in hard)


def test_pyramid_problems():
    s = tutorial_snapshot()
    no_points = Pyramid(perspective_id="v-adoption", points=[])
    hard, _ = pyramid_problems(s, no_points)
    assert any("至少需要一个要点" in h for h in hard)
    empty_evidence = Pyramid(
        perspective_id="v-adoption",
        conclusion="结论",
        points=[PyramidPoint(id="p1", text="要点一")],
    )
    hard2, soft2 = pyramid_problems(s, empty_evidence)
    assert hard2 == [] and any("缺少证据" in x for x in soft2)


def test_logic_tree_problems_multi_root():
    s = tutorial_snapshot()
    tree = LogicTree(
        perspective_id="v-adoption",
        nodes=[LogicTreeNode(id="n1", text="一"), LogicTreeNode(id="n2", text="二")],
    )
    hard, _ = logic_tree_problems(s, tree)
    assert any("根" in h for h in hard)


def test_logic_tree_problems_root_childless_soft():
    s = tutorial_snapshot()
    tree = LogicTree(perspective_id="v-adoption", nodes=[LogicTreeNode(id="n1", text="根")])
    hard, soft = logic_tree_problems(s, tree)
    assert hard == [] and any("子问题" in x for x in soft)


# —— 读取视图 ——


def test_build_visualization_view_tutorial_all_relationship_charts_missing():
    view = build_visualization_view(tutorial_snapshot(), "v-adoption")
    assert view.purpose.startswith("下一次分享后")
    assert view.perspective.name == "按采用阶段"
    assert [c.chart for c in view.charts] == [
        "classification", "flow", "cycle", "venn", "matrix", "pyramid", "logic_tree",
    ]
    by_chart = {c.chart: c.status for c in view.charts}
    assert by_chart["classification"] == "ready"
    for chart in ("flow", "cycle", "venn", "matrix", "pyramid", "logic_tree"):
        assert by_chart[chart] == "missing"


# —— 端点 ——


def test_visualization_endpoint_ok(tutorial, conn):
    wid, rev, _ = tutorial
    res = visualization(wid, VisualizationQuery(revision=rev, perspective_id="v-adoption"), conn=conn)
    assert res.revision == rev
    assert len(res.view.charts) == 7


def test_visualization_endpoint_stale_revision_409(tutorial, conn):
    wid, rev, _ = tutorial
    apply_patch(conn, wid, "req-stale-viz", rev, [SetPurpose(text="新目的")])
    with pytest.raises(HTTPException) as exc:
        visualization(wid, VisualizationQuery(revision=rev, perspective_id="v-adoption"), conn=conn)
    assert exc.value.status_code == 409
    assert exc.value.detail["current_revision"] == rev + 1


def test_visualization_endpoint_missing_perspective_422(tutorial, conn):
    wid, rev, _ = tutorial
    with pytest.raises(HTTPException) as exc:
        visualization(wid, VisualizationQuery(revision=rev, perspective_id="nope"), conn=conn)
    assert exc.value.status_code == 422
    assert exc.value.detail["recovery"]


def test_visualization_endpoint_workspace_not_found_404(conn):
    with pytest.raises(HTTPException) as exc:
        visualization("missing", VisualizationQuery(revision=1, perspective_id="x"), conn=conn)
    assert exc.value.status_code == 404


# —— 写入操作（PR 2：流程） ——


def test_set_flow_upsert_replace_and_remove():
    s = tutorial_snapshot()
    apply(
        s,
        SetFlow(
            structure=Flow(
                perspective_id="v-adoption",
                steps=[FlowStep(id="s1", text="一"), FlowStep(id="s2", text="二")],
            )
        ),
    )
    got = s.visualization("v-adoption", "flow")
    assert got is not None and [x.id for x in got.steps] == ["s1", "s2"]

    # 同 (type, perspective) 替换
    apply(
        s,
        SetFlow(
            structure=Flow(
                perspective_id="v-adoption",
                steps=[FlowStep(id="a", text="甲"), FlowStep(id="b", text="乙")],
            )
        ),
    )
    got = s.visualization("v-adoption", "flow")
    assert got is not None and [x.id for x in got.steps] == ["a", "b"]
    assert len(s.visualizations) == 1

    # 跨视角隔离
    apply(
        s,
        SetFlow(
            structure=Flow(
                perspective_id="v-evidence",
                steps=[FlowStep(id="c", text="丙"), FlowStep(id="d", text="丁")],
            )
        ),
    )
    assert len(s.visualizations) == 2
    got = s.visualization("v-adoption", "flow")
    assert got is not None and got.steps[0].id == "a"

    # remove + 幂等
    apply(s, RemoveFlow(perspective_id="v-adoption"))
    assert s.visualization("v-adoption", "flow") is None
    apply(s, RemoveFlow(perspective_id="v-adoption"))  # no-op


def test_set_flow_validation_rejects_hard():
    s = tutorial_snapshot()
    flow = Flow(perspective_id="v-adoption", steps=[FlowStep(id="s1", text="一")])
    with pytest.raises(OperationError):
        apply(s, SetFlow(structure=flow))


def test_remove_pillar_cleans_flow_step_pillar_ref():
    s = tutorial_snapshot()
    apply(
        s,
        SetFlow(
            structure=Flow(
                perspective_id="v-adoption",
                steps=[
                    FlowStep(id="s1", text="一", pillar_id="pl-interest"),
                    FlowStep(id="s2", text="二"),
                ],
            )
        ),
    )
    apply(s, RemovePillar(id="pl-interest"))
    got = s.visualization("v-adoption", "flow")
    assert got is not None
    assert got.steps[0].pillar_id is None  # 步骤保留，支柱引用置空
    assert got.steps[0].id == "s1"


# —— 写入操作（PR 3：集合 + 矩阵） ——


def _matrix() -> MatrixStructure:
    return MatrixStructure(
        perspective_id="v-adoption",
        x_axis=MatrixAxis(
            id="x",
            name="X",
            values=[MatrixAxisValue(id="x1", name="一"), MatrixAxisValue(id="x2", name="二")],
        ),
        y_axis=MatrixAxis(
            id="y",
            name="Y",
            values=[MatrixAxisValue(id="y1", name="一"), MatrixAxisValue(id="y2", name="二")],
        ),
    )


def test_set_sets_upsert_and_validation():
    s = tutorial_snapshot()
    apply(
        s,
        SetSets(
            structure=SetsStructure(
                perspective_id="v-adoption",
                set_a=VennSet(id="a", name="A"),
                set_b=VennSet(id="b", name="B"),
            )
        ),
    )
    got = s.visualization("v-adoption", "sets")
    assert got is not None and got.set_a.id == "a"
    # 同集合 id → 硬错误
    bad = SetsStructure(
        perspective_id="v-adoption",
        set_a=VennSet(id="x", name="A"),
        set_b=VennSet(id="x", name="B"),
    )
    with pytest.raises(OperationError):
        apply(s, SetSets(structure=bad))
    # remove + 幂等
    apply(s, RemoveSets(perspective_id="v-adoption"))
    assert s.visualization("v-adoption", "sets") is None
    apply(s, RemoveSets(perspective_id="v-adoption"))


def test_set_matrix_upsert_and_validation():
    s = tutorial_snapshot()
    matrix = _matrix()
    matrix.coordinates.append(MatrixCoordinate(piece_id="p-star", x_value_id="x1", y_value_id="y1"))
    apply(s, SetMatrix(structure=matrix))
    got = s.visualization("v-adoption", "matrix")
    assert got is not None and len(got.coordinates) == 1
    # 轴值 <2 → 硬错误
    bad = MatrixStructure(
        perspective_id="v-adoption",
        x_axis=MatrixAxis(id="x", name="X", values=[MatrixAxisValue(id="x1", name="一")]),
        y_axis=MatrixAxis(
            id="y",
            name="Y",
            values=[MatrixAxisValue(id="y1", name="一"), MatrixAxisValue(id="y2", name="二")],
        ),
    )
    with pytest.raises(OperationError):
        apply(s, SetMatrix(structure=bad))


def test_remove_piece_cleans_sets_and_matrix_refs():
    s = tutorial_snapshot()
    apply(
        s,
        SetSets(
            structure=SetsStructure(
                perspective_id="v-adoption",
                set_a=VennSet(id="a", name="A"),
                set_b=VennSet(id="b", name="B"),
                members=[
                    SetMember(piece_id="p-star", region="a"),
                    SetMember(piece_id="p-reply", region="b"),
                ],
            )
        ),
    )
    matrix = _matrix()
    matrix.coordinates = [
        MatrixCoordinate(piece_id="p-star", x_value_id="x1", y_value_id="y1"),
        MatrixCoordinate(piece_id="p-reply", x_value_id="x2", y_value_id="y2"),
    ]
    apply(s, SetMatrix(structure=matrix))

    apply(s, RemovePiece(piece_id="p-star"))

    got_sets = s.visualization("v-adoption", "sets")
    assert got_sets is not None and [m.piece_id for m in got_sets.members] == ["p-reply"]
    got_matrix = s.visualization("v-adoption", "matrix")
    assert got_matrix is not None and [c.piece_id for c in got_matrix.coordinates] == ["p-reply"]


# —— 写入操作（PR 4：金字塔 + 逻辑树） ——


def test_set_pyramid_upsert_and_validation():
    s = tutorial_snapshot()
    apply(
        s,
        SetPyramid(
            structure=Pyramid(
                perspective_id="v-adoption",
                conclusion="结论",
                points=[PyramidPoint(id="p1", text="要点一")],
            )
        ),
    )
    got = s.visualization("v-adoption", "pyramid")
    assert got is not None and got.conclusion == "结论"
    # 0 要点 → 硬错误
    with pytest.raises(OperationError):
        apply(s, SetPyramid(structure=Pyramid(perspective_id="v-adoption", points=[])))


def test_set_logic_tree_upsert_and_validation():
    s = tutorial_snapshot()
    apply(
        s,
        SetLogicTree(
            structure=LogicTree(
                perspective_id="v-adoption",
                nodes=[
                    LogicTreeNode(id="n1", text="根"),
                    LogicTreeNode(id="n2", text="子", parent_id="n1"),
                ],
            )
        ),
    )
    got = s.visualization("v-adoption", "logic_tree")
    assert got is not None and len(got.nodes) == 2
    # 多根 → 硬错误
    bad = LogicTree(
        perspective_id="v-adoption",
        nodes=[LogicTreeNode(id="a", text="一"), LogicTreeNode(id="b", text="二")],
    )
    with pytest.raises(OperationError):
        apply(s, SetLogicTree(structure=bad))


def test_remove_pillar_cleans_pyramid_point_ref():
    s = tutorial_snapshot()
    apply(
        s,
        SetPyramid(
            structure=Pyramid(
                perspective_id="v-adoption",
                conclusion="结论",
                points=[PyramidPoint(id="p1", text="要点一", pillar_id="pl-interest")],
            )
        ),
    )
    apply(s, RemovePillar(id="pl-interest"))
    got = s.visualization("v-adoption", "pyramid")
    assert got is not None and got.points[0].pillar_id is None


def test_remove_piece_cleans_pyramid_and_tree_refs():
    s = tutorial_snapshot()
    apply(
        s,
        SetPyramid(
            structure=Pyramid(
                perspective_id="v-adoption",
                conclusion="结论",
                points=[PyramidPoint(id="p1", text="要点一", evidence=["p-star", "p-reply"])],
            )
        ),
    )
    apply(
        s,
        SetLogicTree(
            structure=LogicTree(
                perspective_id="v-adoption",
                nodes=[LogicTreeNode(id="n1", text="根", materials=["p-star", "p-unknown"])],
            )
        ),
    )
    apply(s, RemovePiece(piece_id="p-star"))
    got_pyramid = s.visualization("v-adoption", "pyramid")
    assert got_pyramid is not None and got_pyramid.points[0].evidence == ["p-reply"]
    got_tree = s.visualization("v-adoption", "logic_tree")
    assert got_tree is not None and got_tree.nodes[0].materials == ["p-unknown"]
