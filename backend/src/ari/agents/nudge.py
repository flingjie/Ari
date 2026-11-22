from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field, create_model

from .stage import OUTPUT_MODELS, Stage

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "nudge.md"

TRIGGER_LABELS = {
    "stage_entry": "用户刚进入当前阶段，且该阶段尚无内容，但前面阶段已有材料",
    "structure_issue": "结构候选信号命中（不是断言用户做错了，只是值得看一眼）",
    "idle": "用户在本页停顿了一段时间",
}

RULE_LABELS = {
    "stage_entry": "进入空阶段（有前序内容）",
    "unassigned_pieces": "待归类片段偏多（≥5）",
    "no_pillars": "已有片段但尚无支柱",
    "purpose_empty": "片段较多但目的仍空",
}


def nudge_output_model(stage: Stage) -> type[BaseModel]:
    base = OUTPUT_MODELS[stage]
    return create_model(
        f"Nudge{base.__name__}",
        __base__=base,
        speak=(bool, Field(..., description="是否值得打扰用户；无明确增益则为 false")),
    )


def render_nudge_prompt(
    stage: Stage,
    context: dict[str, str],
    *,
    trigger: str,
    rule_id: str,
    observed: dict,
    recent_actions: list[str],
) -> str:
    template = PROMPT_PATH.read_text(encoding="utf-8")
    replacements = {
        **context,
        "trigger": trigger,
        "trigger_label": TRIGGER_LABELS.get(trigger, trigger),
        "rule_id": rule_id,
        "rule_label": RULE_LABELS.get(rule_id, rule_id),
        "observed_values": json.dumps(observed, ensure_ascii=False),
        "recent_actions": "\n".join(f"- {a}" for a in recent_actions) or "（无）",
        "stage": stage,
    }
    for key, value in replacements.items():
        template = template.replace("{" + key + "}", str(value))
    return template
