import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

/* 方形细描边图标按钮：统一 32px 触控面积，hover 浮出发丝线。 */

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
}

export function IconButton({
  icon: Icon,
  label,
  pressed,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      {...rest}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
