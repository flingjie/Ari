import asyncio

import pytest
from fastapi import HTTPException

from ari.agents.recommend_chart import RecommendChartOutput, render_recommend_prompt
from ari.api.schemas import RecommendChartRequest
from ari.api.workspaces import recommend_chart
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


def test_render_recommend_prompt_contains_candidates_and_purpose():
    ctx = build_recommend_context(tutorial_snapshot(), "v-adoption")
    text = render_recommend_prompt(ctx)
    assert "flow" in text and "venn" in text
    assert ctx["purpose"] in text or "目的" in text
    assert "JSON" in text or "chart" in text


def test_recommend_chart_output_schema_accepts_flow():
    out = RecommendChartOutput(chart="flow", reason="阶段推进")
    assert out.chart == "flow"


class _FakeRunner:
    async def run(self, prompt, output_model, **kwargs):
        return RecommendChartOutput(chart="matrix", reason="两维交叉")


class _BoomRunner:
    async def run(self, prompt, output_model, **kwargs):
        raise RuntimeError("boom")


def _call(wid, conn, rev, pid="v-adoption"):
    return asyncio.run(
        recommend_chart(
            wid,
            RecommendChartRequest(base_revision=rev, perspective_id=pid),
            conn=conn,
        )
    )


def test_recommend_chart_endpoint_ok(tutorial, conn, monkeypatch):
    wid, rev, _ = tutorial
    monkeypatch.setattr("ari.api.workspaces.create_runner", lambda *a, **k: _FakeRunner())
    res = _call(wid, conn, rev)
    assert res.chart == "matrix"
    assert res.reason
    assert res.revision == rev
    assert res.existing_charts == []


def test_recommend_chart_endpoint_stale_409(tutorial, conn, monkeypatch):
    from ari.domain.operations import SetPurpose
    from ari.domain.workspace import apply_patch

    wid, rev, _ = tutorial
    monkeypatch.setattr("ari.api.workspaces.create_runner", lambda *a, **k: _FakeRunner())
    apply_patch(conn, wid, "req-stale-rc", rev, [SetPurpose(text="x")])
    with pytest.raises(HTTPException) as exc:
        _call(wid, conn, rev)
    assert exc.value.status_code == 409


def test_recommend_chart_endpoint_no_llm_503(tutorial, conn, monkeypatch):
    wid, rev, _ = tutorial
    monkeypatch.setattr("ari.api.workspaces.create_runner", lambda *a, **k: None)
    with pytest.raises(HTTPException) as exc:
        _call(wid, conn, rev)
    assert exc.value.status_code == 503


def test_recommend_chart_endpoint_unknown_workspace_404(conn):
    with pytest.raises(HTTPException) as exc:
        _call("nope", conn, 1)
    assert exc.value.status_code == 404


def test_recommend_chart_endpoint_bad_perspective_422(tutorial, conn, monkeypatch):
    wid, rev, _ = tutorial
    monkeypatch.setattr("ari.api.workspaces.create_runner", lambda *a, **k: _FakeRunner())
    with pytest.raises(HTTPException) as exc:
        _call(wid, conn, rev, pid="missing")
    assert exc.value.status_code == 422
    assert "recovery" in exc.value.detail


def test_recommend_chart_endpoint_runner_error_502(tutorial, conn, monkeypatch):
    wid, rev, _ = tutorial
    monkeypatch.setattr("ari.api.workspaces.create_runner", lambda *a, **k: _BoomRunner())
    with pytest.raises(HTTPException) as exc:
        _call(wid, conn, rev)
    assert exc.value.status_code == 502
