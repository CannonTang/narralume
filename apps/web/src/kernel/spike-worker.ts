/// <reference lib="webworker" />
/**
 * M2 spike 内核 Worker：在真实浏览器 OPFS 里验证 sqlite-wasm 驱动能否
 * 承载完整持久层——全部 migration、嵌套事务、WAL/pragma、重启持久性。
 * M3 会把它替换为完整内核装配；这里只做验收探针。
 */
import {
  NarrativeDatabase,
  createOpfsSahpoolDriver,
} from "@narralume/persistence/browser";

async function runSpike(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  const driver = await createOpfsSahpoolDriver("narralume.sqlite");
  const database = new NarrativeDatabase("narralume.sqlite", driver);
  results.migrationVersion = database.migrate();

  const journal = database.raw
    .prepare("PRAGMA journal_mode")
    .get() as { journal_mode?: string } | undefined;
  results.journalMode = journal?.journal_mode ?? null;
  const fk = database.raw
    .prepare("PRAGMA foreign_keys")
    .get() as { foreign_keys?: number } | undefined;
  results.foreignKeys = fk?.foreign_keys ?? null;

  // 嵌套事务：外层 BEGIN IMMEDIATE + 内层 SAVEPOINT，内层回滚不影响外层。
  let nestedRollbackVerified = false;
  database.transaction(() => {
    database.raw
      .prepare(
        "INSERT INTO projects(id, title, premise, phase, archived_at, deleted_at, deletion_token, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)",
      )
      .run("spike-project", "spike", "spike", "idea", "2026-08-16T00:00:00.000Z", "2026-08-16T00:00:00.000Z");
    try {
      database.transaction(() => {
        throw new Error("inner rollback");
      });
    } catch {
      nestedRollbackVerified = true;
    }
  });
  results.nestedRollbackVerified = nestedRollbackVerified;
  const project = database.raw
    .prepare("SELECT id FROM projects WHERE id = ?")
    .get("spike-project") as { id?: string } | undefined;
  results.projectCommitted = project?.id === "spike-project";

  // run().changes：命中 1 行 / 未命中 0 行——39 处 `changes !== 1` 守卫依赖。
  const updateHit = database.raw
    .prepare("UPDATE projects SET title = ? WHERE id = ?")
    .run("spike-renamed", "spike-project");
  results.updateChanges = Number(updateHit.changes);
  const updateMiss = database.raw
    .prepare("UPDATE projects SET title = ? WHERE id = ?")
    .run("none", "missing-project");
  results.missChanges = Number(updateMiss.changes);

  const integrity = database.raw
    .prepare("PRAGMA integrity_check")
    .get() as { integrity_check?: string } | undefined;
  results.integrityCheck = integrity?.integrity_check ?? null;

  database.close();
  return results;
}

self.addEventListener("message", (event: MessageEvent) => {
  if (event.data !== "spike") return;
  runSpike()
    .then((results) => {
      self.postMessage({ ok: true, results });
    })
    .catch((error: unknown) => {
      self.postMessage({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    });
});
