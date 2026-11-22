from __future__ import annotations

import hashlib
import json
from typing import Literal

from ..models import WorkspaceSnapshot
from .grouping import GroupedViewError, build_grouped_view

Trigger = Literal["stage_entry", "structure_issue", "idle"]
RuleId = Literal["stage_entry", "unassigned_pieces", "no_pillars", "purpose_empty"]

STRUCTURE_RULES_BY_STAGE: dict[str, set[RuleId]] = {
    "purpose": {"purpose_empty"},
    "piece": {"purpose_empty"},
    "pillar": {"unassigned_pieces", "no_pillars"},
}


def content_piece_count(snapshot: WorkspaceSnapshot) -> int:
    return sum(1 for p in snapshot.pieces if p.id != snapshot.root_id)


def unassigned_count(snapshot: WorkspaceSnapshot) -> int:
    pid = snapshot.active_perspective_id
    if not pid:
        return 0
    try:
        return len(build_grouped_view(snapshot, pid).unassigned)
    except GroupedViewError:
        return 0


def pillar_count(snapshot: WorkspaceSnapshot) -> int:
    pid = snapshot.active_perspective_id
    if not pid:
        return 0
    return sum(1 for p in snapshot.pillars if p.perspective_id == pid)


def stage_is_empty(snapshot: WorkspaceSnapshot, stage: str) -> bool:
    if stage == "purpose":
        return not snapshot.purpose.strip()
    if stage == "piece":
        return content_piece_count(snapshot) == 0
    if stage == "perspective":
        return len(snapshot.perspectives) == 0
    if stage == "pillar":
        return pillar_count(snapshot) == 0
    if stage == "presentation":
        return True  # 表达页无「空」语义；固定引导用，不调 LLM
    return False


def prior_stages_have_content(snapshot: WorkspaceSnapshot, stage: str) -> bool:
    if stage == "purpose":
        return False
    if stage == "piece":
        return bool(snapshot.purpose.strip())
    if stage == "perspective":
        return bool(snapshot.purpose.strip()) or content_piece_count(snapshot) > 0
    if stage == "pillar":
        return len(snapshot.perspectives) > 0
    if stage == "presentation":
        return pillar_count(snapshot) > 0 or content_piece_count(snapshot) > 0
    return False


def rule_holds(snapshot: WorkspaceSnapshot, rule_id: RuleId, stage: str) -> bool:
    if rule_id == "stage_entry":
        return stage_is_empty(snapshot, stage) and prior_stages_have_content(
            snapshot, stage
        )
    allowed = STRUCTURE_RULES_BY_STAGE.get(stage, set())
    if rule_id not in allowed:
        return False
    pieces = content_piece_count(snapshot)
    if rule_id == "unassigned_pieces":
        return unassigned_count(snapshot) >= 5
    if rule_id == "no_pillars":
        return pillar_count(snapshot) == 0 and pieces >= 3
    if rule_id == "purpose_empty":
        return not snapshot.purpose.strip() and pieces >= 5
    return False


def observed_values(snapshot: WorkspaceSnapshot, rule_id: RuleId) -> dict:
    return {
        "pieces": content_piece_count(snapshot),
        "unassigned": unassigned_count(snapshot),
        "pillars": pillar_count(snapshot),
        "purpose_empty": not snapshot.purpose.strip(),
        "perspectives": len(snapshot.perspectives),
        "rule_id": rule_id,
    }


def content_fingerprint(snapshot: WorkspaceSnapshot, rule_id: RuleId) -> str:
    """只哈希与该规则相关的内容，避免无关编辑导致缓存失效。"""
    if rule_id == "purpose_empty":
        payload = {"purpose": snapshot.purpose, "pieces": content_piece_count(snapshot)}
    elif rule_id == "unassigned_pieces":
        pid = snapshot.active_perspective_id
        payload = {
            "perspective": pid,
            "unassigned": unassigned_count(snapshot),
            "assignments": [
                a.model_dump()
                for a in snapshot.assignments
                if a.perspective_id == pid
            ],
        }
    elif rule_id == "no_pillars":
        pid = snapshot.active_perspective_id
        payload = {
            "perspective": pid,
            "pillars": pillar_count(snapshot),
            "pieces": content_piece_count(snapshot),
        }
    else:  # stage_entry
        payload = {
            "purpose": snapshot.purpose,
            "pieces": content_piece_count(snapshot),
            "perspectives": [p.model_dump() for p in snapshot.perspectives],
            "pillars": pillar_count(snapshot),
        }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()
