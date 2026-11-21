"""工作区仓库：幂等、冲突、事务。"""

import pytest

from ari.domain.operations import MovePiece, SetPurpose
from ari.domain.workspace import (
    ConflictError,
    ReceiptConflictError,
    apply_patch,
    get_workspace,
)


def test_apply_patch_and_idempotent_retry(conn, tutorial):
    wid, rev, _ = tutorial
    r1, s1 = apply_patch(conn, wid, "req-1", rev, [SetPurpose(text="x")])
    assert r1 == rev + 1
    assert s1.purpose == "x"
    # 同一 request_id 重试返回原结果
    r2, s2 = apply_patch(conn, wid, "req-1", rev, [SetPurpose(text="x")])
    assert r2 == r1
    assert s2.purpose == "x"


def test_same_request_id_different_payload(conn, tutorial):
    wid, rev, _ = tutorial
    apply_patch(conn, wid, "req", rev, [SetPurpose(text="a")])
    with pytest.raises(ReceiptConflictError):
        apply_patch(conn, wid, "req", rev, [SetPurpose(text="b")])


def test_stale_revision_conflict(conn, tutorial):
    wid, rev, _ = tutorial
    apply_patch(conn, wid, "req-a", rev, [SetPurpose(text="a")])
    with pytest.raises(ConflictError) as ei:
        apply_patch(conn, wid, "req-b", rev, [SetPurpose(text="b")])
    assert ei.value.current_revision == rev + 1


def test_workspace_not_found(conn):
    with pytest.raises(LookupError):
        apply_patch(conn, "nope", "req", 1, [SetPurpose(text="x")])


def test_get_workspace_roundtrip(conn, tutorial):
    wid, rev, snap = tutorial
    ws = get_workspace(conn, wid)
    assert ws["revision"] == rev
    assert ws["snapshot"].root_id == snap.root_id


def test_move_piece_idempotent_retry(conn, tutorial):
    wid, rev, _ = tutorial
    ops = [MovePiece(piece_id="p-star", parent_id="p-reply")]
    r1, s1 = apply_patch(conn, wid, "req-move", rev, ops)
    assert r1 == rev + 1
    assert s1.piece("p-star").parent_id == "p-reply"
    # 同一 request_id 重试返回原结果（不重复移动）
    r2, s2 = apply_patch(conn, wid, "req-move", rev, ops)
    assert r2 == r1
    assert s2.piece("p-star").parent_id == "p-reply"
