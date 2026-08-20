import type { SystemBackupManifestDto } from "@narrative-lantern/contracts";
import { describe, expect, it, vi } from "vitest";

import { DatabaseBackupScheduler } from "../src/database-backup-scheduler.js";

describe("database backup scheduler", () => {
  it("serializes scheduled backups and runs post-backup maintenance", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manifest: SystemBackupManifestDto = {
      id: "backup-1",
      label: "scheduled",
      databaseFile: "backup.sqlite",
      createdAt: "2026-08-10T00:00:00.000Z",
      sizeBytes: 1,
      sha256: "a".repeat(64),
      migration: 14,
      pageCount: 1,
      projectCount: 1,
    };
    const create = vi.fn(async () => {
      await gate;
      return manifest;
    });
    const completed = vi.fn();
    const scheduler = new DatabaseBackupScheduler(
      { create },
      60_000,
      completed,
      () => undefined,
      () => new Date("2026-08-10T00:00:00.000Z"),
    );
    const first = scheduler.runNow();
    await expect(scheduler.runNow()).resolves.toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toBe(true);
    expect(completed).toHaveBeenCalledWith(manifest);
    await scheduler.stop();
  });

  it("contains backup failures without stopping future cycles", async () => {
    const error = new Error("disk unavailable");
    const onError = vi.fn();
    const create = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        id: "backup-2",
        label: "scheduled",
        databaseFile: "backup.sqlite",
        createdAt: "2026-08-10T00:00:00.000Z",
        sizeBytes: 1,
        sha256: "b".repeat(64),
        migration: 14,
        pageCount: 1,
        projectCount: 0,
      });
    const scheduler = new DatabaseBackupScheduler(
      { create },
      60_000,
      () => undefined,
      onError,
    );
    await expect(scheduler.runNow()).resolves.toBe(false);
    await expect(scheduler.runNow()).resolves.toBe(true);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
