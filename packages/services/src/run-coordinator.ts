import { randomUuid } from "@narrative-lantern/domain";

import type { HarnessSupervisor } from "@narrative-lantern/harness";

export class RunCoordinator {
  readonly #workerId = `server:${randomUuid()}`;
  readonly #controller = new AbortController();
  #draining: Promise<void> | null = null;
  #wakeAgain = false;
  #scheduledWake: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly supervisor: HarnessSupervisor,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly nextQueuedAt: () => string | null = () => null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  wake(): void {
    if (this.#controller.signal.aborted) return;
    if (this.#scheduledWake) {
      clearTimeout(this.#scheduledWake);
      this.#scheduledWake = null;
    }
    if (this.#draining) {
      this.#wakeAgain = true;
      return;
    }
    this.#draining = this.drain().finally(() => {
      this.#draining = null;
      if (this.#wakeAgain) {
        this.#wakeAgain = false;
        this.wake();
      } else {
        this.scheduleQueuedWake();
      }
    });
  }

  async advanceOnce(): Promise<boolean> {
    if (this.#controller.signal.aborted) return false;
    return this.supervisor.processNext(this.#workerId, this.#controller.signal);
  }

  async advanceRun(runId: string): Promise<boolean> {
    if (this.#controller.signal.aborted) return false;
    return this.supervisor.processRun(
      runId,
      this.#workerId,
      this.#controller.signal,
    );
  }

  interrupt(runId: string, reason = "cancel_requested"): boolean {
    return this.supervisor.interrupt(runId, reason);
  }

  async stop(): Promise<void> {
    this.#controller.abort("server_stopping");
    if (this.#scheduledWake) {
      clearTimeout(this.#scheduledWake);
      this.#scheduledWake = null;
    }
    await this.#draining;
  }

  private async drain(): Promise<void> {
    try {
      while (!this.#controller.signal.aborted) {
        const processed = await this.advanceOnce();
        if (!processed) return;
      }
    } catch (error) {
      if (!this.#controller.signal.aborted) this.onError(error);
    }
  }

  /**
   * Delayed retry jobs are persisted with a future available_at. Draining can
   * legitimately find no runnable lease before that timestamp, so schedule
   * the next wake instead of waiting for another HTTP request or a restart.
   */
  private scheduleQueuedWake(): void {
    if (this.#controller.signal.aborted || this.#scheduledWake) return;
    const next = this.nextQueuedAt();
    if (!next) return;
    const delayMs = Math.max(0, Date.parse(next) - this.now());
    this.#scheduledWake = setTimeout(() => {
      this.#scheduledWake = null;
      this.wake();
    }, delayMs);
    this.#scheduledWake.unref?.();
  }
}
