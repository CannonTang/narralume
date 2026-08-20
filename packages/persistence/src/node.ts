/**
 * Node 专用入口：NodeNarrativeDatabase（node:sqlite + VACUUM INTO 备份）。
 * 浏览器请用 ./browser；主入口不再携带任何 node: 内建依赖。
 */
export { NodeNarrativeDatabase } from "./node-database.js";
