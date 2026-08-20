import { describe, expect, it, vi } from "vitest";

import type { NarrativeDatabase } from "../src/database.js";
import { SqliteProjectCoverRepository } from "../src/project-cover-repository.js";

describe("SqliteProjectCoverRepository", () => {
  it("lists descriptors without loading image data", () => {
    const all = vi.fn(() => [
      {
        project_id: "project-1",
        media_type: "image/webp",
        byte_size: 2048,
        width: 800,
        height: 1200,
        crop_x: 0.5,
        crop_y: 0.4,
        crop_zoom: 1.2,
        updated_at: "2026-08-15T10:00:00.000Z",
      },
    ]);
    const prepare = vi.fn(() => ({ all }));
    const database = {
      raw: { prepare },
    } as unknown as NarrativeDatabase;

    const descriptors = new SqliteProjectCoverRepository(
      database,
    ).listDescriptors();

    const sql = String(prepare.mock.calls[0]?.[0]);
    expect(sql).not.toContain("image_data");
    expect(descriptors.get("project-1")).toEqual({
      projectId: "project-1",
      mediaType: "image/webp",
      byteSize: 2048,
      width: 800,
      height: 1200,
      crop: { x: 0.5, y: 0.4, zoom: 1.2 },
      updatedAt: "2026-08-15T10:00:00.000Z",
    });
  });
});
