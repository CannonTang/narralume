import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeNarrativeDatabase } from "../src/node.js";

import {
  AssignmentPersistenceError,
  ConfigurationVersionConflictError,
  SqliteAssignmentRepository,
  SqliteModelRepository,
  SqliteProviderRepository,
  publicProvider,
  resolveCredential,
} from "../src/index.js";
import type { StoredModel, StoredProvider } from "../src/index.js";

const now = "2026-08-10T00:00:00.000Z";
const later = "2026-08-10T01:02:03.000Z";
const latest = "2026-08-10T02:03:04.000Z";

let database: NodeNarrativeDatabase;
let providers: SqliteProviderRepository;
let models: SqliteModelRepository;
let assignments: SqliteAssignmentRepository;

function makeProvider(overrides: Partial<StoredProvider> = {}): StoredProvider {
  return {
    id: "provider-1",
    name: "Provider One",
    wireApi: "openai-chat",
    baseUrl: "https://api.example.com/v1",
    endpoint: null,
    credentialRef: "env:PROVIDER_ONE_KEY",
    anthropicVersion: null,
    headers: {},
    queryParams: {},
    requestStartTimeoutMs: null,
    streamIdleTimeoutMs: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeModel(overrides: Partial<StoredModel> = {}): StoredModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    modelId: "gpt-4o",
    taskType: "writing",
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    sampling: { temperature: 0.7 },
    capabilities: { streaming: true },
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  database = new NodeNarrativeDatabase();
  database.migrate();
  providers = new SqliteProviderRepository(database);
  models = new SqliteModelRepository(database);
  assignments = new SqliteAssignmentRepository(database);
});

afterEach(() => {
  delete process.env["PROVIDER_ONE_KEY"];
  delete process.env["EMPTY_KEY"];
  database.close();
});

describe("SqliteProviderRepository", () => {
  it("upserts, gets, lists and deletes providers", () => {
    providers.upsert(makeProvider());
    providers.upsert(
      makeProvider({
        id: "provider-2",
        name: "Provider Two",
        wireApi: "anthropic-messages",
        anthropicVersion: "2023-06-01",
        headers: { "x-tenant": "novel" },
        queryParams: { region: "cn" },
        requestStartTimeoutMs: 30_000,
        streamIdleTimeoutMs: 90_000,
        enabled: false,
      }),
    );

    const stored = providers.get("provider-2");
    expect(stored).toMatchObject({
      id: "provider-2",
      wireApi: "anthropic-messages",
      anthropicVersion: "2023-06-01",
      headers: { "x-tenant": "novel" },
      queryParams: { region: "cn" },
      requestStartTimeoutMs: 30_000,
      streamIdleTimeoutMs: 90_000,
      enabled: false,
    });

    expect(providers.list().map((row) => row.id)).toEqual([
      "provider-1",
      "provider-2",
    ]);
    expect(providers.list(true).map((row) => row.id)).toEqual(["provider-1"]);

    providers.upsert(
      makeProvider({ id: "provider-2", name: "Renamed", updatedAt: later }),
    );
    expect(providers.get("provider-2")).toMatchObject({
      name: "Renamed",
      enabled: true,
      updatedAt: later,
    });

    expect(providers.delete("provider-2")).toBe(true);
    expect(providers.delete("provider-2")).toBe(false);
    expect(providers.get("provider-2")).toBeNull();
  });

  it("rejects stale provider updates", () => {
    const initial = providers.upsert(makeProvider());
    const updated = providers.update(
      { ...initial, name: "First Writer", updatedAt: later },
      initial.updatedAt,
    );
    expect(updated).toMatchObject({ name: "First Writer", updatedAt: later });
    expect(() =>
      providers.update(
        { ...initial, name: "Stale Writer", updatedAt: latest },
        initial.updatedAt,
      ),
    ).toThrow(ConfigurationVersionConflictError);
    expect(providers.get(initial.id)).toMatchObject({ name: "First Writer" });
  });
});

