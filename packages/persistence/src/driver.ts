/**
 * 持久层驱动的最小面：仓储代码只依赖这三个方法（prepare/exec/close），
 * node:sqlite 的 DatabaseSync 结构上满足本接口，浏览器 WASM 驱动按同一
 * 形状实现，仓储零改动即可双运行时运行。
 *
 * 行对象一律“列名做键”（与 node:sqlite 默认一致）；参数一律按位传。
 */
export interface SqliteStatement {
  run(...params: unknown[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteRawDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
  /**
   * 导出整个数据库的字节（下载我的库，D6）。Node 驱动暂未实现——
   * Node 侧走备份服务（VACUUM INTO + 完整性校验）；浏览器 sahpool
   * 驱动用 pool 的 exportFile。
   */
  exportBytes?(): Promise<Uint8Array>;
}
