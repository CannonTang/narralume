import {
  type NarrativeDatabase,
  SqliteAssignmentRepository,
  SqliteModelRepository,
  SqliteProviderRepository,
} from "@narralume/persistence";

/**
 * M4 demo 中继 provider 预置（D5）：
 * 浏览器内核首次初始化时种子一个指向 CF 中继的 provider——
 * credentialRef 用 `relay:demo` 占位符（内核解析成哑 key，中继剥掉后
 * 注入真实 key），真实 key 绝不进浏览器。环境声明的物理模型上限随部署更新，
 * 用户的启停、采样和其它能力配置保持不变；中继已验证的结构化输出
 * 档位随部署收敛，避免每次任务都先用不支持的 json_schema 试错。
 */

export const DEMO_RELAY_PROVIDER_ID = "relay-demo";
export const DEMO_RELAY_MODEL_ID = "relay-demo";
const DEMO_RELAY_STRUCTURED_CAPABILITIES = {
  structuredOutput: true,
  structuredOutputNative: false,
  structuredOutputJsonMode: true,
} as const;

export interface DemoRelaySeedInput {
  relayBaseUrl: string;
  /** 中继放行的模型名，由部署配置显式提供。 */
  model: string;
  now?: string;
}

export function seedDemoRelayProvider(
  database: NarrativeDatabase,
  input: DemoRelaySeedInput,
): void {
  const providers = new SqliteProviderRepository(database);
  const models = new SqliteModelRepository(database);
  const assignments = new SqliteAssignmentRepository(database);
  const now = input.now ?? new Date().toISOString();
  const model = input.model;

  const existingProvider = providers.get(DEMO_RELAY_PROVIDER_ID);
  providers.upsert({
    id: DEMO_RELAY_PROVIDER_ID,
    name: "在线体验 · 中继",
    wireApi: "openai-chat",
    baseUrl: input.relayBaseUrl,
    endpoint: existingProvider?.endpoint ?? null,
    credentialRef: "relay:demo",
    anthropicVersion: existingProvider?.anthropicVersion ?? null,
    headers: existingProvider?.headers ?? {},
    queryParams: existingProvider?.queryParams ?? {},
    requestStartTimeoutMs: existingProvider?.requestStartTimeoutMs ?? null,
    streamIdleTimeoutMs: existingProvider?.streamIdleTimeoutMs ?? null,
    enabled: existingProvider?.enabled ?? true,
    createdAt: existingProvider?.createdAt ?? now,
    updatedAt: now,
  });

  const existingModel = models.get(DEMO_RELAY_MODEL_ID);
  models.upsert({
    id: DEMO_RELAY_MODEL_ID,
    providerId: DEMO_RELAY_PROVIDER_ID,
    modelId: model,
    taskType: "writing",
    contextWindow: 128_000,
    maxOutputTokens: 32_000,
    sampling: existingModel?.sampling ?? {},
    capabilities: {
      ...existingModel?.capabilities,
      ...DEMO_RELAY_STRUCTURED_CAPABILITIES,
    },
    metadataSource: "environment",
    metadataVerifiedAt: existingModel?.metadataVerifiedAt ?? null,
    enabled: existingModel?.enabled ?? true,
    createdAt: existingModel?.createdAt ?? now,
    updatedAt: now,
  });

  // 未显式派岗时指向 demo 模型，在线体验开箱即用。
  if (!assignments.get("writing")) {
    assignments.set("writing", DEMO_RELAY_MODEL_ID, now);
  }
}
