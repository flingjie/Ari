"""消息与提案仓库 + 提案解决（accept / edit / ignore）。

提案的 ``change_set`` 是 operation 数组，与 PATCH 共用同一校验路径。
接受时与结构修改原子提交；旧提议不能覆盖新内容（base_revision 校验 + 幂等收据）。
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime

from pydantic import TypeAdapter

from ..models import WorkspaceSnapshot
from .operations import Operation, apply_all
from .workspace import ConflictError, ReceiptConflictError

operation_list = TypeAdapter(list[Operation])


class ProposalResolvedError(ValueError):
    """提案已处理，不能再次解决。"""


class StaleProposalError(ValueError):
    """提案基于旧内容生成，采纳/改写前需重新生成。"""

    def __init__(self, current_revision: int) -> None:
        super().__init__("提案基于旧内容生成，请基于最新内容重新生成")
        self.current_revision = current_revision


def _now() -> str:
    return datetime.now(UTC).isoformat()


def create_message(
    conn: sqlite3.Connection,
    workspace_id: str,
    stage: str,
    request_id: str,
    question: str,
    base_revision: int,
    reply: str,
    proposal_id: str | None,
    piece_id: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO messages "
        "(id, workspace_id, stage, request_id, question, base_revision, status, "
        "reply, proposal_id, piece_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            uuid.uuid4().hex,
            workspace_id,
            stage,
            request_id,
            question,
            base_revision,
            "done",
            reply,
            proposal_id,
            piece_id,
            _now(),
        ),
    )


def get_message_by_request_id(
    conn: sqlite3.Connection, request_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM messages WHERE request_id = ?", (request_id,)
    ).fetchone()


def get_proposal(
    conn: sqlite3.Connection, proposal_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM proposals WHERE id = ?", (proposal_id,)
    ).fetchone()


def _decode_cursor(cursor: str | None) -> tuple[str, str] | None:
    """游标编码 ``created_at|id``；稳定排序键。"""
    if not cursor:
        return None
    created_at, _, msg_id = cursor.partition("|")
    return (created_at, msg_id) if msg_id else None


def list_messages(
    conn: sqlite3.Connection,
    workspace_id: str,
    limit: int = 30,
    before: str | None = None,
) -> tuple[list[dict], str | None]:
    """返回一页消息（页面内按时间正序）与下一页游标（更早的消息）。"""
    key = _decode_cursor(before)
    if key:
        rows = conn.execute(
            "SELECT * FROM messages WHERE workspace_id = ? AND (created_at, id) < (?, ?) "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (workspace_id, key[0], key[1], limit + 1),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM messages WHERE workspace_id = ? "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (workspace_id, limit + 1),
        ).fetchall()
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = None
    if has_more and page:
        last = page[-1]
        next_cursor = f"{last['created_at']}|{last['id']}"
    page.reverse()
    return [dict(r) for r in page], next_cursor


def list_recent_messages(
    conn: sqlite3.Connection, workspace_id: str, limit: int = 6
) -> list[dict]:
    """最近若干条已完成问答（旧→新），用于多轮上下文。"""
    rows = conn.execute(
        "SELECT stage, question, reply FROM messages WHERE workspace_id = ? "
        "AND status = 'done' ORDER BY created_at DESC, id DESC LIMIT ?",
        (workspace_id, limit),
    ).fetchall()
    rows = list(rows)
    rows.reverse()
    return [dict(r) for r in rows]


def create_proposal(
    conn: sqlite3.Connection,
    workspace_id: str,
    stage: str,
    base_revision: int,
    refs: dict,
    change_set: list[Operation],
) -> str:
    proposal_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO proposals "
        "(id, workspace_id, stage, base_revision, refs, change_set, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            proposal_id,
            workspace_id,
            stage,
            base_revision,
            json.dumps(refs, ensure_ascii=False),
            json.dumps([op.model_dump() for op in change_set], ensure_ascii=False),
            "pending",
            _now(),
        ),
    )
    return proposal_id


def store_message_and_proposal(
    conn: sqlite3.Connection,
    workspace_id: str,
    stage: str,
    request_id: str,
    question: str,
    base_revision: int,
    reply: str,
    change_set: list[Operation],
    refs: dict,
    piece_id: str | None = None,
) -> str | None:
    """在一个事务内写入消息 + 待处理提案，返回 proposal_id（无提案则为 None）。"""
    conn.execute("BEGIN IMMEDIATE")
    try:
        proposal_id = None
        if change_set:
            proposal_id = create_proposal(
                conn, workspace_id, stage, base_revision, refs, change_set
            )
        create_message(
            conn,
            workspace_id,
            stage,
            request_id,
            question,
            base_revision,
            reply,
            proposal_id,
            piece_id,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return proposal_id


def list_pending_proposals(
    conn: sqlite3.Connection, workspace_id: str
) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM proposals WHERE workspace_id = ? AND status = 'pending' "
        "ORDER BY created_at",
        (workspace_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def resolve_proposal(
    conn: sqlite3.Connection,
    workspace_id: str,
    proposal_id: str,
    request_id: str,
    base_revision: int,
    action: str,
    operations: list[Operation] | None,
) -> tuple[int, WorkspaceSnapshot]:
    """解决提案；accept/edit 应用操作并推进 revision，ignore 仅标记状态。

    三种动作统一幂等：重复 resolve 按 request_id 命中 resolve_receipts 返回原结果。
    accept/edit 额外要求提案自身的 base_revision 与当前 revision 一致，避免旧建议覆盖新内容。
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        receipt = conn.execute(
            "SELECT * FROM resolve_receipts WHERE request_id = ?", (request_id,)
        ).fetchone()
        if receipt is not None:
            if receipt["workspace_id"] != workspace_id:
                raise ReceiptConflictError("request_id 属于另一个工作区")
            if receipt["proposal_id"] != proposal_id or receipt["action"] != action:
                raise ReceiptConflictError("同一 request_id 对应不同载荷")
            conn.commit()
            return receipt["revision"], WorkspaceSnapshot.model_validate_json(
                receipt["result"]
            )

        prop = conn.execute(
            "SELECT * FROM proposals WHERE id = ?", (proposal_id,)
        ).fetchone()
        if prop is None:
            raise LookupError("提案不存在")
        if prop["workspace_id"] != workspace_id:
            raise LookupError("提案不属于该工作区")
        if prop["status"] != "pending":
            raise ProposalResolvedError("提案已处理")

        row = conn.execute(
            "SELECT * FROM workspaces WHERE id = ?", (workspace_id,)
        ).fetchone()
        if row is None:
            raise LookupError("工作区不存在")
        if base_revision != row["revision"]:
            raise ConflictError(row["revision"])
        if action in ("accept", "edit") and prop["base_revision"] != row["revision"]:
            raise StaleProposalError(row["revision"])

        if action == "accept":
            ops = operation_list.validate_python(json.loads(prop["change_set"]))
        elif action == "edit":
            ops = operations or []
        else:  # ignore
            ops = []

        snapshot = WorkspaceSnapshot.model_validate_json(row["snapshot"])
        if ops:
            apply_all(snapshot, ops)

        new_revision = row["revision"] + (1 if ops else 0)
        if ops:
            conn.execute(
                "UPDATE workspaces SET revision = ?, snapshot = ?, root_id = ?, "
                "active_perspective_id = ?, updated_at = ? WHERE id = ?",
                (
                    new_revision,
                    snapshot.model_dump_json(),
                    snapshot.root_id,
                    snapshot.active_perspective_id,
                    _now(),
                    workspace_id,
                ),
            )
        conn.execute(
            "UPDATE proposals SET status = ? WHERE id = ?", (action, proposal_id)
        )
        conn.execute(
            "INSERT INTO resolve_receipts "
            "(request_id, workspace_id, proposal_id, action, revision, result, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                request_id,
                workspace_id,
                proposal_id,
                action,
                new_revision,
                snapshot.model_dump_json(),
                action,
            ),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return new_revision, snapshot
