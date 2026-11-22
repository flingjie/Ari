// 侧栏对话状态：单工作区一条连续对话，跨阶段保留，历史可恢复。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  ApiError,
  type MessageSummary,
  type NudgeRuleId,
  type NudgeTrigger,
  type ProposalSummary,
} from "../api/client";
import { pushRecentAction } from "../lib/recentActions";
import type { Stage } from "../lib/types";
import { useWorkspace } from "./workspace";

export type ProposalStatus = "none" | "pending" | "accept" | "ignore" | "stale";

export interface ChatMessage {
  id: string;
  requestId: string;
  stage: Stage;
  question: string;
  reply: string | null;
  proposalId: string | null;
  proposalStatus: ProposalStatus;
  proposal: ProposalSummary | null;
  pieceId: string | null;
  createdAt: string;
  error?: string;
}

interface ChatContextValue {
  messages: ChatMessage[];
  sending: boolean;
  draft: string;
  setDraft: (v: string) => void;
  error: string;
  selectedPieceId: string | null;
  setSelectedPieceId: (id: string | null) => void;
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  send: (question?: string) => Promise<void>;
  retry: (messageId: string) => Promise<void>;
  resolve: (proposalId: string, action: "accept" | "ignore") => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  /** Task 6 stub；Task 7 替换为带 revision 丢弃逻辑的真实实现。返回是否真的发言。 */
  sendNudge: (trigger: NudgeTrigger, ruleId: NudgeRuleId) => Promise<boolean>;
}

const Ctx = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChat 必须在 ChatProvider 内使用");
  return ctx;
}

function toChatMessage(m: MessageSummary): ChatMessage {
  return {
    id: m.id,
    requestId: m.id,
    stage: m.stage,
    question: m.question,
    reply: m.reply,
    proposalId: m.proposal_id,
    proposalStatus: m.proposal ? (m.proposal.status as ProposalStatus) : "none",
    proposal: m.proposal,
    pieceId: m.piece_id,
    createdAt: m.created_at,
  };
}

function isProposalStale(detail: unknown): boolean {
  return (
    typeof detail === "object" &&
    detail !== null &&
    (detail as { reason?: string }).reason === "proposal_stale"
  );
}

