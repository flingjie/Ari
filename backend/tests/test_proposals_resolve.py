"""提案解决：旧提案版本校验、三种动作幂等。"""

import pytest

from ari.domain.operations import SetPurpose
from ari.domain.proposals import (
    ProposalResolvedError,
    ReceiptConflictError,
    StaleProposalError,
    create_proposal,
    resolve_proposal,
)
from ari.domain.workspace import apply_patch


def _proposal(conn, wid, rev, request_id="m"):
    return create_proposal(
        conn, wid, "purpose", rev, {"message": request_id}, [SetPurpose(text="改写后的目的")]
    )


def test_accept_applies_change_set(conn, tutorial):
    wid, rev, _ = tutorial
    pid = _proposal(conn, wid, rev)
    new_rev, new_snap = resolve_proposal(conn, wid, pid, "resolve-1", rev, "accept", None)
    assert new_rev == rev + 1
    assert new_snap.purpose == "改写后的目的"


def test_accept_idempotent_replay(conn, tutorial):
    wid, rev, _ = tutorial
    pid = _proposal(conn, wid, rev)
    r1, s1 = resolve_proposal(conn, wid, pid, "r", rev, "accept", None)
    r2, s2 = resolve_proposal(conn, wid, pid, "r", rev, "accept", None)
    assert r2 == r1
    assert s2.purpose == "改写后的目的"


def test_stale_proposal_accept_rejected(conn, tutorial):
    wid, rev, _ = tutorial
    pid = _proposal(conn, wid, rev)
    # 提案生成后手工编辑推进 revision。
    apply_patch(conn, wid, "req", rev, [SetPurpose(text="手工编辑")])
    with pytest.raises(StaleProposalError) as ei:
        resolve_proposal(conn, wid, pid, "resolve", rev + 1, "accept", None)
    assert ei.value.current_revision == rev + 1


def test_ignore_stale_proposal_allowed(conn, tutorial):
    wid, rev, _ = tutorial
    pid = _proposal(conn, wid, rev)
    apply_patch(conn, wid, "req", rev, [SetPurpose(text="手工编辑")])
    new_rev, snap = resolve_proposal(conn, wid, pid, "resolve", rev + 1, "ignore", None)
    assert new_rev == rev + 1  # ignore 不推进 revision。
    assert snap.purpose == "手工编辑"


def test_ignore_idempotent_replay(conn, tutorial):
    wid, rev, _ = tutorial
    pid = _proposal(conn, wid, rev)
    r1, _ = resolve_proposal(conn, wid, pid, "r", rev, "ignore", None)
    r2, _ = resolve_proposal(conn, wid, pid, "r", rev, "ignore", None)
    assert r2 == r1 == rev


def test_resolved_proposal_rejects_new_request(conn, tutorial):
    wid, rev, _ = tutorial
    pid = _proposal(conn, wid, rev)
    resolve_proposal(conn, wid, pid, "r1", rev, "accept", None)
    with pytest.raises(ProposalResolvedError):
        resolve_proposal(conn, wid, pid, "r2", rev + 1, "accept", None)


def test_resolve_replay_mismatched_action_conflicts(conn, tutorial):
    wid, rev, _ = tutorial
    pid = _proposal(conn, wid, rev)
    resolve_proposal(conn, wid, pid, "r", rev, "ignore", None)
    with pytest.raises(ReceiptConflictError):
        resolve_proposal(conn, wid, pid, "r", rev, "accept", None)
