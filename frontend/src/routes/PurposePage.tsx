import { useEffect, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { StageAssistant } from "../components/StageAssistant";

export default function PurposePage() {
  const { snapshot, mutate } = useWorkspace();
  const [text, setText] = useState(snapshot?.purpose ?? "");

  // 提交成功（snapshot.purpose 变化）后同步；值相等时无重绘副作用。
  useEffect(() => {
    setText(snapshot?.purpose ?? "");
  }, [snapshot?.purpose]);

  function commit() {
    if (text !== snapshot?.purpose) {
      void mutate([{ type: "set_purpose", text }]);
    }
  }

  return (
    <>
      <textarea
        aria-label="本次目的"
        value={text}
        placeholder="例如：怎样判断读者是否实际使用过教程？"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
      />
      <StageAssistant stage="purpose" />
    </>
  );
}
