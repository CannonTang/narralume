import { randomUuid, sha256Hex } from "@narralume/domain";

/**
 * 单一同步 sha256 入口。服务层的负载全是 KB 级 JSON 与短 ID 串，
 * domain 的纯 JS 实现在 Node 与浏览器 Worker 通用。
 */
export { randomUuid, sha256Hex };
