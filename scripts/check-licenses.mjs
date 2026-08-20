#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const approved = new Set([
  "(MIT AND Zlib)",
  "(MIT OR GPL-3.0-or-later)",
  "(MPL-2.0 OR Apache-2.0)",
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT OR Apache-2.0",
  "MIT-0",
  "MPL-2.0",
]);
const packages = [
  ...new Map(
    Object.entries(lock.packages)
      .filter(
        ([path, metadata]) =>
          path.includes("node_modules/") && metadata.version,
      )
      .map(([path, metadata]) => {
        const name = path.split("node_modules/").at(-1);
        return [
          `${name}@${metadata.version}`,
          {
            name,
            version: metadata.version,
            license: metadata.license ?? "MISSING",
            scope: metadata.dev ? "development" : "production",
          },
        ];
      }),
  ).values(),
].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);

const invalid = packages.filter((item) => !approved.has(item.license));
if (invalid.length > 0) {
  console.error("Unreviewed or missing dependency licenses:");
  for (const item of invalid)
    console.error(`${item.name}@${item.version}: ${item.license}`);
  process.exit(1);
}

const csv = [
  "name,version,scope,license",
  ...packages.map((item) =>
    [item.name, item.version, item.scope, item.license]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(","),
  ),
  "",
].join("\n");
const inventory = join(root, "docs", "third-party-licenses.csv");
if (process.argv.includes("--write")) {
  writeFileSync(inventory, csv);
  console.log(`Wrote ${packages.length} dependency records to ${inventory}`);
} else if (readFileSync(inventory, "utf8").replaceAll("\r\n", "\n") !== csv) {
  console.error(
    "docs/third-party-licenses.csv is stale; run npm run licenses:update",
  );
  process.exit(1);
} else {
  console.log(`Verified ${packages.length} dependency license records.`);
}
