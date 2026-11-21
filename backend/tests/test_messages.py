"""消息历史读取与发送幂等。"""

import pytest
from fastapi import HTTPException

from ari.api.schemas import MessageRequest
from ari.api.workspaces import list_messages_endpoint, send_message
from ari.domain.operations import SetPurpose
from ari.domain.proposals import list_messages, list_recent_messages, store_message_and_proposal
from ari.domain.workspace import create_workspace


def _insert_message(
    conn, workspace_id, msg_id, question, created_at, request_id, status="done"
):
    conn.execute(
        "INSERT INTO messages "
        "(id, workspace_id, stage, request_id, question, base_revision, status, "
        "reply, proposal_id, piece_id, created_at) "
        "VALUES (?, ?, 'piece', ?, ?, 1, ?, 'reply', NULL, NULL, ?)",
        (msg_id, workspace_id, request_id, question, status, created_at),
    )


def test_list_messages_pagination_and_cursor(conn, tutorial):
    wid, _, _ = tutorial
    _insert_message(conn, wid, "m1", "q1", "2026-01-01T00:00:01+00:00", "r1")
    _insert_message(conn, wid, "m2", "q2", "2026-01-01T00:00:02+00:00", "r2")
    _insert_message(conn, wid, "m3", "q3", "2026-01-01T00:00:03+00:00", "r3")

    rows, next_before = list_messages(conn, wid, limit=2)
    # 页面内按时间正序。
    assert [r["id"] for r in rows] == ["m2", "m3"]
    assert next_before is not None

    rows2, next2 = list_messages(conn, wid, limit=2, before=next_before)
    assert [r["id"] for r in rows2] == ["m1"]
    assert next2 is None


def test_list_messages_isolated_by_workspace(conn, tutorial):
    wid, _, _ = tutorial
    _insert_message(conn, wid, "m1", "q1", "2026-01-01T00:00:01+00:00", "r1")
    other, _, _ = create_workspace(conn, None)
    rows, _ = list_messages(conn, other)
    assert rows == []


def test_list_recent_messages_limit_and_order(conn, tutorial):
    wid, _, _ = tutorial
    for i in (1, 2, 3):
        _insert_message(
            conn, wid, f"m{i}", f"q{i}", f"2026-01-01T00:00:0{i}+00:00", f"r{i}"
        )
    recent = list_recent_messages(conn, wid, limit=2)
    assert [r["question"] for r in recent] == ["q2", "q3"]

    # 非 done 消息不进上下文。
    _insert_message(
        conn, wid, "m4", "q4", "2026-01-01T00:00:04+00:00", "r4", status="queued"
    )
    recent = list_recent_messages(conn, wid, limit=10)
    assert "q4" not in [r["question"] for r in recent]


def test_send_message_replay_returns_stored(conn, tutorial):
    wid, rev, _ = tutorial
    store_message_and_proposal(
        conn, wid, "piece", "req-1", "原始问题", rev, "回复文本", [], {"message": "req-1"}
    )
    res = send_message(
        wid,
        MessageRequest(
            request_id="req-1", stage="piece", question="原始问题", base_revision=rev
        ),
        conn=conn,
    )
    assert res.reply == "回复文本"
    assert res.proposal_id is None


def test_send_message_replay_payload_mismatch_conflicts(conn, tutorial):
    wid, rev, _ = tutorial
    store_message_and_proposal(
        conn, wid, "piece", "req-1", "原始问题", rev, "回复文本", [], {"message": "req-1"}
    )
    with pytest.raises(HTTPException) as ei:
        send_message(
            wid,
            MessageRequest(
                request_id="req-1", stage="piece", question="不同问题", base_revision=rev
            ),
            conn=conn,
        )
    assert ei.value.status_code == 409


def test_send_message_invalid_piece_id_rejected(conn, tutorial):
    wid, rev, _ = tutorial
    with pytest.raises(HTTPException) as ei:
        send_message(
            wid,
            MessageRequest(
                request_id="fresh",
                stage="piece",
                question="问",
                base_revision=rev,
                piece_id="does-not-exist",
            ),
            conn=conn,
        )
    assert ei.value.status_code == 422


def test_list_messages_endpoint_attaches_proposal(conn, tutorial):
    wid, rev, _ = tutorial
    store_message_and_proposal(
        conn,
        wid,
        "purpose",
        "req-1",
        "改写目的",
        rev,
        "回复",
        [SetPurpose(text="新目的")],
        {"message": "req-1"},
    )
    page = list_messages_endpoint(wid, conn=conn)
    assert len(page.messages) == 1
    assert page.messages[0].question == "改写目的"
    assert page.messages[0].proposal is not None
    assert page.messages[0].proposal.status == "pending"
    assert page.messages[0].proposal.change_set[0].type == "set_purpose"
