import type { NarrativeDatabase } from "./database.js";

export interface ForeignKeyReference {
  table: string;
  column: string;
  count: number;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  to: string | null;
}

/** 查找所有真实外键引用，防止删除资源时意外级联清掉历史。 */
export function listForeignKeyReferences(
  database: NarrativeDatabase,
  targetTable: string,
  targetId: string,
  ignored: ReadonlySet<string> = new Set(),
): ForeignKeyReference[] {
  const tables = database.raw
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as unknown as { name: string }[];
  const references: ForeignKeyReference[] = [];

  for (const { name } of tables) {
    const table = quoteIdentifier(name);
    const foreignKeys = database.raw
      .prepare(`PRAGMA foreign_key_list(${table})`)
      .all() as unknown as ForeignKeyRow[];
    for (const foreignKey of foreignKeys) {
      if (foreignKey.table !== targetTable || (foreignKey.to ?? "id") !== "id")
        continue;
      if (ignored.has(`${name}.${foreignKey.from}`)) continue;
      const row = database.raw
        .prepare(
          `SELECT COUNT(*) AS count FROM ${table} WHERE ${quoteIdentifier(foreignKey.from)} = ?`,
        )
        .get(targetId) as { count: number };
      if (row.count > 0)
        references.push({
          table: name,
          column: foreignKey.from,
          count: row.count,
        });
    }
  }

  return references;
}

export function totalReferenceCount(
  database: NarrativeDatabase,
  targetTable: string,
  targetId: string,
  ignored?: ReadonlySet<string>,
): number {
  return listForeignKeyReferences(
    database,
    targetTable,
    targetId,
    ignored,
  ).reduce((total, reference) => total + reference.count, 0);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
