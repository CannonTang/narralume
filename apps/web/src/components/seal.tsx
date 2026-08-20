interface SealProps {
  char: string;
  variant: "rail" | "empty" | "hero";
  label?: string;
}

/** 同一枚朱文印用于导航、普通空状态与页面级空状态，仅尺寸不同。 */
export function Seal({ char, variant, label }: SealProps) {
  return (
    <span
      className={`seal seal--${variant}`}
      role="img"
      aria-label={label ?? `朱印「${char}」`}
    >
      <span className="seal__char" aria-hidden="true">
        {char}
      </span>
    </span>
  );
}
