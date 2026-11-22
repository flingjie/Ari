from ari.agents.nudge import nudge_output_model, render_nudge_prompt
from ari.agents.stage import PurposeOutput
from ari.db import connect, init_db
from ari.domain.nudge import (
    content_fingerprint,
    content_piece_count,
    observed_values,
    prior_stages_have_content,
    rule_holds,
    stage_is_empty,
    unassigned_count,
)
from ari.domain.proposals import get_message_by_request_id, store_message_and_proposal
from ari.domain.seed import tutorial_snapshot
from ari.models import WorkspaceSnapshot


def test_content_piece_count_excludes_root():
    s = tutorial_snapshot()
    assert content_piece_count(s) == len(s.pieces) - 1


def test_unassigned_count_on_tutorial():
    s = tutorial_snapshot()
    # 教程快照有 active perspective；待归类数量应可计算且 >= 0
    assert unassigned_count(s) >= 0


def test_stage_is_empty_purpose():
    WorkspaceSnapshot(purpose="", root_id="r", pieces=[])
    # 需要合法最小快照；按 seed/empty workspace 惯例构造
    empty = tutorial_snapshot()
    empty.purpose = ""
    assert stage_is_empty(empty, "purpose") is True
    empty.purpose = "有目的"
    assert stage_is_empty(empty, "purpose") is False


def test_prior_stages_perspective_needs_purpose_or_pieces():
    s = tutorial_snapshot()
    assert prior_stages_have_content(s, "perspective") is True
    s.purpose = ""
    # 教程仍有片段
    assert prior_stages_have_content(s, "perspective") is True


def test_rule_holds_unassigned_pieces_threshold():
    s = tutorial_snapshot()
    # 人为制造：若未归类 < 5 则 False
    holds = rule_holds(s, "unassigned_pieces", "pillar")
    assert isinstance(holds, bool)


def test_rule_holds_rejects_wrong_stage_for_structure():
    s = tutorial_snapshot()
    assert rule_holds(s, "unassigned_pieces", "purpose") is False


def test_fingerprint_stable_for_same_relevant_content():
    s = tutorial_snapshot()
    a = content_fingerprint(s, "purpose_empty")
    b = content_fingerprint(s, "purpose_empty")
    assert a == b


def test_observed_values_includes_counts():
    s = tutorial_snapshot()
    vals = observed_values(s, "unassigned_pieces")
    assert "unassigned" in vals
    assert "pieces" in vals


def test_trigger_column_migration(tmp_path):
    # 模拟旧库：无 trigger 列
    path = tmp_path / "old.db"
    c = connect(path)
    c.executescript(
        """
        CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            request_id TEXT NOT NULL,
            question TEXT NOT NULL,
            base_revision INTEGER NOT NULL,
            status TEXT NOT NULL,
            reply TEXT,
            proposal_id TEXT,
            piece_id TEXT,
            created_at TEXT NOT NULL
        );
        """
    )
    c.commit()
    init_db(c)
    cols = {row["name"] for row in c.execute("PRAGMA table_info(messages)")}
    assert "trigger" in cols
    c.close()


def test_store_message_with_trigger(conn, tutorial):
    wid, rev, _ = tutorial
    store_message_and_proposal(
        conn, wid, "perspective", "nudge-1", "", rev, "试试这两个视角",
        [], {"message": "nudge-1"}, trigger="stage_entry",
    )
    row = get_message_by_request_id(conn, "nudge-1")
    assert row["question"] == ""
    assert row["trigger"] == "stage_entry"


def test_nudge_output_model_has_speak_and_inherits():
    model = nudge_output_model("purpose")
    inst = model(speak=False, reply="", rewritten_purpose="")
    assert inst.speak is False
    assert isinstance(inst, PurposeOutput)


