"""主动引导的进程内运行时状态：并发闸门与「沉默」缓存。

单进程内存态，重启即清空——对「别打扰用户」的软约束足够。
"""

from __future__ import annotations

_in_flight: set[str] = set()
# key: (workspace_id, rule_id, stage, fingerprint)
_silence: set[tuple[str, str, str, str]] = set()


def clear() -> None:
    _in_flight.clear()
    _silence.clear()


def try_begin(workspace_id: str) -> bool:
    if workspace_id in _in_flight:
        return False
    _in_flight.add(workspace_id)
    return True


def end(workspace_id: str) -> None:
    _in_flight.discard(workspace_id)


def silence_hit(workspace_id: str, rule_id: str, stage: str, fingerprint: str) -> bool:
    return (workspace_id, rule_id, stage, fingerprint) in _silence


def record_silence(
    workspace_id: str, rule_id: str, stage: str, fingerprint: str
) -> None:
    _silence.add((workspace_id, rule_id, stage, fingerprint))
