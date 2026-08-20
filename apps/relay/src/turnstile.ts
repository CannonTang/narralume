const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  action?: string;
  hostname?: string;
  success?: boolean;
}

export async function validateTurnstile(input: {
  expectedAction: string;
  expectedHostname: string;
  fetcher?: typeof fetch;
  remoteIp: string | null;
  secret: string;
  token: string;
}): Promise<"valid" | "invalid" | "unavailable"> {
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: input.secret,
        response: input.token,
        ...(input.remoteIp ? { remoteip: input.remoteIp } : {}),
        idempotency_key: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return "unavailable";
  }
  if (!response.ok) return "unavailable";
  let result: SiteverifyResponse;
  try {
    result = (await response.json()) as SiteverifyResponse;
  } catch {
    return "unavailable";
  }
  return result.success === true &&
    result.hostname === input.expectedHostname &&
    result.action === input.expectedAction
    ? "valid"
    : "invalid";
}
