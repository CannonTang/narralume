import type { ReactNode } from "react";

/* 页眉横带：mono 引签居左、宋体题名居中、右侧注记。
   除藏书室（竖排巨题）外，所有工作区页首统一使用本组件，保证对齐。 */

interface PageBandProps {
  /** 引签，如 "VOYAGE · 06" */
  index: string;
  /** 工作区名，如 "自动驾驶" */
  title: string;
  /** 右侧注记区：统计、状态、模式开关等 */
  meta?: ReactNode;
}

export function PageBand({ index, title, meta }: PageBandProps) {
  return (
    <header className="page-band">
      <span className="page-band__index mono" aria-hidden="true">
        {index}
      </span>
      <p className="page-band__title">{title}</p>
      <div className="page-band__meta">{meta}</div>
    </header>
  );
}
