import { useEffect, useRef, useState, type ReactNode } from "react";

import "./trial-access-gate.css";

const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const NETWORK_TIMEOUT_MS = 10_000;
const trialMode = import.meta.env.VITE_TRIAL_MODE === "1";

interface TurnstileApi {
  remove(widgetId: string): void;
  render(
    container: HTMLElement,
    options: {
      action: string;
      appearance: "always";
      callback(token: string): void;
      "error-callback"(): void;
      "expired-callback"(): void;
      sitekey: string;
      size: "compact" | "flexible";
      theme: "auto";
    },
  ): string;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoad: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoad) return turnstileLoad;
  turnstileLoad = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-narrative-turnstile]",
    );
    const script = existing ?? document.createElement("script");
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      callback();
    };
    const loaded = () =>
      finish(() =>
        window.turnstile
          ? resolve(window.turnstile)
          : reject(new Error("Turnstile API missing after script load")),
      );
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error("Turnstile script load timed out"))),
      NETWORK_TIMEOUT_MS,
    );
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener(
      "error",
      () =>
        finish(() => reject(new Error("Turnstile script failed to load"))),
      { once: true },
    );
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      script.dataset.narrativeTurnstile = "true";
      document.head.append(script);
    }
  }).catch((error) => {
    turnstileLoad = null;
    throw error;
  });
  return turnstileLoad;
}

function sessionUrl(): string | null {
  const relayUrl = import.meta.env.VITE_DEMO_RELAY_URL as string | undefined;
  if (!relayUrl) return null;
  return new URL("/session", relayUrl).toString();
}

export function TrialAccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "challenge" | "ready">(
    trialMode ? "checking" : "ready",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const endpoint = sessionUrl();
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    if (!trialMode || !endpoint) return;
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      NETWORK_TIMEOUT_MS,
    );
    void fetch(endpoint, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => {
        if (!disposed) setState(response.ok ? "ready" : "challenge");
      })
      .catch(() => {
        if (disposed) return;
        setMessage("验证服务连接超时，请重新加载验证");
        setState("challenge");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [endpoint]);

  useEffect(() => {
    if (state !== "challenge" || !endpoint || !sitekey || !container.current)
      return;
    let disposed = false;
    let api: TurnstileApi | null = null;
    let widgetId: string | null = null;
    void loadTurnstile()
      .then((turnstile) => {
        if (disposed || !container.current) return;
        api = turnstile;
        widgetId = turnstile.render(container.current, {
          sitekey,
          action: "trial-session",
          appearance: "always",
          size:
            container.current.clientWidth < 300 ? "compact" : "flexible",
          theme: "auto",
          callback: (token) => {
            setMessage(null);
            const controller = new AbortController();
            const timeout = window.setTimeout(
              () => controller.abort(),
              NETWORK_TIMEOUT_MS,
            );
            void fetch(endpoint, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ token }),
              signal: controller.signal,
            })
              .then((response) => {
                if (!response.ok) throw new Error("验证未通过，请重试");
                setState("ready");
              })
              .catch((error: unknown) => {
                setMessage(
                  error instanceof Error ? error.message : "验证未通过，请重试",
                );
                if (api && widgetId) api.reset(widgetId);
              })
              .finally(() => window.clearTimeout(timeout));
          },
          "error-callback": () =>
            setMessage("验证组件暂时不可用，请重新加载验证"),
          "expired-callback": () => {
            if (api && widgetId) api.reset(widgetId);
          },
        });
      })
      .catch(() => {
        document
          .querySelector<HTMLScriptElement>("script[data-narrative-turnstile]")
          ?.remove();
        setMessage("验证组件加载失败，请检查网络或内容拦截设置后重试");
      });
    return () => {
      disposed = true;
      if (api && widgetId) api.remove(widgetId);
    };
  }, [challengeAttempt, endpoint, sitekey, state]);

  if (state === "ready") return children;

  const configurationMissing = !endpoint || !sitekey;
  return (
    <main className="trial-access" aria-busy={state === "checking"}>
      <section className="trial-access__card" aria-live="polite">
        <p className="trial-access__eyebrow mono">NarraLume</p>
        <h1>进入在线体验</h1>
        <p>
          {configurationMissing
            ? "体验站尚未完成验证配置。"
            : state === "checking"
              ? "正在确认访问会话…"
              : "请完成人机验证。"}
        </p>
        {!configurationMissing && state === "challenge" ? (
          <div className="trial-access__widget" ref={container} />
        ) : null}
        {message ? <p className="trial-access__error">{message}</p> : null}
        {message && !configurationMissing ? (
          <button
            type="button"
            className="trial-access__retry btn"
            onClick={() => {
              setMessage(null);
              setChallengeAttempt((attempt) => attempt + 1);
            }}
          >
            重新加载验证
          </button>
        ) : null}
      </section>
    </main>
  );
}
