"""SQLite 连接与建表（幂等 DDL）。

本地单用户 MVP：每次请求打开一个独立连接（FastAPI 同步端点运行在线程池），
写入用 WAL + BEGIN IMMEDIATE 串行化。领域状态以 JSON 快照存 ``workspaces.snapshot``，
版本用 ``revision`` 整数乐观并发。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    root_id TEXT NOT NULL,
    active_perspective_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
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

CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    base_revision INTEGER NOT NULL,
    refs TEXT NOT NULL,
    change_set TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mutation_receipts (
    request_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    payload_hash TEXT NOT NULL,
    result TEXT NOT NULL,
    prev_snapshot TEXT
);

CREATE TABLE IF NOT EXISTS resolve_receipts (
    request_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    action TEXT NOT NULL,
    revision INTEGER NOT NULL,
    result TEXT NOT NULL,
    status TEXT NOT NULL,
    prev_snapshot TEXT
);
"""


def connect(path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.isolation_level = None  # autocommit；事务由调用方用 BEGIN IMMEDIATE 显式控制
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """幂等建表 + 旧库迁移。"""
    conn.executescript(_SCHEMA)
    # 迁移：旧库 messages 无 piece_id 列，补上（新增表无需此步）。
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(messages)")}
    if "piece_id" not in cols:
        conn.execute("ALTER TABLE messages ADD COLUMN piece_id TEXT")
    # 迁移：收据表补 prev_snapshot，供撤销上一步。
    for table in ("mutation_receipts", "resolve_receipts"):
        tcols = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if "prev_snapshot" not in tcols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN prev_snapshot TEXT")
    conn.commit()
