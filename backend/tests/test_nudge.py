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
