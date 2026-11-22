import { useCallback, useEffect, useRef, useState } from "react";

const IDLE_MS = 90_000;
const TICK_MS = 1000;

/**
 * 页面可见且聚焦时累计无活动时间；deps 变化视为活动并清零。
 * 隐藏/失焦时暂停计时（不清零）。达到 90s 后 visible=true，直到 dismiss 或再次活动。
 */
export function useIdleHint(
  activityDeps: readonly unknown[],
  enabled: boolean,
): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false);
  const elapsed = useRef(0);
  const dismissed = useRef(false);

  // 活动：清零并隐藏提示。
  useEffect(() => {
    elapsed.current = 0;
    dismissed.current = false;
    setVisible(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, activityDeps);

  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      if (dismissed.current) return;
      elapsed.current += TICK_MS;
      if (elapsed.current >= IDLE_MS) setVisible(true);
    }, TICK_MS);
    return () => window.clearInterval(t);
  }, [enabled]);

  const dismiss = useCallback(() => {
    dismissed.current = true;
    elapsed.current = 0;
    setVisible(false);
  }, []);

  return { visible, dismiss };
}
