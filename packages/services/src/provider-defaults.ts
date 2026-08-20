/**
 * 兜底 provider 配置：仅使用通用的 NARRATIVE_LLM_* 环境变量。
 * 浏览器内核注入的 environment 通常为空，走显式 provider 配置。
 */
export function resolveProviderDefaults(
  environment: Readonly<Record<string, string | undefined>>,
): {
  apiKeyEnv: string | null;
  baseUrl: string | null;
  model: string | null;
} {
  const apiKeyEnv = firstDefinedEnvironmentName(environment, [
    "NARRATIVE_LLM_API_KEY",
  ]);
  return {
    apiKeyEnv,
    baseUrl: firstDefinedValue(environment, ["NARRATIVE_LLM_BASE_URL"]),
    model: firstDefinedValue(environment, ["NARRATIVE_LLM_MODEL"]),
  };
}

function firstDefinedEnvironmentName(
  environment: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): string | null {
  return names.find((name) => Boolean(environment[name]?.trim())) ?? null;
}

function firstDefinedValue(
  environment: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return null;
}
