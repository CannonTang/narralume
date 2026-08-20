/* 移除 Run 级预算门控：用量只作遥测记录，不再有限额或调度前预留。
   保护改由既有的超时/重试/修复次数/上下文安全边距承担。 */
export const migration038 = {
  version: 38,
  name: "drop-run-budget-limits",
  sql: `
    DROP TABLE IF EXISTS physical_call_reservations;
    ALTER TABLE runs DROP COLUMN budget_limit_json;
    ALTER TABLE autopilot_sessions DROP COLUMN child_budget_json;
  `,
} as const;
