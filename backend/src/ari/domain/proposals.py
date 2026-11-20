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
from .workspace import ConflictError, ReceiptConflictError, payload_hash

operation_list = TypeAdapter(list[Operation])


class ProposalResolvedError(ValueError):
    """提案已处理，不能再次解决。"""


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
) -> None:
    conn.execute(
        "INSERT INTO messages "
        "(id, workspace_id, stage, request_id, question, base_revision, status, "
        "reply, proposal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            _now(),
        ),
    )


def get_message_by_request_id(
    conn: sqlite3.Connection, request_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM messages WHERE request_id = ?", (request_id,)
    ).fetchone()


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
    """解决提案；accept/edit 应用操作并推进 revision，ignore 仅标记状态。"""
    conn.execute("BEGIN IMMEDIATE")
    try:
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

        if action == "accept":
            ops = operation_list.validate_python(json.loads(prop["change_set"]))
        elif action == "edit":
            ops = operations or []
        else:  # ignore
            ops = []

        # 幂等检查（仅 accept/edit 产生 mutation）。
        if ops:
            receipt = conn.execute(
                "SELECT * FROM mutation_receipts WHERE request_id = ?", (request_id,)
            ).fetchone()
            if receipt is not None:
                if receipt["workspace_id"] != workspace_id:
                    raise ReceiptConflictError("request_id 属于另一个工作区")
                if receipt["payload_hash"] != payload_hash(base_revision, ops):
                    raise ReceiptConflictError("同一 request_id 对应不同载荷")
                conn.commit()
                return receipt["revision"], WorkspaceSnapshot.model_validate_json(
                    receipt["result"]
                )

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
                "INSERT INTO mutation_receipts "
                "(request_id, workspace_id, revision, payload_hash, result) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    request_id,
                    workspace_id,
                    new_revision,
                    payload_hash(base_revision, ops),
                    snapshot.model_dump_json(),
                ),
            )
        conn.execute(
            "UPDATE proposals SET status = ? WHERE id = ?", (action, proposal_id)
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return new_revision, snapshot
