export const migration027 = {
  version: 27,
  name: "project-covers",
  sql: `
    CREATE TABLE project_covers (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg','image/png','image/webp')),
      image_data BLOB NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
      width INTEGER NOT NULL CHECK (width > 0 AND width <= 12000),
      height INTEGER NOT NULL CHECK (height > 0 AND height <= 12000),
      crop_x REAL NOT NULL CHECK (crop_x >= 0 AND crop_x <= 1),
      crop_y REAL NOT NULL CHECK (crop_y >= 0 AND crop_y <= 1),
      crop_zoom REAL NOT NULL CHECK (crop_zoom >= 1 AND crop_zoom <= 3),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `,
} as const;
