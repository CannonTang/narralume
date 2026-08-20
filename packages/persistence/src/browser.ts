/**
 * 浏览器入口：不得引入任何 Node 内建模块（node:fs 等）。
 * Node 侧请用主入口的 NodeNarrativeDatabase。
 */
export type { SqliteRawDatabase, SqliteStatement } from "./driver.js";
export { createOpfsSahpoolDriver } from "./browser/wasm-driver.js";
export * from "./database.js";
export * from "./repositories.js";
