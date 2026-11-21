"""工作区仓库：快照持久化、乐观并发、幂等收据、事务。

写请求带 ``request_id`` + ``base_revision``；服务端在单个事务内：
查幂等收据 → 校验版本 → 应用操作 → 写快照与收据 → 提交。
重复请求返回原结果；同一 ID 不同载荷报错；版本不符抛 ConflictError（409）。
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import UTC, datetime

from ..models import WorkspaceSnapshot
from .operations import Operation, apply_all
from .seed import build_snapshot


class ConflictError(RuntimeError):
    """版本不符（409）。"""

    def __init__(self, current_revision: int) -> None:
        super().__init__(f"base_revision 已过期，当前 revision={current_revision}")
        self.current_revision = current_revision


class ReceiptConflictError(RuntimeError):
    """同一 request_id 对应不同载荷，或属于另一工作区。"""


class NothingToUndoError(RuntimeError):
    """当前 revision 没有可回滚的收据，或旧收据缺少 prev_snapshot。"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def payload_hash(base_revision: int, operations: list[Operation]) -> str:
    payload = {
        "base_revision": base_revision,
        "operations": [op.model_dump() for op in operations],
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def undo_payload_hash(base_revision: int) -> str:
    raw = json.dumps(
        {"undo": True, "base_revision": base_revision}, sort_keys=True, ensure_ascii=False
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_workspace(
    conn: sqlite3.Connection, template: str | None
) -> tuple[str, int, WorkspaceSnapshot]:
    """新建工作区，返回 (id, revision, snapshot)。"""
    snapshot = build_snapshot(template)
    workspace_id = uuid.uuid4().hex
    revision = 1
    now = _now()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            "INSERT INTO workspaces "
            "(id, revision, snapshot, root_id, active_perspective_id, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                workspace_id,
                revision,
                snapshot.model_dump_json(),
                snapshot.root_id,
                snapshot.active_perspective_id,
                now,
                now,
            ),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return workspace_id, revision, snapshot


def get_workspace(
    conn: sqlite3.Connection, workspace_id: str
) -> dict | None:
    row = conn.execute(
        "SELECT * FROM workspaces WHERE id = ?", (workspace_id,)
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "revision": row["revision"],
        "snapshot": WorkspaceSnapshot.model_validate_json(row["snapshot"]),
        "root_id": row["root_id"],
        "active_perspective_id": row["active_perspective_id"],
    }


def _receipt_to_result(
    receipt: sqlite3.Row, workspace_id: str, base_revision: int, operations: list[Operation]
) -> tuple[int, WorkspaceSnapshot]:
    if receipt["workspace_id"] != workspace_id:
        raise ReceiptConflictError("request_id 属于另一个工作区")
    if receipt["payload_hash"] != payload_hash(base_revision, operations):
        raise ReceiptConflictError("同一 request_id 对应不同载荷")
    return receipt["revision"], WorkspaceSnapshot.model_validate_json(receipt["result"])


def apply_patch(
    conn: sqlite3.Connection,
    workspace_id: str,
    request_id: str,
    base_revision: int,
    operations: list[Operation],
) -> tuple[int, WorkspaceSnapshot]:
    """幂等地应用一组操作，返回 (新 revision, 新快照)。"""
    # 快路径：无锁读取已存在的收据。
    receipt = conn.execute(
        "SELECT * FROM mutation_receipts WHERE request_id = ?", (request_id,)
    ).fetchone()
    if receipt is not None:
        return _receipt_to_result(receipt, workspace_id, base_revision, operations)

    conn.execute("BEGIN IMMEDIATE")
    try:
        # 事务内复查，防止同一 request_id 并发竞态。
        receipt = conn.execute(
            "SELECT * FROM mutation_receipts WHERE request_id = ?", (request_id,)
        ).fetchone()
        if receipt is not None:
            result = _receipt_to_result(receipt, workspace_id, base_revision, operations)
            conn.commit()
            return result

        row = conn.execute(
            "SELECT * FROM workspaces WHERE id = ?", (workspace_id,)
        ).fetchone()
        if row is None:
            raise LookupError(f"工作区不存在: {workspace_id}")
        current_revision = row["revision"]
        if base_revision != current_revision:
            raise ConflictError(current_revision)

        prev_snapshot = row["snapshot"]
        snapshot = WorkspaceSnapshot.model_validate_json(prev_snapshot)
        apply_all(snapshot, operations)

        new_revision = current_revision + 1
        result_json = snapshot.model_dump_json()
        conn.execute(
            "UPDATE workspaces SET revision = ?, snapshot = ?, root_id = ?, "
            "active_perspective_id = ?, updated_at = ? WHERE id = ?",
            (
                new_revision,
                result_json,
                snapshot.root_id,
                snapshot.active_perspective_id,
                _now(),
                workspace_id,
            ),
        )
        conn.execute(
            "INSERT INTO mutation_receipts "
            "(request_id, workspace_id, revision, payload_hash, result, prev_snapshot) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                request_id,
                workspace_id,
                new_revision,
                payload_hash(base_revision, operations),
                result_json,
                prev_snapshot,
            ),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return new_revision, snapshot


def _find_prev_snapshot(
    conn: sqlite3.Connection, workspace_id: str, revision: int
) -> str | None:
    """在 mutation / resolve 收据中找推进到该 revision 的 prev_snapshot。"""
    row = conn.execute(
        "SELECT prev_snapshot FROM mutation_receipts "
        "WHERE workspace_id = ? AND revision = ?",
        (workspace_id, revision),
    ).fetchone()
    if row is not None and row["prev_snapshot"]:
        return row["prev_snapshot"]
    row = conn.execute(
        "SELECT prev_snapshot FROM resolve_receipts "
        "WHERE workspace_id = ? AND revision = ?",
        (workspace_id, revision),
    ).fetchone()
    if row is not None and row["prev_snapshot"]:
        return row["prev_snapshot"]
    return None


def undo_last(
    conn: sqlite3.Connection,
    workspace_id: str,
    request_id: str,
    base_revision: int,
) -> tuple[int, WorkspaceSnapshot]:
    """把工作区回滚到当前 revision 写入前的快照；undo 本身可幂等、可再次 undo。"""
    receipt = conn.execute(
        "SELECT * FROM mutation_receipts WHERE request_id = ?", (request_id,)
    ).fetchone()
    if receipt is not None:
        if receipt["workspace_id"] != workspace_id:
            raise ReceiptConflictError("request_id 属于另一个工作区")
        if receipt["payload_hash"] != undo_payload_hash(base_revision):
            raise ReceiptConflictError("同一 request_id 对应不同载荷")
        return receipt["revision"], WorkspaceSnapshot.model_validate_json(receipt["result"])

    conn.execute("BEGIN IMMEDIATE")
    try:
        receipt = conn.execute(
            "SELECT * FROM mutation_receipts WHERE request_id = ?", (request_id,)
        ).fetchone()
        if receipt is not None:
            if receipt["workspace_id"] != workspace_id:
                raise ReceiptConflictError("request_id 属于另一个工作区")
            if receipt["payload_hash"] != undo_payload_hash(base_revision):
                raise ReceiptConflictError("同一 request_id 对应不同载荷")
            result = (
                receipt["revision"],
                WorkspaceSnapshot.model_validate_json(receipt["result"]),
            )
            conn.commit()
            return result

        row = conn.execute(
            "SELECT * FROM workspaces WHERE id = ?", (workspace_id,)
        ).fetchone()
        if row is None:
            raise LookupError(f"工作区不存在: {workspace_id}")
        current_revision = row["revision"]
        if base_revision != current_revision:
            raise ConflictError(current_revision)

        prev_json = _find_prev_snapshot(conn, workspace_id, current_revision)
        if prev_json is None:
            raise NothingToUndoError("没有可撤销的步骤")

        snapshot = WorkspaceSnapshot.model_validate_json(prev_json)
        new_revision = current_revision + 1
        result_json = snapshot.model_dump_json()
        conn.execute(
            "UPDATE workspaces SET revision = ?, snapshot = ?, root_id = ?, "
            "active_perspective_id = ?, updated_at = ? WHERE id = ?",
            (
                new_revision,
                result_json,
                snapshot.root_id,
                snapshot.active_perspective_id,
                _now(),
                workspace_id,
            ),
        )
        conn.execute(
            "INSERT INTO mutation_receipts "
            "(request_id, workspace_id, revision, payload_hash, result, prev_snapshot) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                request_id,
                workspace_id,
                new_revision,
                undo_payload_hash(base_revision),
                result_json,
                row["snapshot"],
            ),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return new_revision, snapshot


__all__ = [
    "ConflictError",
    "ReceiptConflictError",
    "NothingToUndoError",
    "create_workspace",
    "get_workspace",
    "apply_patch",
    "undo_last",
    "payload_hash",
]
