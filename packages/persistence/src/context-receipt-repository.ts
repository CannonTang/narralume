import type { ContextReceipt } from "@narralume/context";

import type { NarrativeDatabase } from "./database.js";
import { PersistenceNotFoundError } from "./project-repository.js";

export class SqliteContextReceiptRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  insert(
    receipt: ContextReceipt,
    links: { runId?: string | null; stepId?: string | null } = {},
  ): ContextReceipt {
    this.database.raw
      .prepare(
        `INSERT INTO context_receipts(
          id, project_id, run_id, step_id, purpose, budget_json, entries_json,
          compiled_hash, created_at, degradations_json, inventory_digest,
          materialization_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.id,
        receipt.projectId,
        links.runId ?? null,
        links.stepId ?? null,
        receipt.purpose,
        JSON.stringify(receipt.budget),
        JSON.stringify(receipt.entries),
        receipt.compiledHash,
        receipt.createdAt,
        receipt.degradations?.length
          ? JSON.stringify(receipt.degradations)
          : null,
        receipt.inventoryDigest ?? null,
        receipt.materializationDigest ?? null,
      );
    return receipt;
  }

  get(projectId: string, receiptId: string): ContextReceipt | null {
    const row = this.database.raw
      .prepare("SELECT * FROM context_receipts WHERE project_id = ? AND id = ?")
      .get(projectId, receiptId) as ReceiptRow | undefined;
    return row ? mapReceipt(row) : null;
  }

  list(projectId: string, limit = 50): ContextReceipt[] {
    const rows = this.database.raw
      .prepare(
        "SELECT * FROM context_receipts WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(
        projectId,
        Math.max(1, Math.min(limit, 200)),
      ) as unknown as ReceiptRow[];
    return rows.map(mapReceipt);
  }

  listForRun(runId: string): ContextReceipt[] {
    const rows = this.database.raw
      .prepare(
        `SELECT * FROM context_receipts
         WHERE run_id = ? ORDER BY created_at, rowid`,
      )
      .all(runId) as unknown as ReceiptRow[];
    return rows.map(mapReceipt);
  }

  require(projectId: string, receiptId: string): ContextReceipt {
    const receipt = this.get(projectId, receiptId);
    if (!receipt)
      throw new PersistenceNotFoundError("context-receipt", receiptId);
    return receipt;
  }
}

interface ReceiptRow {
  id: string;
  project_id: string;
  purpose: string;
  budget_json: string;
  entries_json: string;
  compiled_hash: string;
  created_at: string;
  degradations_json: string | null;
  inventory_digest: string | null;
  materialization_digest: string | null;
}

function mapReceipt(row: ReceiptRow): ContextReceipt {
  const degradations = row.degradations_json
    ? (JSON.parse(row.degradations_json) as ContextReceipt["degradations"])
    : undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    purpose: row.purpose,
    budget: JSON.parse(row.budget_json) as ContextReceipt["budget"],
    entries: JSON.parse(row.entries_json) as ContextReceipt["entries"],
    ...(degradations?.length ? { degradations } : {}),
    ...(row.inventory_digest ? { inventoryDigest: row.inventory_digest } : {}),
    ...(row.materialization_digest
      ? { materializationDigest: row.materialization_digest }
      : {}),
    compiledHash: row.compiled_hash,
    createdAt: row.created_at,
  };
}
