// 远端快照驱动的本地草稿：未脏时静默同步，脏时远端变化只提示 remoteChanged。

import { useCallback, useEffect, useRef, useState } from "react";

export interface DraftState<T> {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  dirty: boolean;
  remoteChanged: boolean;
  acceptRemote: () => void;
  markClean: () => void;
}

export function useDraft<T>(remote: T): DraftState<T> {
  const [value, setValueState] = useState(remote);
  const [dirty, setDirty] = useState(false);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const remoteRef = useRef(remote);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  remoteRef.current = remote;

  // 只在 remote 引用变化时响应；本地变脏本身不触发 remoteChanged。
  useEffect(() => {
    if (dirtyRef.current) {
      setRemoteChanged(true);
    } else {
      setValueState(remote);
      setRemoteChanged(false);
    }
  }, [remote]);

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    setValueState(next);
    setDirty(true);
  }, []);

  const acceptRemote = useCallback(() => {
    setValueState(remoteRef.current);
    setDirty(false);
    setRemoteChanged(false);
  }, []);

  const markClean = useCallback(() => {
    setDirty(false);
    setRemoteChanged(false);
  }, []);

  return { value, setValue, dirty, remoteChanged, acceptRemote, markClean };
}

export function DraftRemoteBanner({
  show,
  onAccept,
}: {
  show: boolean;
  onAccept: () => void;
}) {
  if (!show) return null;
  return (
    <p className="editor-error draft-remote-banner">
      内容已在别处更新{" "}
      <button type="button" onClick={onAccept}>
        载入最新（放弃草稿）
      </button>
    </p>
  );
}
