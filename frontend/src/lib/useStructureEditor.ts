// 结构编辑器共用：远端→草稿、保存中状态、mutate 一条 set_* 操作。

import { useCallback, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useDraft, type DraftState } from "./useDraft";
import type { Operation } from "./types";

export interface StructureEditorControls<T> {
  draft: DraftState<T>;
  saving: boolean;
  error: string;
  setError: (msg: string) => void;
  save: (buildOp: (value: T) => Operation, validate?: (value: T) => string | null) => void;
}

export function useStructureEditor<T>(
  remote: T,
  onSaved: (ok: boolean) => void,
): StructureEditorControls<T> {
  const { mutate } = useWorkspace();
  const draft = useDraft(remote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = useCallback(
    (buildOp: (value: T) => Operation, validate?: (value: T) => string | null) => {
      const msg = validate?.(draft.value) ?? null;
      if (msg) {
        setError(msg);
        return;
      }
      setSaving(true);
      setError("");
      void mutate([buildOp(draft.value)]).then((ok) => {
        setSaving(false);
        if (ok) draft.markClean();
        else setError("保存失败，请检查后重试");
        onSaved(ok);
      });
    },
    [draft, mutate, onSaved],
  );

  return { draft, saving, error, setError, save };
}
