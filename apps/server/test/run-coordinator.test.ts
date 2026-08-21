import type { HarnessSupervisor } from "@narralume/harness";
import { describe, expect, it, vi } from "vitest";

import { RunCoordinator } from "@narralume/services";

describe("RunCoordinator", () => {
  it("wakes itself when a persisted delayed retry becomes available", async () => {
    let calls = 0;
    let nextQueuedAt: string | null = null;
    const supervisor = {
      processNext: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          nextQueuedAt = new Date(Date.now() + 25).toISOString();
          return true;
        }
        if (calls === 2) return false;
        if (calls === 3) {
          nextQueuedAt = null;
          return true;
        }
        return false;
      }),
    } as unknown as HarnessSupervisor;
    const coordinator = new RunCoordinator(
      supervisor,
      (error) => {
        throw error;
      },
      () => nextQueuedAt,
    );

    coordinator.wake();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(4), {
      timeout: 1_000,
      interval: 10,
    });

    expect(supervisor.processNext).toHaveBeenCalledTimes(4);
    await coordinator.stop();
  });
});
