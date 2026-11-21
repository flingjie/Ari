from ari.domain.recommend_chart import (
    RecommendChartError,
    build_recommend_context,
    existing_charts,
)
from ari.domain.seed import tutorial_snapshot
from ari.models import Flow, FlowStep, SetsStructure, VennSet


def test_existing_charts_empty_on_tutorial():
    s = tutorial_snapshot()
    assert existing_charts(s, "v-adoption") == []


def test_existing_charts_maps_sets_to_venn_and_keeps_flow():
    s = tutorial_snapshot()
    s.visualizations.append(
        Flow(
            type="flow",
            perspective_id="v-adoption",
            steps=[
                FlowStep(id="s1", text="a", pillar_id=None),
                FlowStep(id="s2", text="b", pillar_id=None),
            ],
            branches=[],
            feedback=[],
        )
    )
    s.visualizations.append(
        SetsStructure(
            type="sets",
            perspective_id="v-adoption",
            set_a=VennSet(id="a", name="A"),
            set_b=VennSet(id="b", name="B"),
            members=[],
        )
    )
    assert existing_charts(s, "v-adoption") == ["flow", "venn"]


def test_build_recommend_context_includes_purpose_and_perspective():
    s = tutorial_snapshot()
    ctx = build_recommend_context(s, "v-adoption")
    assert "下一次分享" in ctx["purpose"] or ctx["purpose"]
    assert "采用" in ctx["perspective_name"] or ctx["perspective_name"]
    assert "pieces_json" in ctx and "pillars_json" in ctx
    assert ctx["existing_charts_json"] == "[]"


def test_build_recommend_context_missing_perspective():
    s = tutorial_snapshot()
    try:
        build_recommend_context(s, "nope")
        assert False, "expected error"
    except RecommendChartError as exc:
        assert exc.recovery
