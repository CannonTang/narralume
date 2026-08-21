import { NodeNarrativeDatabase } from "@narralume/persistence/node";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const resources: {
  app: Awaited<ReturnType<typeof buildApp>>;
  database: NodeNarrativeDatabase;
}[] = [];

afterEach(async () => {
  while (resources.length) {
    const resource = resources.pop();
    await resource?.app.close();
    resource?.database.close();
  }
});

describe("long novel intelligence API", () => {
  it("keeps future branches isolated and exposes reproducible dry-runs", async () => {
    const database = new NodeNarrativeDatabase();
    const app = await buildApp({
      database,
      environment: {},
      logger: false,
      config: {
        dataDirectory: ".",
        databasePath: ":memory:",
        host: "127.0.0.1",
        port: 4317,
        environment: "test",
      },
    });
    resources.push({ app, database });
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        requestId: globalThis.crypto.randomUUID(),
        title: "远潮",
        premise: "城市每晚遗忘一条街。",
      },
    });
    const projectId = (created.json() as { id: string }).id;

    const generated = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/predictions`,
      payload: { direction: "追查遗忘源头", horizon: 4, count: 3 },
    });
    expect(generated.statusCode, generated.body).toBe(200);
    expect(generated.json()).toHaveLength(3);
    expect(generated.json()[0]).toMatchObject({
      projectId,
      status: "candidate",
      stale: false,
      contextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const initialPrediction = generated.json()[0] as { id: string };
    expect(
      database.raw
        .prepare(
          "SELECT COUNT(*) AS count FROM canon_facts WHERE project_id = ?",
        )
        .get(projectId),
    ).toEqual({ count: 0 });

    database.raw
      .prepare("UPDATE projects SET premise = ? WHERE id = ?")
      .run("城市每晚遗忘一条街，主角也开始遗忘自己的名字。", projectId);
    const staleList = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/predictions`,
    });
    expect(staleList.statusCode, staleList.body).toBe(200);
    expect(
      staleList
        .json()
        .find(
          (prediction: { id: string }) =>
            prediction.id === initialPrediction.id,
        ),
    ).toMatchObject({
      id: initialPrediction.id,
      status: "candidate",
      stale: true,
    });
    const staleAdoption = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/predictions/${initialPrediction.id}`,
      payload: { status: "adopted" },
    });
    expect(staleAdoption.statusCode, staleAdoption.body).toBe(409);
    expect(staleAdoption.json()).toMatchObject({
      error: { code: "prediction.context.stale" },
    });

    const refreshed = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/predictions`,
      payload: { direction: "追查遗忘源头", horizon: 4, count: 3 },
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json()[0]).toMatchObject({ stale: false });
    expect(refreshed.json()[0].id).not.toBe(initialPrediction.id);
    const refreshedAdoption = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/predictions/${refreshed.json()[0].id}`,
      payload: { status: "adopted" },
    });
    expect(refreshedAdoption.statusCode, refreshedAdoption.body).toBe(200);

    const dryRun = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/dry-run`,
      payload: { change: "让主角离开城市" },
    });
    expect(dryRun.statusCode).toBe(200);
    expect(dryRun.json()).toMatchObject({
      safeToProceed: true,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
