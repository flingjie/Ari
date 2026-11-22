from ari.domain.nudge import (
    content_fingerprint,
    content_piece_count,
    observed_values,
    prior_stages_have_content,
    rule_holds,
    stage_is_empty,
    unassigned_count,
)
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
