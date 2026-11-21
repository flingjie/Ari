"""撤销上一步：恢复删除分支、无可撤销、幂等、撤销的撤销。"""

import pytest

from ari.domain.operations import RemovePiece, SetPurpose
from ari.domain.workspace import (
    ConflictError,
    NothingToUndoError,
    apply_patch,
    get_workspace,
    undo_last,
)


def test_undo_restores_removed_branch(conn, tutorial):
    wid, rev, snap = tutorial
    # 教程里 p-star 挂在根下，删除后应消失；撤销后恢复。
    assert snap.piece("p-star") is not None
    r1, s1 = apply_patch(conn, wid, "del-1", rev, [RemovePiece(piece_id="p-star")])
    assert s1.piece("p-star") is None
    r2, s2 = undo_last(conn, wid, "undo-1", r1)
    assert r2 == r1 + 1
    assert s2.piece("p-star") is not None
    assert s2.piece("p-star").text == snap.piece("p-star").text


def test_undo_when_nothing_raises(conn, tutorial):
    wid, rev, _ = tutorial
    with pytest.raises(NothingToUndoError):
        undo_last(conn, wid, "undo-x", rev)


def test_undo_idempotent_retry(conn, tutorial):
    wid, rev, _ = tutorial
    r1, _ = apply_patch(conn, wid, "del-2", rev, [RemovePiece(piece_id="p-star")])
    r2, s2 = undo_last(conn, wid, "undo-2", r1)
    r3, s3 = undo_last(conn, wid, "undo-2", r1)
    assert r3 == r2
    assert s3.piece("p-star") is not None
    assert s3.purpose == s2.purpose


def test_undo_then_undo_is_redo(conn, tutorial):
    wid, rev, _ = tutorial
    r1, s1 = apply_patch(conn, wid, "set-1", rev, [SetPurpose(text="改过")])
    assert s1.purpose == "改过"
    r2, s2 = undo_last(conn, wid, "undo-a", r1)
    assert s2.purpose != "改过"
    r3, s3 = undo_last(conn, wid, "undo-b", r2)
    assert r3 == r2 + 1
    assert s3.purpose == "改过"


def test_undo_stale_revision(conn, tutorial):
    wid, rev, _ = tutorial
    r1, _ = apply_patch(conn, wid, "set-2", rev, [SetPurpose(text="a")])
    apply_patch(conn, wid, "set-3", r1, [SetPurpose(text="b")])
    with pytest.raises(ConflictError):
        undo_last(conn, wid, "undo-stale", r1)


def test_undo_via_get_workspace(conn, tutorial):
    wid, rev, snap = tutorial
    piece_ids_before = {p.id for p in snap.pieces}
    r1, _ = apply_patch(conn, wid, "del-3", rev, [RemovePiece(piece_id="p-reply")])
    undo_last(conn, wid, "undo-3", r1)
    ws = get_workspace(conn, wid)
    assert {p.id for p in ws["snapshot"].pieces} == piece_ids_before
