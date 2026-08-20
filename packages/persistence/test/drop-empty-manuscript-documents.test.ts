import { describe, expect, it } from "vitest";
import { NodeNarrativeDatabase } from "../src/node.js";

import { migration036 } from "../src/migrations/036-drop-empty-manuscript-documents.js";

/* migration 036：清理建书时代自动创建、从未写入版本的空「正文总稿」；
   有版本历史（导入或手动写入过内容）的 manuscript 与其他 kind 不受影响。 */

describe("migration 036 (drop-empty-manuscript-documents)", () => {
  it("deletes version-less manuscript documents and keeps everything else", () => {
    const database = new NodeNarrativeDatabase();
    database.migrate();
    const now = "2026-08-16T00:00:00.000Z";
    const insertProject = database.raw.prepare(
      `INSERT INTO projects(id, title, subtitle, premise, language, phase, archived_at, created_at, updated_at)
       VALUES ('p-1', '样本', NULL, NULL, 'zh-CN', 'idea', NULL, ?, ?)`,
    );
    insertProject.run(now, now);
    const insertDocument = database.raw.prepare(
      `INSERT INTO documents(id, project_id, kind, title, current_version_id, created_at, updated_at)
       VALUES (?, 'p-1', ?, ?, ?, ?, ?)`,
    );
    const insertVersion = database.raw.prepare(
      `INSERT INTO document_versions(id, document_id, parent_version_id, content, content_hash, source, run_id, created_at)
       VALUES (?, ?, NULL, '潮水退去。', 'hash-1', 'manual', NULL, ?)`,
    );
    // 空 manuscript（bootstrap 产物）：应被删除。
    insertDocument.run("doc-empty", "manuscript", "正文总稿", null, now, now);
    // 有版本的 manuscript（导入产物）：应保留。
    insertDocument.run(
      "doc-imported",
      "manuscript",
      "导入正文",
      null,
      now,
      now,
    );
    insertVersion.run("version-1", "doc-imported", now);
    database.raw
      .prepare(
        "UPDATE documents SET current_version_id = 'version-1' WHERE id = 'doc-imported'",
      )
      .run();
    // 无版本的章节稿：kind 不同，应保留。
    insertDocument.run("doc-chapter", "chapter", "第一章", null, now, now);

    database.raw.exec(migration036.sql);

    const remaining = database.raw
      .prepare("SELECT id FROM documents ORDER BY id")
      .all() as { id: string }[];
    expect(remaining.map((row) => row.id)).toEqual([
      "doc-chapter",
      "doc-imported",
    ]);
    expect(database.raw.prepare("PRAGMA foreign_key_check").all()).toHaveLength(
      0,
    );
    // 幂等：重复执行不报错、不误删。
    database.raw.exec(migration036.sql);
    expect(
      (
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM documents")
          .get() as { count: number }
      ).count,
    ).toBe(2);
  });
});
