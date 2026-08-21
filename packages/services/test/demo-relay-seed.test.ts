import { describe, expect, it } from "vitest";

import { NodeNarrativeDatabase } from "@narralume/persistence/node";
import {
  SqliteAssignmentRepository,
  SqliteModelRepository,
  SqliteProviderRepository,
} from "@narralume/persistence";

import { seedDemoRelayProvider } from "../src/demo-relay-seed.js";

/* M4 demo 中继 provider 预置：relay:demo 哑凭证（D5）、幂等、默认派岗。 */

const NOW = "2026-08-16T00:00:00.000Z";

describe("seedDemoRelayProvider", () => {
  it("种子 provider/model/默认写作派岗，credentialRef 是哑占位符", () => {
    const database = new NodeNarrativeDatabase();
    database.migrate();
    seedDemoRelayProvider(database, {
      relayBaseUrl: "https://relay.example/v1",
      model: "example-model",
      now: NOW,
    });
    const provider = new SqliteProviderRepository(database).get("relay-demo");
    expect(provider).toMatchObject({
      baseUrl: "https://relay.example/v1",
      credentialRef: "relay:demo",
      enabled: true,
    });
    const model = new SqliteModelRepository(database).get("relay-demo");
    expect(model).toMatchObject({
      providerId: "relay-demo",
      modelId: "example-model",
      taskType: "writing",
      contextWindow: 128_000,
      maxOutputTokens: 32_000,
      capabilities: {
        structuredOutput: true,
        structuredOutputNative: false,
        structuredOutputJsonMode: true,
      },
      enabled: true,
    });
    const assignment = new SqliteAssignmentRepository(database).get("writing");
    expect(assignment?.modelId).toBe("relay-demo");
    database.close();
  });

  it("重复种子幂等：不重置用户停用状态，不覆盖已有派岗", () => {
    const database = new NodeNarrativeDatabase();
    database.migrate();
    seedDemoRelayProvider(database, {
      relayBaseUrl: "https://relay.example/v1",
      model: "example-model",
      now: NOW,
    });
    const assignments = new SqliteAssignmentRepository(database);
    // 派岗后用户停用 provider/模型——重种子不得复活，也不得清掉派岗。
    const providers = new SqliteProviderRepository(database);
    providers.upsert({
      ...providers.get("relay-demo")!,
      enabled: false,
      updatedAt: NOW,
    });
    const models = new SqliteModelRepository(database);
    models.upsert({
      ...models.get("relay-demo")!,
      enabled: false,
      contextWindow: 64_000,
      maxOutputTokens: 8_192,
      capabilities: {
        streaming: false,
        structuredOutput: true,
        structuredOutputNative: true,
        structuredOutputJsonMode: false,
      },
      updatedAt: NOW,
    });

    seedDemoRelayProvider(database, {
      relayBaseUrl: "https://relay2.example/v1",
      model: "example-model",
      now: NOW,
    });
    // baseUrl 更新（中继迁移地址），停用状态与派岗保留。
    expect(providers.get("relay-demo")).toMatchObject({
      baseUrl: "https://relay2.example/v1",
      enabled: false,
    });
    expect(models.get("relay-demo")).toMatchObject({
      enabled: false,
      contextWindow: 128_000,
      maxOutputTokens: 32_000,
      capabilities: {
        streaming: false,
        structuredOutput: true,
        structuredOutputNative: false,
        structuredOutputJsonMode: true,
      },
    });
    expect(assignments.get("writing")?.modelId).toBe("relay-demo");
    database.close();
  });
});
