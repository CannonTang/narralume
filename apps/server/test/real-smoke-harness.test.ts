import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeNarrativeDatabase } from "@narralume/persistence/node";
import { describe, expect, it } from "vitest";

import {
  createSmokeWorkspace,
  redact,
  summarizeCallRows,
  writeSmokeSummary,
  type AggregateCallRow,
} from "../../../scripts/real-smoke-harness.js";

describe("real smoke evidence summary", () => {
  it("keeps token metrics while redacting actual credential fields", () => {
    expect(
      redact({
        inputTokens: 120,
        outputTokens: 30,
        cachedInputTokens: 20,
        accessToken: "secret-access-token",
        "ocp-apim-subscription-key": "secret-query-key",
        credentialRef: "raw-key",
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 20,
      accessToken: "[REDACTED]",
      "ocp-apim-subscription-key": "[REDACTED]",
      credentialRef: "[REDACTED]",
    });
  });

  it("sums physical and repair attempts from call receipts", () => {
    const calls: AggregateCallRow[] = [
      callRow({
        id: "call-1",
        usage_json: JSON.stringify({ inputTokens: 10, outputTokens: 4 }),
        details_json: JSON.stringify({
          physicalAttempts: 4,
          repairAttempts: 1,
        }),
      }),
      callRow({
        id: "call-2",
        status: "failed",
        usage_json: JSON.stringify({ inputTokens: 2, outputTokens: 1 }),
        details_json: JSON.stringify({
          physicalAttempts: 1,
          repairAttempts: 0,
        }),
      }),
    ];

    expect(summarizeCallRows(calls, 1, 9)).toMatchObject({
      llmCalls: 2,
      physicalCalls: 5,
      transportRetries: 0,
      inputTokens: 12,
      outputTokens: 5,
      retriedSteps: 1,
      repairCalls: 1,
      partialStreamChars: 9,
    });
  });

  it("writes execution evidence from a migrated database", () => {
    const dir = mkdtempSync(join(tmpdir(), "narrative-smoke-summary-"));
    const database = new NodeNarrativeDatabase();
    database.migrate();
    try {
      const workspace = {
        dir,
        dbPath: join(dir, "smoke.sqlite"),
        jsonlPath: join(dir, "events.jsonl"),
        summaryPath: join(dir, "summary.json"),
      };
      writeSmokeSummary({
        workspace,
        database,
        scenario: "summary-test",
        protocols: ["openai-chat"],
        startedAt: "2026-08-11T00:00:00.000Z",
        success: true,
        checks: [{ name: "test", ok: true }],
      });

      const summary = JSON.parse(readFileSync(workspace.summaryPath, "utf8"));
      expect(summary).toMatchObject({
        scenario: "summary-test",
        aggregates: {
          llmCalls: 0,
          physicalCalls: 0,
          repairCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
        execution: {
          retryOwner: "harness",
          transportMaxRetries: 0,
          runs: [],
        },
      });
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never deletes older immutable smoke workspaces", () => {
    const root = mkdtempSync(join(tmpdir(), "narrative-smoke-retention-"));
    try {
      const first = createSmokeWorkspace("retention", { outputDir: root });
      for (let index = 0; index < 12; index += 1) {
        createSmokeWorkspace("retention", { outputDir: root });
      }
      expect(existsSync(first.dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function callRow(overrides: Partial<AggregateCallRow>): AggregateCallRow {
  return {
    id: "call",
    run_id: "run",
    step_id: "step",
    purpose: "review",
    protocol: "openai-chat",
    model: "model",
    status: "completed",
    started_at: "2026-08-11T00:00:00.000Z",
    finished_at: "2026-08-11T00:00:01.000Z",
    duration_ms: 1_000,
    usage_json: null,
    error_json: null,
    details_json: null,
    ...overrides,
  };
}