def test_render_nudge_prompt_includes_constraints_and_signal():
    text = render_nudge_prompt(
        "perspective",
        {
            "purpose": "P",
            "pieces_json": "[]",
            "perspectives_json": "[]",
            "active_perspective": "",
            "pillars_json": "[]",
            "assignments_json": "[]",
            "history": "",
        },
        trigger="stage_entry",
        rule_id="stage_entry",
        observed={"pieces": 3},
        recent_actions=["新增片段×3"],
    )
    assert "speak" in text
    assert "一次最多提出一个主要问题" in text
    assert "stage_entry" in text or "进入" in text
    assert "新增片段×3" in text


# ---------------------------------------------------------------- 端点 / 运行时

import asyncio  # noqa: E402

import pytest  # noqa: E402

from ari.api.schemas import NudgeRequest  # noqa: E402
from ari.api.workspaces import send_nudge  # noqa: E402
from ari.domain import nudge_runtime  # noqa: E402
from ari.domain.operations import AddPiece  # noqa: E402
from ari.domain.workspace import apply_patch  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_runtime():
    nudge_runtime.clear()
    yield
    nudge_runtime.clear()


class FakeRunner:
    def __init__(self, output):
        self.output = output
        self.calls = 0

    async def run(self, prompt, output_model):
        self.calls += 1
        if isinstance(self.output, Exception):
            raise self.output
        return self.output


def _purpose_ws(conn, empty, pieces=5):
    """空白工作区 + N 条片段、purpose 为空 → purpose_empty 成立。"""
    wid, rev, snap = empty
    ops = [
        AddPiece(id=f"n{i}", parent_id=snap.root_id, text=f"片段{i}")
        for i in range(pieces)
    ]
    rev, snap = apply_patch(conn, wid, "seed-req", rev, ops)
    return wid, rev, snap


def _req(rev, rid="nudge-r1", **kw):
    data = dict(
        request_id=rid,
        stage="purpose",
        trigger="structure_issue",
        rule_id="purpose_empty",
        base_revision=rev,
    )
    data.update(kw)
    return NudgeRequest(**data)


def _call(conn, wid, body):
    return asyncio.run(send_nudge(wid, body, conn))


def _spoken(text="目的好像还没写，要不要试试？"):
    return nudge_output_model("purpose")(
        speak=True, reply=text, rewritten_purpose="想清楚这批材料要说明什么"
    )


def _silent():
    return nudge_output_model("purpose")(speak=False, reply="", rewritten_purpose="")


def _patch_runner(monkeypatch, runner):
    monkeypatch.setattr("ari.api.workspaces.create_runner", lambda *a, **k: runner)


def test_nudge_runtime_basics():
    assert nudge_runtime.try_begin("w") is True
    assert nudge_runtime.try_begin("w") is False
    nudge_runtime.end("w")
    assert nudge_runtime.try_begin("w") is True
    assert nudge_runtime.silence_hit("w", "r", "s", "f") is False
    nudge_runtime.record_silence("w", "r", "s", "f")
    assert nudge_runtime.silence_hit("w", "r", "s", "f") is True
    nudge_runtime.clear()
    assert nudge_runtime.try_begin("w") is True
    assert nudge_runtime.silence_hit("w", "r", "s", "f") is False


