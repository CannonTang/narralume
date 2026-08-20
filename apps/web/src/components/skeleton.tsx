/* 骨架行：纸面呼吸块。lines 为行数。 */

interface SkeletonProps {
  lines?: number;
}

export function Skeleton({ lines = 4 }: SkeletonProps) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="skeleton__line"
          style={{ width: `${92 - ((index * 17) % 40)}%` }}
        />
      ))}
    </div>
  );
}
