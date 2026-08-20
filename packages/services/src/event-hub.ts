import { randomUuid } from "@narrative-lantern/domain";

/**
 * 事件广播枢纽：订阅者是「写一帧」回调。Fastify 适配器传入
 * ServerResponse.write 绑定；浏览器内核传入 postMessage 桥。
 * 回调抛错视为订阅者已死，自动摘除。
 */
export type EventSink = (frame: string) => void;

interface Client {
  id: string;
  sink: EventSink;
  release: () => void;
}

export class ServerEventHub {
  readonly #clients = new Map<string, Client>();

  add(sink: EventSink, release?: () => void): () => void {
    const client = { id: randomUuid(), sink, release: release ?? (() => {}) };
    this.#clients.set(client.id, client);
    return () => {
      if (!this.#clients.has(client.id)) return;
      this.#clients.delete(client.id);
      client.release();
    };
  }

  broadcast(event: unknown, eventName = "message"): void {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.#clients.values()) {
      try {
        client.sink(payload);
      } catch {
        this.#clients.delete(client.id);
        try {
          client.release();
        } catch {
          // release 自身失败不再传播。
        }
      }
    }
  }

  close(): void {
    for (const client of this.#clients.values()) client.release();
    this.#clients.clear();
  }

  get size(): number {
    return this.#clients.size;
  }
}