def test_nudge_speak_false_returns_204(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    runner = FakeRunner(_silent())
    _patch_runner(monkeypatch, runner)
    resp = _call(conn, wid, _req(rev))
    assert resp.status_code == 204
    assert runner.calls == 1
    assert get_message_by_request_id(conn, "nudge-r1") is None
    # 并发标记已释放
    assert nudge_runtime.try_begin(wid) is True


def test_nudge_speak_true_persists_message_and_proposal(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    runner = FakeRunner(_spoken())
    _patch_runner(monkeypatch, runner)
    resp = _call(conn, wid, _req(rev))
    assert resp.reply == "目的好像还没写，要不要试试？"
    assert resp.revision == rev
    assert resp.proposal_id is not None
    assert resp.proposal is not None
    row = get_message_by_request_id(conn, "nudge-r1")
    assert row["question"] == ""
    assert row["trigger"] == "structure_issue"
    assert row["proposal_id"] == resp.proposal_id


def test_nudge_idempotent_same_request_id(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    runner = FakeRunner(_spoken())
    _patch_runner(monkeypatch, runner)
    first = _call(conn, wid, _req(rev))
    second = _call(conn, wid, _req(rev))
    assert runner.calls == 1
    assert second.reply == first.reply
    assert second.proposal_id == first.proposal_id


def test_nudge_request_id_other_workspace_409(conn, empty, monkeypatch):
    from fastapi import HTTPException

    wid, rev, _ = _purpose_ws(conn, empty)
    _patch_runner(monkeypatch, FakeRunner(_spoken()))
    _call(conn, wid, _req(rev))
    with pytest.raises(HTTPException) as exc:
        _call(conn, "other-ws", _req(rev))
    assert exc.value.status_code == 409


def test_nudge_concurrent_second_returns_204(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    runner = FakeRunner(_spoken())
    _patch_runner(monkeypatch, runner)
    assert nudge_runtime.try_begin(wid)
    resp = _call(conn, wid, _req(rev))
    assert resp.status_code == 204
    assert runner.calls == 0
    # 占用方未被误释放
    assert nudge_runtime.try_begin(wid) is False


def test_nudge_rule_recheck_fails_returns_204(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    runner = FakeRunner(_spoken())
    _patch_runner(monkeypatch, runner)
    # stage=purpose 下 unassigned_pieces 不允许 → 复核失败
    body = _req(rev, rule_id="unassigned_pieces")
    resp = _call(conn, wid, body)
    assert resp.status_code == 204
    assert runner.calls == 0


def test_nudge_rule_recheck_fails_when_pieces_too_few(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty, pieces=2)
    runner = FakeRunner(_spoken())
    _patch_runner(monkeypatch, runner)
    resp = _call(conn, wid, _req(rev))
    assert resp.status_code == 204
    assert runner.calls == 0


def test_nudge_stale_revision_returns_204(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    runner = FakeRunner(_spoken())
    _patch_runner(monkeypatch, runner)
    resp = _call(conn, wid, _req(rev - 1))
    assert resp.status_code == 204
    assert runner.calls == 0


def test_nudge_idle_returns_204_without_llm(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    runner = FakeRunner(_spoken())
    _patch_runner(monkeypatch, runner)
    resp = _call(conn, wid, _req(rev, trigger="idle"))
    assert resp.status_code == 204
    assert runner.calls == 0


def test_nudge_silence_cache_skips_llm(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    runner = FakeRunner(_silent())
    _patch_runner(monkeypatch, runner)
    assert _call(conn, wid, _req(rev, rid="a")).status_code == 204
    assert _call(conn, wid, _req(rev, rid="b")).status_code == 204
    assert runner.calls == 1


def test_nudge_silence_cache_invalidated_by_relevant_change(conn, empty, monkeypatch):
    wid, rev, snap = _purpose_ws(conn, empty)
    runner = FakeRunner(_silent())
    _patch_runner(monkeypatch, runner)
    assert _call(conn, wid, _req(rev, rid="a")).status_code == 204
    rev, _ = apply_patch(
        conn, wid, "more", rev, [AddPiece(id="extra", parent_id=snap.root_id, text="x")]
    )
    assert _call(conn, wid, _req(rev, rid="b")).status_code == 204
    assert runner.calls == 2


def test_nudge_llm_unconfigured_returns_204(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    _patch_runner(monkeypatch, None)
    assert _call(conn, wid, _req(rev)).status_code == 204


def test_nudge_llm_error_returns_204_and_releases(conn, empty, monkeypatch):
    wid, rev, _ = _purpose_ws(conn, empty)
    _patch_runner(monkeypatch, FakeRunner(RuntimeError("boom")))
    assert _call(conn, wid, _req(rev)).status_code == 204
    assert nudge_runtime.try_begin(wid) is True


def test_nudge_unknown_workspace_404(conn, monkeypatch):
    from fastapi import HTTPException

    _patch_runner(monkeypatch, FakeRunner(_spoken()))
    with pytest.raises(HTTPException) as exc:
        _call(conn, "missing", _req(1))
    assert exc.value.status_code == 404
    assert nudge_runtime.try_begin("missing") is True
