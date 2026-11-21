import { useWorkspace } from "../store/workspace";
import { DraftRemoteBanner, useDraft } from "../lib/useDraft";

export default function PurposePage() {
  const { snapshot, mutate } = useWorkspace();
  const draft = useDraft(snapshot?.purpose ?? "");

  function commit() {
    if (draft.value === snapshot?.purpose) {
      draft.markClean();
      return;
    }
    void mutate([{ type: "set_purpose", text: draft.value }]).then((ok) => {
      if (ok) draft.markClean();
    });
  }

  return (
    <>
      <DraftRemoteBanner
        show={draft.dirty && draft.remoteChanged}
        onAccept={draft.acceptRemote}
      />
      <textarea
        aria-label="本次目的"
        value={draft.value}
        placeholder="例如：怎样判断读者是否实际使用过教程？"
        onChange={(e) => draft.setValue(e.target.value)}
        onBlur={commit}
      />
    </>
  );
}