export function ChatProvider({
  workspaceId,
  stage,
  children,
}: {
  workspaceId: string;
  stage: Stage;
  children: ReactNode;
}) {
  const { revision, applyServerSnapshot } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 900);

  const revisionRef = useRef(revision);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  // 切换工作区时重置并加载历史。
  useEffect(() => {
    setMessages([]);
    setDraft("");
    setSelectedPieceId(null);
    setError("");
    let cancelled = false;
    api
      .listMessages(workspaceId)
      .then((page) => {
        if (cancelled) return;
        setMessages(page.messages.map(toChatMessage));
      })
      .catch(() => {
        if (!cancelled) setError("历史加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const send = useCallback(
    async (question?: string) => {
      const text = (question ?? draft).trim();
      if (!text || sending) return;
      const requestId = crypto.randomUUID();
      const pieceId = selectedPieceId;
      const stg = stage;
      const rev = revisionRef.current;

      const temp: ChatMessage = {
        id: requestId,
        requestId,
        stage: stg,
        question: text,
        reply: null,
        proposalId: null,
        proposalStatus: "none",
        proposal: null,
        pieceId,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, temp]);
      setDraft("");
      setSelectedPieceId(null);
      setSending(true);
      setError("");
      try {
        const res = await api.sendMessage(
          workspaceId,
          requestId,
          stg,
          text,
          rev,
          pieceId ?? undefined,
        );
        setMessages((m) =>
          m.map((x) =>
            x.id === requestId
              ? {
                  ...x,
                  reply: res.reply,
                  proposalId: res.proposal_id,
                  proposalStatus: res.proposal
                    ? (res.proposal.status as ProposalStatus)
                    : "none",
                  proposal: res.proposal ?? null,
                  error: undefined,
                }
              : x,
          ),
        );
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "调用失败，请重试";
        setMessages((m) =>
          m.map((x) => (x.id === requestId ? { ...x, error: msg } : x)),
        );
      } finally {
        setSending(false);
      }
    },
    [draft, sending, selectedPieceId, stage, workspaceId],
  );

  const retry = useCallback(
    async (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg || sending) return;
      const requestId = msg.requestId;
      const rev = revisionRef.current;
      setSending(true);
      setError("");
      try {
        const res = await api.sendMessage(
          workspaceId,
          requestId,
          msg.stage,
          msg.question,
          rev,
          msg.pieceId ?? undefined,
        );
        setMessages((m) =>
          m.map((x) =>
            x.id === messageId
              ? {
                  ...x,
                  reply: res.reply,
                  proposalId: res.proposal_id,
                  proposalStatus: res.proposal
                    ? (res.proposal.status as ProposalStatus)
                    : "none",
                  proposal: res.proposal ?? null,
                  error: undefined,
                }
              : x,
          ),
        );
      } catch (e) {
        const msgText = e instanceof ApiError ? e.message : "重试失败";
        setMessages((m) =>
          m.map((x) => (x.id === messageId ? { ...x, error: msgText } : x)),
        );
      } finally {
        setSending(false);
      }
    },
    [messages, sending, workspaceId],
  );

  const resolve = useCallback(
    async (proposalId: string, action: "accept" | "ignore") => {
      const requestId = crypto.randomUUID();
      const rev = revisionRef.current;
      setError("");
      try {
        const res = await api.resolveProposal(
          workspaceId,
          proposalId,
          requestId,
          rev,
          action,
        );
        applyServerSnapshot(res.revision, res.snapshot);
        if (action === "accept") pushRecentAction("采纳了提案");
        setMessages((m) =>
          m.map((x) =>
            x.proposalId === proposalId
              ? { ...x, proposalStatus: res.status as ProposalStatus }
              : x,
          ),
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && isProposalStale(e.detail)) {
          setMessages((m) =>
            m.map((x) =>
              x.proposalId === proposalId ? { ...x, proposalStatus: "stale" } : x,
            ),
          );
          setError("该提案基于旧内容，请基于最新内容重新生成");
        } else {
          setError(e instanceof ApiError ? e.message : "处理失败，请重试");
        }
      }
    },
    [workspaceId, applyServerSnapshot],
  );

  const regenerate = useCallback(
    async (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg || sending) return;
      const requestId = crypto.randomUUID();
      const rev = revisionRef.current;
      setSending(true);
      setError("");
      try {
        const res = await api.sendMessage(
          workspaceId,
          requestId,
          msg.stage,
          msg.question,
          rev,
          msg.pieceId ?? undefined,
        );
        setMessages((m) =>
          m.map((x) =>
            x.id === messageId
              ? {
                  ...x,
                  requestId,
                  reply: res.reply,
                  proposalId: res.proposal_id,
                  proposalStatus: res.proposal
                    ? (res.proposal.status as ProposalStatus)
                    : "none",
                  proposal: res.proposal ?? null,
                  error: undefined,
                }
              : x,
          ),
        );
      } catch (e) {
        const msgText = e instanceof ApiError ? e.message : "重新生成失败";
        setMessages((m) =>
          m.map((x) => (x.id === messageId ? { ...x, error: msgText } : x)),
        );
      } finally {
        setSending(false);
      }
    },
    [messages, sending, workspaceId],
  );

  const sendNudge = useCallback(
    async (_trigger: NudgeTrigger, _ruleId: NudgeRuleId) => false,
    [],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      messages,
      sending,
      draft,
      setDraft,
      error,
      selectedPieceId,
      setSelectedPieceId,
      panelOpen,
      setPanelOpen,
      send,
      retry,
      resolve,
      regenerate,
      sendNudge,
    }),
    [
      messages,
      sending,
      draft,
      error,
      selectedPieceId,
      panelOpen,
      send,
      retry,
      resolve,
      regenerate,
      sendNudge,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
