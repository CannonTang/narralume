/* 数字输入框：内部持有原始字符串，清空时不回落为 0，失焦时才钳位提交。
   解决受控 number input「清空即 0、再输入出现 0N」的占位问题。 */

import { useState } from "react";
import type { InputHTMLAttributes } from "react";

interface NumberFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "onChange" | "min" | "max"
  > {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max?: number;
}

interface NumberDraft {
  /** 输入框里的原始文本，允许为空串。 */
  text: string;
  /** 已提交给父组件的数值；外部 value 与之不同时才重置显示。 */
  committed: number;
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  ...rest
}: NumberFieldProps) {
  const [draft, setDraft] = useState<NumberDraft>(() => ({
    text: String(value),
    committed: value,
  }));
  /* 外部值变化（罗盘载入、会话重置）时同步显示；用户编辑产生的回显
     与 committed 一致，不会被打断。 */
  if (draft.committed !== value) {
    setDraft({ text: String(value), committed: value });
  }
  const clamp = (candidate: number) =>
    Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, candidate));
  return (
    <input
      type="number"
      inputMode="numeric"
      value={draft.text}
      onChange={(event) => {
        const raw = event.target.value;
        const parsed = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(parsed)) {
          const next = clamp(Math.trunc(parsed));
          setDraft({ text: raw, committed: next });
          onChange(next);
        } else {
          setDraft({ text: raw, committed: draft.committed });
        }
      }}
      onBlur={() => {
        const parsed = Number(draft.text);
        const next =
          draft.text.trim() !== "" && Number.isFinite(parsed)
            ? clamp(Math.trunc(parsed))
            : draft.committed;
        if (next !== draft.committed) onChange(next);
        setDraft({ text: String(next), committed: next });
      }}
      min={min}
      {...(max === undefined ? {} : { max })}
      {...rest}
    />
  );
}
