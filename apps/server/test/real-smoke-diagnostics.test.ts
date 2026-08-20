import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SqliteLlmCallRepository,
  SqliteRunStreamRepository,
} from "@narrative-lantern/persistence";
import { NodeNarrativeDatabase } from "@narrative-lantern/persistence/node";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const scriptPath = join(repositoryRoot, "scripts", "chapter-real-smoke.ts");
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "awaiting_user",
]);

let server: Server | null = null;
let child: ChildProcess | null = null;
let workRoot: string | null = null;

afterEach(async () => {
  if (child && !child.killed) child.kill("SIGKILL");
  child = null;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (workRoot) {
    rmSync(workRoot, { recursive: true, force: true });
    workRoot = null;
  }
});

describe("real smoke diagnostics", () => {
  it(
    "persists in-flight state across SIGKILL and supports orphan interruption",
    { timeout: 180_000 },
    async () => {
      server = createServer((request, response) => {
        request.resume();
        void response;
      });
      await new Promise<void>((resolve) =>
        server!.listen(0, "127.0.0.1", () => resolve()),
      );
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("hanging server did not bind a port");
      }
      workRoot = mkdtempSync(join(tmpdir(), "real-smoke-diagnostics-"));

      child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          scriptPath,
          "--protocol=openai-chat",
          "--keep-artifacts",
          `--output-dir=${workRoot}`,
        ],
        {
          cwd: repositoryRoot,
          env: {
            ...process.env,
            NARRATIVE_CHAT_API_KEY: "test-key",
            NARRATIVE_CHAT_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            NARRATIVE_CHAT_MODEL: "fake-model",
            NARRATIVE_CHAT_CONTEXT_WINDOW: "128000",
            NARRATIVE_CHAT_MAX_OUTPUT_TOKENS: "32000",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const childLog: string[] = [];
      child.stdout?.on("data", (chunk) => childLog.push(String(chunk)));
      child.stderr?.on("data", (chunk) => childLog.push(String(chunk)));

      const eventsPath = await waitForEvents(childLog);
      const events = readJsonl(eventsPath);
      const types = new Set(events.map((event) => event.type));
      expect(types.has("scenario.start")).toBe(true);
      expect(types.has("run.created")).toBe(true);
      expect(
        events.some(
          (event) => event.type === "run.step" && event.status === "running",
        ),
      ).toBe(true);
      const startedCall = events.find(
        (event) => event.type === "llm.call" && event.status === "started",
      );
      expect(startedCall).toBeDefined();

      child.kill("SIGKILL");
      await new Promise<void>((resolve) => {
        child!.once("exit", () => resolve());
      });
      child = null;

      const workspaceDir = join(eventsPath, "..");
      const database = new NodeNarrativeDatabase(
        join(workspaceDir, "smoke.sqlite"),
      );
      try {
        const run = database.raw.prepare("SELECT status FROM runs").get() as
          { status: string } | undefined;
        expect(run).toBeDefined();
        expect(TERMINAL_RUN_STATUSES.has(run!.status)).toBe(false);

        const runningSteps = database.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM run_steps WHERE status = 'running'",
          )
          .get() as { count: number };
        expect(runningSteps.count).toBeGreaterThan(0);

        const calls = new SqliteLlmCallRepository(database);
        const started = database.raw
          .prepare(
            "SELECT id, started_at, finished_at FROM llm_calls WHERE status = 'started'",
          )
          .all() as unknown as {
          id: string;
          started_at: string;
          finished_at: string | null;
        }[];
        expect(started.length).toBeGreaterThan(0);
        const orphan = started[0]!;
        expect(orphan.started_at).toBeTruthy();
        expect(orphan.finished_at).toBeNull();

        const interrupted = calls.interruptOrphaned("2026-08-10T02:00:00.000Z");
        expect(interrupted).toBeGreaterThan(0);
        new SqliteRunStreamRepository(database).interruptOrphaned(
          "2026-08-10T02:00:00.000Z",
        );
        const after = database.raw
          .prepare(
            "SELECT status, started_at, finished_at FROM llm_calls WHERE id = ?",
          )
          .get(orphan.id) as {
          status: string;
          started_at: string;
          finished_at: string | null;
        };
        expect(after.status).toBe("interrupted");
        expect(after.started_at).toBe(orphan.started_at);
        expect(after.finished_at).toBe("2026-08-10T02:00:00.000Z");
      } finally {
        database.close();
      }
    },
  );
});

async function waitForEvents(childLog: string[]): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(
        `smoke child exited early with ${child.exitCode}\n${childLog.join("")}`,
      );
    }
    const eventsPath = findEventsPath();
    if (eventsPath) {
      const events = readJsonl(eventsPath);
      if (
        events.some(
          (event) => event.type === "llm.call" && event.status === "started",
        )
      ) {
        return eventsPath;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `timed out waiting for llm.call started event\n${childLog.join("")}`,
  );
}

function findEventsPath(): string | null {
  if (!workRoot || !existsSync(workRoot)) return null;
  for (const entry of readdirSync(workRoot)) {
    const candidate = join(workRoot, entry, "events.jsonl");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readJsonl(path: string): Record<string, unknown>[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}
