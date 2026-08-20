import type JSZip from "jszip";

export function declaredUncompressedSize(
  entry: JSZip.JSZipObject,
  missingValue = 0,
): number {
  if (entry.dir) return 0;
  const internal = entry as unknown as {
    _data?: { uncompressedSize?: unknown };
  };
  const value = internal._data?.uncompressedSize;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : missingValue;
}
