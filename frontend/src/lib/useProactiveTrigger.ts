import { useEffect, useRef } from "react";
import { useChat } from "../store/chat";
import { useWorkspace } from "../store/workspace";
import type { Stage } from "./types";
import { detectSignals } from "./nudgeSignals";

const RULE_COOLDOWN_MS = 5 * 60 * 1000;
const GLOBAL_COOLDOWN_MS = 3 * 60 * 1000;

/**
 * 根据快照信号触发主动提示。必须在 ChatProvider 内使用。
 * - stage_entry：每个 (工作区, 阶段) 只评估一次；
 * - structure_issue：随 revision/snapshot 变化评估；
 * - 冷却：(ruleId, stage) 5 分钟 + 全局发言 3 分钟。
 */
export function useProactiveTrigger({
  workspaceId,
  stage,
}: {
  workspaceId: string;
  stage: Stage;
}): void {
  const { snapshot, revision } = useWorkspace();
  const chat = useChat();
  const { sendNudge, sending, messages } = chat;

  const lastByRule = useRef<Map<string, number>>(new Map());
  const lastSpokeAt = useRef(0);
  const lastEntryKey = useRef<string | null>(null);
  const inFlight = useRef(false);

  const hasPendingProposal = messages.some(
    (m) => m.stage === stage && m.proposalStatus === "pending",
  );

  useEffect(() => {
    if (!snapshot || sending || hasPendingProposal || inFlight.current) return;

    const entryKey = `${workspaceId}:${stage}`;
    const firstEvalForStage = lastEntryKey.current !== entryKey;

    const signal = detectSignals(snapshot, stage);
    if (!signal) {
      lastEntryKey.current = entryKey;
      return;
    }
    if (signal.trigger === "stage_entry" && !firstEvalForStage) return;

    const now = Date.now();
    if (now - lastSpokeAt.current < GLOBAL_COOLDOWN_MS) return;
    const ruleKey = `${signal.ruleId}:${stage}`;
    const last = lastByRule.current.get(ruleKey);
    if (last !== undefined && now - last < RULE_COOLDOWN_MS) return;

    // 冷却通过后才标记已见，被冷却挡住的首次评估之后仍可重试。
    lastEntryKey.current = entryKey;
    // 尝试即记冷却，沉默（204）也不立刻重试。
    lastByRule.current.set(ruleKey, now);
    inFlight.current = true;
    void sendNudge(signal.trigger, signal.ruleId)
      .then((spoke) => {
        if (spoke) lastSpokeAt.current = Date.now();
      })
      .catch((e) => {
        console.warn("proactive nudge failed", e);
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [workspaceId, stage, revision, snapshot, sending, hasPendingProposal, sendNudge]);
}
