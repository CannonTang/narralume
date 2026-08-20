import type { SystemBackupManifestDto } from "@narrative-lantern/contracts";

export interface ScheduledBackupService {
  create(label: string, now: string): Promise<SystemBackupManifestDto>;
}

export class DatabaseBackupScheduler {
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<boolean> | null = null;

  constructor(
    private readonly service: ScheduledBackupService,
    private readonly intervalMs: number,
    private readonly onCompleted: (
      manifest: SystemBackupManifestDto,
    ) => void | Promise<void> = () => undefined,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(runOnStartup = false): void {
    if (this.#timer || this.intervalMs <= 0) return;
    this.#timer = setInterval(() => void this.runNow(), this.intervalMs);
    this.#timer.unref?.();
    if (runOnStartup) void this.runNow();
  }

  async runNow(): Promise<boolean> {
    if (this.#running) return false;
    const task = (async () => {
      try {
        const manifest = await this.service.create(
          "scheduled",
          this.now().toISOString(),
        );
        await this.onCompleted(manifest);
        return true;
      } catch (error) {
        this.onError(error);
        return false;
      } finally {
        this.#running = null;
      }
    })();
    this.#running = task;
    return task;
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#running;
  }
}
