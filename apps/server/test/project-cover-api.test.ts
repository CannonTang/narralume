import { NodeNarrativeDatabase } from "@narrative-lantern/persistence/node";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const config: ServerConfig = {
  dataDirectory: ".",
  databasePath: ":memory:",
  host: "127.0.0.1",
  port: 4317,
  environment: "test",
};

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

interface TestProject {
  id: string;
  title: string;
  updatedAt: string;
}

async function setup() {
  const database = new NodeNarrativeDatabase();
  const app = await buildApp({
    config,
    database,
    environment: {},
    logger: false,
    enableRunWorker: false,
  });
  resources.push({ app, database });
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      requestId: globalThis.crypto.randomUUID(),
      title: "潮汐灯塔",
      premise: "守灯人的女儿发现港口正在遗忘来信的人。",
    },
  });
  expect(projectResponse.statusCode, projectResponse.body).toBe(201);
  return {
    app,
    project: projectResponse.json() as TestProject,
  };
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** 资料与封面通过同一个 PUT /api/projects/:projectId 原子提交。 */
function saveProject(
  app: Awaited<ReturnType<typeof buildApp>>,
  project: TestProject,
  cover?: Record<string, unknown>,
  expectedUpdatedAt = project.updatedAt,
) {
  return app.inject({
    method: "PUT",
    url: `/api/projects/${project.id}`,
    payload: {
      title: project.title,
      subtitle: null,
      premise: null,
      archived: false,
      expectedUpdatedAt,
      ...(cover ? { cover } : {}),
    },
  });
}

function putCover(crop = { x: 0.4, y: 0.55, zoom: 1.2 }) {
  return {
    action: "put",
    mediaType: "image/png",
    imageBase64: PNG_SIGNATURE.toString("base64"),
    width: 1200,
    height: 1800,
    crop,
  };
}

describe("project cover API", () => {
  it("uploads, serves, crops, lists and removes one cover", async () => {
    const { app, project } = await setup();
    const upload = await saveProject(app, project, putCover());
    expect(upload.statusCode, upload.body).toBe(200);

    const shelf = await app.inject({ method: "GET", url: "/api/projects" });
    expect(shelf.statusCode, shelf.body).toBe(200);
    expect(shelf.json()).toEqual([
      expect.objectContaining({
        id: project.id,
        cover: expect.objectContaining({
          mediaType: "image/png",
          byteSize: PNG_SIGNATURE.byteLength,
        }),
      }),
    ]);
    expect(JSON.stringify(shelf.json())).not.toContain("imageBase64");

    const image = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/cover`,
    });
    expect(image.statusCode, image.body).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(image.rawPayload).toEqual(PNG_SIGNATURE);
    expect(image.headers.etag).toEqual(expect.any(String));

    const cached = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/cover`,
      headers: { "if-none-match": image.headers.etag! },
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.rawPayload.byteLength).toBe(0);

    let current = upload.json() as TestProject;
    const crop = await saveProject(
      app,
      project,
      {
        action: "crop",
        crop: { x: 0.25, y: 0.7, zoom: 1.8 },
      },
      current.updatedAt,
    );
    expect(crop.statusCode, crop.body).toBe(200);

    const afterCrop = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/cover`,
    });
    expect(afterCrop.headers.etag).not.toBe(image.headers.etag);

    current = crop.json() as TestProject;
    const removed = await saveProject(
      app,
      project,
      { action: "remove" },
      current.updatedAt,
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${project.id}/cover`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/api/projects" })).json(),
    ).toEqual([expect.objectContaining({ id: project.id, cover: null })]);
  });

  it("rejects image bytes that do not match the declared media type", async () => {
    const { app, project } = await setup();
    const response = await saveProject(app, project, {
      ...putCover(),
      mediaType: "image/jpeg",
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "project.cover.media_mismatch" },
    });
  });

  it("rolls back the cover change when the profile version precondition fails", async () => {
    // CR-83：封面与资料必须原子提交。过期 updatedAt 的保存整体 409，
    // 封面不得被改动（回归前封面会先写入，资料再 409，形成半提交）。
    const { app, project } = await setup();
    const upload = await saveProject(app, project, putCover());
    expect(upload.statusCode, upload.body).toBe(200);

    const stale = await saveProject(
      app,
      project,
      { action: "remove" },
      project.updatedAt, // 过期：上传封面已经推进了 updatedAt
    );
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: "project.version.conflict" },
    });

    const image = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/cover`,
    });
    expect(image.statusCode).toBe(200);
    expect(image.rawPayload).toEqual(PNG_SIGNATURE);
  });

  it("keeps the custom cover when duplicating a project", async () => {
    const { app, project } = await setup();
    const upload = await saveProject(app, project, putCover());
    expect(upload.statusCode, upload.body).toBe(200);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/duplicate`,
      payload: { title: "潮汐灯塔 · 试写本" },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(201);
    const copied = duplicate.json() as { id: string };
    const shelf = await app.inject({ method: "GET", url: "/api/projects" });
    expect(shelf.json()).toContainEqual(
      expect.objectContaining({
        id: copied.id,
        cover: expect.objectContaining({
          projectId: copied.id,
          mediaType: "image/png",
          crop: { x: 0.4, y: 0.55, zoom: 1.2 },
        }),
      }),
    );
    const image = await app.inject({
      method: "GET",
      url: `/api/projects/${copied.id}/cover`,
    });
    expect(image.rawPayload).toEqual(PNG_SIGNATURE);
  });
});