describe("resolveCredential", () => {
  it("reads env refs from the injected environment", () => {
    expect(
      resolveCredential(makeProvider(), { PROVIDER_ONE_KEY: "sk-live-key" }),
    ).toEqual({
      ok: true,
      apiKey: "sk-live-key",
    });
  });

  it("reports missing env vars without throwing", () => {
    expect(resolveCredential(makeProvider(), {})).toEqual({
      ok: false,
      reason: "missing_env",
      name: "PROVIDER_ONE_KEY",
    });
  });

  it("reports empty env vars and empty raw keys", () => {
    expect(
      resolveCredential(makeProvider({ credentialRef: "env:EMPTY_KEY" }), {
        EMPTY_KEY: "",
      }),
    ).toEqual({ ok: false, reason: "empty" });
    expect(resolveCredential(makeProvider({ credentialRef: "" }), {})).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("returns raw keys directly", () => {
    expect(
      resolveCredential(makeProvider({ credentialRef: "sk-raw-key-1234" }), {}),
    ).toEqual({ ok: true, apiKey: "sk-raw-key-1234" });
  });
});

describe("publicProvider", () => {
  it("returns env refs as-is", () => {
    const view = publicProvider(makeProvider());
    expect(view.credentialRef).toBe("env:PROVIDER_ONE_KEY");
  });

  it("masks raw keys with the last 4 chars only", () => {
    const view = publicProvider(
      makeProvider({ credentialRef: "sk-abcdef1234567890" }),
    );
    expect(view.credentialRef).toBe("••••7890");
    expect(JSON.stringify(view)).not.toContain("sk-abcdef1234567890");
  });

  it("fully masks short raw keys", () => {
    const view = publicProvider(makeProvider({ credentialRef: "short" }));
    expect(view.credentialRef).toBe("••••••••");
    expect(JSON.stringify(view)).not.toContain("short");
  });

  it("masks custom header and query parameter values", () => {
    const view = publicProvider(
      makeProvider({
        headers: { Authorization: "Bearer header-secret" },
        queryParams: { api_key: "query-secret" },
      }),
    );
    expect(view.headers.Authorization).toBe("••••cret");
    expect(view.queryParams.api_key).toBe("••••cret");
    expect(JSON.stringify(view)).not.toContain("header-secret");
    expect(JSON.stringify(view)).not.toContain("query-secret");
  });
});

describe("SqliteModelRepository", () => {
  beforeEach(() => {
    providers.upsert(makeProvider());
    providers.upsert(makeProvider({ id: "provider-2", name: "Two" }));
  });

  it("supports CRUD, listByProvider and listByTaskType", () => {
    models.upsert(makeModel());
    models.upsert(
      makeModel({
        id: "model-2",
        modelId: "gpt-4o-mini",
        taskType: "review",
        enabled: false,
      }),
    );
    models.upsert(
      makeModel({
        id: "model-3",
        providerId: "provider-2",
        modelId: "text-embedding-3",
        taskType: "embedding",
        contextWindow: null,
        maxOutputTokens: null,
        sampling: {},
        capabilities: {},
      }),
    );

    expect(models.get("model-1")).toMatchObject({
      providerId: "provider-1",
      modelId: "gpt-4o",
      taskType: "writing",
      contextWindow: 128_000,
      sampling: { temperature: 0.7 },
      capabilities: { streaming: true },
    });
    expect(models.list().map((row) => row.id)).toEqual([
      "model-1",
      "model-2",
      "model-3",
    ]);
    expect(models.list(true).map((row) => row.id)).toEqual([
      "model-1",
      "model-3",
    ]);
    expect(models.listByProvider("provider-1").map((row) => row.id)).toEqual([
      "model-1",
      "model-2",
    ]);
    expect(models.listByTaskType("embedding").map((row) => row.id)).toEqual([
      "model-3",
    ]);
    expect(models.listByTaskType("review", true)).toEqual([]);

    models.upsert(
      makeModel({
        id: "model-2",
        modelId: "gpt-4o-mini",
        taskType: "review",
        enabled: true,
        updatedAt: later,
      }),
    );
    expect(models.get("model-2")).toMatchObject({
      enabled: true,
      updatedAt: later,
    });

    expect(models.delete("model-2")).toBe(true);
    expect(models.get("model-2")).toBeNull();
  });

  it("cascades provider deletion to models", () => {
    models.upsert(makeModel());
    providers.delete("provider-1");
    expect(models.get("model-1")).toBeNull();
  });

  it("rejects stale model updates", () => {
    const initial = models.upsert(makeModel());
    const updated = models.update(
      { ...initial, contextWindow: 256_000, updatedAt: later },
      initial.updatedAt,
    );
    expect(updated).toMatchObject({ contextWindow: 256_000, updatedAt: later });
    expect(() =>
      models.update(
        { ...initial, contextWindow: 1_000, updatedAt: latest },
        initial.updatedAt,
      ),
    ).toThrow(ConfigurationVersionConflictError);
    expect(models.get(initial.id)).toMatchObject({ contextWindow: 256_000 });
  });
});

describe("SqliteAssignmentRepository", () => {
  beforeEach(() => {
    providers.upsert(makeProvider());
    models.upsert(makeModel());
    models.upsert(
      makeModel({ id: "model-2", modelId: "review-model", taskType: "review" }),
    );
    models.upsert(
      makeModel({
        id: "model-3",
        modelId: "planning-model",
        taskType: "planning",
      }),
    );
    models.upsert(makeModel({ id: "model-4", modelId: "writing-model-2" }));
  });

  it("sets, gets, lists and removes assignments", () => {
    assignments.set("writing", "model-1", now);
    assignments.set("review", "model-2", later);

    expect(assignments.get("writing")).toEqual({
      role: "writing",
      modelId: "model-1",
      updatedAt: now,
    });
    expect(assignments.list().map((row) => row.role)).toEqual([
      "review",
      "writing",
    ]);

    assignments.set("writing", "model-4", later);
    expect(assignments.get("writing")?.modelId).toBe("model-4");

    expect(assignments.remove("writing")).toBe(true);
    expect(assignments.remove("writing")).toBe(false);
    expect(assignments.get("writing")).toBeNull();
  });

  it("rejects assignments to unknown models", () => {
    expect(() => assignments.set("writing", "missing", now)).toThrow(
      AssignmentPersistenceError,
    );
  });

  it("resolves assignments to model and provider", () => {
    assignments.set("writing", "model-1", now);
    const resolved = assignments.resolve("writing");
    expect(resolved).toMatchObject({
      requestedRole: "writing",
      role: "writing",
      model: { id: "model-1", modelId: "gpt-4o" },
      provider: { id: "provider-1", wireApi: "openai-chat" },
    });
  });

  it("falls back to the writing assignment for planning and review", () => {
    assignments.set("writing", "model-1", now);
    for (const role of ["planning", "review"] as const) {
      expect(assignments.resolve(role)).toMatchObject({
        requestedRole: role,
        role: "writing",
        model: { id: "model-1" },
      });
    }

    assignments.set("planning", "model-3", now);
    expect(assignments.resolve("planning")).toMatchObject({
      requestedRole: "planning",
      role: "planning",
      model: { id: "model-3" },
    });

    assignments.set("planning", "model-1", later);
    assignments.set("review", "model-1", later);
    expect(assignments.resolve("planning")?.model.id).toBe("model-1");
    expect(assignments.resolve("review")?.model.id).toBe("model-1");
  });

  it("returns null for unset embedding/rerank and missing writing", () => {
    assignments.set("writing", "model-1", now);
    expect(assignments.resolve("embedding")).toBeNull();
    expect(assignments.resolve("rerank")).toBeNull();

    assignments.remove("writing");
    expect(assignments.resolve("writing")).toBeNull();
    expect(assignments.resolve("planning")).toBeNull();
  });
});
