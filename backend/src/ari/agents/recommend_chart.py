from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field

from ..domain.recommend_chart import RecommendChart

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "recommend_chart.md"


class RecommendChartOutput(BaseModel):
    chart: RecommendChart
    reason: str = Field(min_length=1)


def render_recommend_prompt(context: dict[str, str]) -> str:
    template = PROMPT_PATH.read_text(encoding="utf-8")
    for key, value in context.items():
        template = template.replace("{" + key + "}", str(value))
    return template
