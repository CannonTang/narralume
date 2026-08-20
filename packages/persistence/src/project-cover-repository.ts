import type { NarrativeDatabase } from "./database.js";
import { PersistenceNotFoundError } from "./project-repository.js";

export type ProjectCoverMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface ProjectCoverCrop {
  x: number;
  y: number;
  zoom: number;
}

export interface ProjectCoverDescriptor {
  projectId: string;
  mediaType: ProjectCoverMediaType;
  byteSize: number;
  width: number;
  height: number;
  crop: ProjectCoverCrop;
  updatedAt: string;
}

export interface StoredProjectCover extends ProjectCoverDescriptor {
  data: Uint8Array;
  createdAt: string;
}

interface ProjectCoverRow {
  project_id: string;
  media_type: ProjectCoverMediaType;
  image_data: Uint8Array;
  byte_size: number;
  width: number;
  height: number;
  crop_x: number;
  crop_y: number;
  crop_zoom: number;
  created_at: string;
  updated_at: string;
}

type ProjectCoverDescriptorRow = Omit<
  ProjectCoverRow,
  "image_data" | "created_at"
>;

export class SqliteProjectCoverRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  get(projectId: string): StoredProjectCover | null {
    const row = this.database.raw
      .prepare("SELECT * FROM project_covers WHERE project_id = ?")
      .get(projectId) as ProjectCoverRow | undefined;
    return row ? mapCover(row) : null;
  }

  listDescriptors(): Map<string, ProjectCoverDescriptor> {
    const rows = this.database.raw
      .prepare(
        `SELECT project_id, media_type, byte_size, width, height,
                crop_x, crop_y, crop_zoom, updated_at
         FROM project_covers ORDER BY project_id`,
      )
      .all() as unknown as ProjectCoverDescriptorRow[];
    return new Map(rows.map((row) => [row.project_id, mapDescriptor(row)]));
  }

  upsert(input: {
    projectId: string;
    mediaType: ProjectCoverMediaType;
    data: Uint8Array;
    width: number;
    height: number;
    crop: ProjectCoverCrop;
    now: string;
  }): ProjectCoverDescriptor {
    this.database.raw
      .prepare(
        `INSERT INTO project_covers(
           project_id, media_type, image_data, byte_size, width, height,
           crop_x, crop_y, crop_zoom, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           media_type = excluded.media_type,
           image_data = excluded.image_data,
           byte_size = excluded.byte_size,
           width = excluded.width,
           height = excluded.height,
           crop_x = excluded.crop_x,
           crop_y = excluded.crop_y,
           crop_zoom = excluded.crop_zoom,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.projectId,
        input.mediaType,
        input.data,
        input.data.byteLength,
        input.width,
        input.height,
        input.crop.x,
        input.crop.y,
        input.crop.zoom,
        input.now,
        input.now,
      );
    return this.getDescriptor(input.projectId)!;
  }

  updateCrop(
    projectId: string,
    crop: ProjectCoverCrop,
    now: string,
  ): ProjectCoverDescriptor {
    const result = this.database.raw
      .prepare(
        `UPDATE project_covers
         SET crop_x = ?, crop_y = ?, crop_zoom = ?, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(crop.x, crop.y, crop.zoom, now, projectId);
    if (result.changes !== 1)
      throw new PersistenceNotFoundError("project_cover", projectId);
    return this.getDescriptor(projectId)!;
  }

  delete(projectId: string): boolean {
    return (
      this.database.raw
        .prepare("DELETE FROM project_covers WHERE project_id = ?")
        .run(projectId).changes === 1
    );
  }

  private getDescriptor(projectId: string): ProjectCoverDescriptor | null {
    const row = this.database.raw
      .prepare(
        `SELECT project_id, media_type, byte_size, width, height,
                crop_x, crop_y, crop_zoom, updated_at
         FROM project_covers WHERE project_id = ?`,
      )
      .get(projectId) as ProjectCoverDescriptorRow | undefined;
    return row ? mapDescriptor(row) : null;
  }
}

function mapCover(row: ProjectCoverRow): StoredProjectCover {
  return {
    projectId: row.project_id,
    mediaType: row.media_type,
    data: row.image_data,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    crop: { x: row.crop_x, y: row.crop_y, zoom: row.crop_zoom },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDescriptor(row: ProjectCoverDescriptorRow): ProjectCoverDescriptor {
  return {
    projectId: row.project_id,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    crop: { x: row.crop_x, y: row.crop_y, zoom: row.crop_zoom },
    updatedAt: row.updated_at,
  };
}
