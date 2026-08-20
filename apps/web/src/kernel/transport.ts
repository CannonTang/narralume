/**
 * M3 双驱动传输层：api.ts 的三个底层助手（requestJson / requestVoid /
 * 裸 fetch）经此分发——server 模式走相对路径 fetch（现状不变），local
 * 模式走内核 kernelRequest。驱动在首次真正需要分发时探测 /api/health
 * 并缓存，localStorage("narralume:driver") 可显式覆盖。
 *
 * 探测有意懒执行：单元测试（jsdom stub fetch）与首屏渲染都不应被
 * 一次主动探测打扰。
 */

export type DriverMode = "server" | "local" | "pending";

const DRIVER_KEY = "narralume:driver";
const trialMode = import.meta.env.VITE_TRIAL_MODE === "1";

let mode: DriverMode = "pending";
let probe: Promise<DriverMode> | null = null;
const modeListeners = new Set<(mode: DriverMode) => void>();

export function currentDriverMode(): DriverMode {
  return mode;
}

export function onDriverModeChange(
  listener: (mode: DriverMode) => void,
): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

function setMode(next: DriverMode): void {
  if (mode === next) return;
  mode = next;
  for (const listener of modeListeners) listener(mode);
}

/** 探测：显式覆盖优先，否则 fetch /api/health（1.5s 超时）判定。 */
export function resolveDriverMode(): Promise<DriverMode> {
  probe ??= (async () => {
    // Workers Static Assets 的 SPA fallback 会让不存在的 /api/health 也返回
    // index.html 200，不能用它推断存在 Node API。体验构建的架构固定为
    // 浏览器本地内核，因此在任何持久化覆盖与网络探测之前直接选 local。
    if (trialMode) {
      setMode("local");
      return "local";
    }
    const override = readOverride();
    if (override === "local" || override === "server") {
      setMode(override);
      return override;
    }
    if (typeof Worker === "undefined") {
      // 无 Worker 的宿主（旧浏览器 / 测试环境）跑不了本地内核，直接 server。
      setMode("server");
      return "server";
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch("/api/health", {
          signal: controller.signal,
        });
        setMode(response.ok ? "server" : "local");
      } finally {
        clearTimeout(timer);
      }
    } catch {
      setMode("local");
    }
    return mode;
  })();
  return probe;
}

/** 显式切换（设置页入口）；清除则恢复自动探测。 */
export function setDriverOverride(next: "server" | "local" | null): void {
  if (next === null) {
    try {
      localStorage.removeItem(DRIVER_KEY);
    } catch {
      // localStorage 不可用时忽略——下次探测仍会执行。
    }
    return;
  }
  try {
    localStorage.setItem(DRIVER_KEY, next);
  } catch {
    // 同上。
  }
}

export function readDriverOverride(): "server" | "local" | null {
  return readOverride();
}

function readOverride(): "server" | "local" | null {
  try {
    const value = localStorage.getItem(DRIVER_KEY);
    if (value === "server" || value === "local") return value;
  } catch {
    // 隐私模式等场景 localStorage 可能不可用，退回探测。
  }
  return null;
}

/**
 * 分发前必须拿到的确定模式：探测完成后返回缓存值；探测进行中则等待
 * （请求场景天然异步，等待是正确语义）。无浏览器宿主（SSR/测试未触发
 * 过探测）时退回 server——与既有相对路径 fetch 行为一致。
 */
export async function requireResolvedMode(): Promise<"server" | "local"> {
  const resolved = await resolveDriverMode();
  return resolved === "pending" ? "server" : resolved;
}
