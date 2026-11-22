import type { NudgeRuleId, NudgeTrigger as ApiNudgeTrigger } from "../api/client";
import type { Snapshot, Stage } from "./types";

// 前端信号检测只产生这两类触发；idle 由 Task 7 的空闲计时单独处理。
export type NudgeTrigger = Exclude<ApiNudgeTrigger, "idle">;
export type { NudgeRuleId };

export function contentPieceCount(s: Snapshot): number {
  return s.pieces.filter((p) => p.id !== s.root_id).length;
}

export function unassignedCount(s: Snapshot): number {
  const pid = s.active_perspective_id;
  if (!pid) return 0;
  const content = s.pieces.filter((p) => p.id !== s.root_id);
  let n = 0;
  for (const p of content) {
    const a = s.assignments.find(
      (x) => x.perspective_id === pid && x.piece_id === p.id,
    );
    if (!a || a.pillar_id == null) n += 1;
  }
  return n;
}

export function pillarCount(s: Snapshot): number {
  const pid = s.active_perspective_id;
  if (!pid) return 0;
  return s.pillars.filter((p) => p.perspective_id === pid).length;
}

export function stageIsEmpty(s: Snapshot, stage: Stage): boolean {
  if (stage === "purpose") return !s.purpose.trim();
  if (stage === "piece") return contentPieceCount(s) === 0;
  if (stage === "perspective") return s.perspectives.length === 0;
  if (stage === "pillar") return pillarCount(s) === 0;
  return true;
}

export function priorStagesHaveContent(s: Snapshot, stage: Stage): boolean {
  if (stage === "purpose") return false;
  if (stage === "piece") return !!s.purpose.trim();
  if (stage === "perspective")
    return !!s.purpose.trim() || contentPieceCount(s) > 0;
  if (stage === "pillar") return s.perspectives.length > 0;
  return pillarCount(s) > 0 || contentPieceCount(s) > 0;
}

export function stageNeedsFixedEntryGuide(s: Snapshot, stage: Stage): boolean {
  return stageIsEmpty(s, stage) && !priorStagesHaveContent(s, stage);
}

/** 同轮只返回一个：structure_issue > stage_entry */
export function detectSignals(
  s: Snapshot,
  stage: Stage,
): { trigger: NudgeTrigger; ruleId: NudgeRuleId } | null {
  const pieces = contentPieceCount(s);
  if (stage === "pillar") {
    if (unassignedCount(s) >= 5)
      return { trigger: "structure_issue", ruleId: "unassigned_pieces" };
    if (pillarCount(s) === 0 && pieces >= 3)
      return { trigger: "structure_issue", ruleId: "no_pillars" };
  }
  if ((stage === "purpose" || stage === "piece") && !s.purpose.trim() && pieces >= 5) {
    return { trigger: "structure_issue", ruleId: "purpose_empty" };
  }
  if (stageIsEmpty(s, stage) && priorStagesHaveContent(s, stage) && stage !== "presentation") {
    return { trigger: "stage_entry", ruleId: "stage_entry" };
  }
  return null;
}
