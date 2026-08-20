import { useEffect, useRef, useState } from "react";

import type { ServerEvent } from "@narrative-lantern/contracts";

import { addKernelEventListener } from "../kernel/kernel-client";
import {
  currentDriverMode,
  readDriverOverride,
  requireResolvedMode,
} from "../kernel/transport";

/* ==========================================================================
   /api/events 的 EventSource 封装（从旧 run-center / studio-view 搬入）。
   ========================================================================== */

export function parseServerEvent(text: string): ServerEvent | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || !("type" in value)) return null;
    return value as ServerEvent;
  } catch {
    return null;
  }
}

/** model.event 载荷中最常用的 text.delta 形状。 */
export interface TextDeltaPayload {
  type: string;
  text?: string;
}

export function isTextDelta(event: unknown): event is {
  type: "text.delta";
  text: string;
} {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as TextDeltaPayload).type === "text.delta" &&
    typeof (event as TextDeltaPayload).text === "string"
  );
}

export interface ServerEventHandlers {
  onModelEvent?: (runId: string, event: unknown) => void;
  onRunStatus?: (runId: string, status: string) => void;
  onRunEvent?: (
    runId: string,
    stepId: string | null,
    sequence: number,
    eventType: string,
    payload: Record<string, unknown>,
  ) => void;
}

/**
 * 订阅服务端事件流，返回关闭函数。
 * server 驱动走 /api/events 的 EventSource；local 驱动订阅内核事件桥
 * （帧与 SSE data 同构 JSON），接口与重连语义不变。
 * 绑定时同步读已知模式先行绑定（server 缺省），探测若判定 local 再切换，
 * 保证与旧实现一致的同步绑定语义。
 */
export function subscribeServerEvents(handlers: ServerEventHandlers): () => void {
  let closed = false;
  let kernelBound = false;
  let unsubscribeKernel: (() => void) | null = null;
  let source: EventSource | null = null;

  const dispatch = (text: string) => {
    const parsed = parseServerEvent(text);
    if (!parsed) return;
    if (parsed.type === "model.event")
      handlers.onModelEvent?.(parsed.runId, parsed.event);
    if (parsed.type === "run.status")
      handlers.onRunStatus?.(parsed.runId, parsed.status);
    if (parsed.type === "run.event")
      handlers.onRunEvent?.(
        parsed.runId,
        parsed.stepId,
        parsed.sequence,
        parsed.eventType,
        parsed.payload,
      );
  };

  const bindKernel = () => {
    if (kernelBound) return;
    kernelBound = true;
    source?.close();
    source = null;
    // 内核事件桥转发的是完整 SSE 帧（event: …\ndata: …），先剥出 data 行。
    unsubscribeKernel = addKernelEventListener((frame) => {
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (dataLine) dispatch(dataLine.slice("data: ".length));
    });
  };

  const bindServer = () => {
    if (kernelBound || source || typeof EventSource === "undefined") return;
    source = new EventSource("/api/events");
    const forward = (message: MessageEvent<string>) => dispatch(message.data);
    source.addEventListener("model.event", forward as EventListener);
    source.addEventListener("run.status", forward as EventListener);
    source.addEventListener("run.event", forward as EventListener);
  };

  const initial = readDriverOverride() ?? currentDriverMode();
  if (initial === "local") bindKernel();
  else bindServer();

  void requireResolvedMode().then((mode) => {
    if (!closed && mode === "local") bindKernel();
  });

  return () => {
    closed = true;
    unsubscribeKernel?.();
    source?.close();
  };
}

/**
 * React 侧订阅：handlers 只需随引用变化（内部用 ref 稳定），连接只在
 * 挂载时建立一次。
 */
export function useServerEvents(
  handlers: ServerEventHandlers,
  enabled = true,
): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    return subscribeServerEvents({
      onModelEvent: (runId, event) => ref.current.onModelEvent?.(runId, event),
      onRunStatus: (runId, status) =>
        ref.current.onRunStatus?.(runId, status),
      onRunEvent: (runId, stepId, sequence, eventType, payload) =>
        ref.current.onRunEvent?.(runId, stepId, sequence, eventType, payload),
    });
  }, [enabled]);
}

/**
 * 累积指定运行的 text.delta 实时正文（配合运行详情里已持久化的 streams 使用，
 * 持久化正文由调用方自行拼接兜底）。
 */
export function useRunLiveText(
  runId: string | null,
  clearSignal: string | null = null,
): string {
  const [liveByRun, setLiveByRun] = useState<Record<string, string>>({});
  const previousClearSignal = useRef<string | null>(null);
  useEffect(() => {
    if (!runId || !clearSignal || previousClearSignal.current === clearSignal)
      return;
    previousClearSignal.current = clearSignal;
    setLiveByRun((current) => {
      if (!current[runId]) return current;
      const next = { ...current };
      delete next[runId];
      return next;
    });
  }, [clearSignal, runId]);
  useServerEvents({
    onModelEvent: (sourceRunId, event) => {
      if (!runId || sourceRunId !== runId || !isTextDelta(event)) return;
      setLiveByRun((current) => ({
        ...current,
        [sourceRunId]: (current[sourceRunId] ?? "") + event.text,
      }));
    },
  });
  return runId ? (liveByRun[runId] ?? "") : "";
}
