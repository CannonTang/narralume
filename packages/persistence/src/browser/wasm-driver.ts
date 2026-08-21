import type { BindableValue, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import type { SqliteRawDatabase, SqliteStatement } from "../driver.js";

/**
 * 浏览器 OPFS 驱动：官方 @sqlite.org/sqlite-wasm 的 opfs-sahpool VFS。
 * 只能在 dedicated Web Worker 内初始化（OPFS SyncAccessHandle 的平台
 * 限制）；sahpool 是单 origin 单连接模型，第二个标签页初始化会失败，
 * 多标签仲裁由内核层（Web Locks）处理，驱动不重试。
 */
export async function createOpfsSahpoolDriver(
  filename = "narralume.sqlite",
): Promise<SqliteRawDatabase> {
  const sqlite3: Sqlite3Static = await sqlite3InitModule();
  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    name: "narralume-pool",
    initialCapacity: 12,
  });
  // 必须显式用 pool 的 DB/VFS——裸 oo1.DB 会落在 wasm 内存 FS，重载即丢。
  // （运行时 normalizeArgs 支持 (filename, flags)；类型声明只写了 filename。）
  const DbCtor = poolUtil.OpfsSAHPoolDb as unknown as new (
    filename: string,
    flags: string,
  ) => InstanceType<Sqlite3Static["oo1"]["DB"]>;
  const db = new DbCtor(filename, "ct");
  // sahpool 官方建议：单连接配 exclusive 锁，WAL 可用且有小幅性能收益。
  db.exec(
    "PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;",
  );

  // 仓储层传的就是 SQL 值（string/number/bigint/null/Uint8Array），按位绑定。
  const bindable = (params: unknown[]): BindableValue[] =>
    params as BindableValue[];

  function queryRows(
    sql: string,
    params: unknown[],
  ): Record<string, unknown>[] {
    return db.exec({
      sql,
      bind: bindable(params),
      rowMode: "object",
      returnValue: "resultRows",
    }) as Record<string, unknown>[];
  }

  return {
    prepare(sql: string): SqliteStatement {
      return {
        run(...params: unknown[]) {
          db.exec({ sql, bind: bindable(params) });
          // prepare() 绑定的都是单条语句，changes() 即该语句的改动行数。
          // lastInsertRowid 无消费方（id 全部由应用侧生成），恒为 0。
          return {
            changes: db.changes() as number,
            lastInsertRowid: 0,
          };
        },
        get(...params: unknown[]) {
          return queryRows(sql, params)[0];
        },
        all(...params: unknown[]) {
          return queryRows(sql, params);
        },
      };
    },
    exec(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
    // 下载我的库（D6）：pool 导出该文件的完整字节（含 checkpoint 后数据）。
    // pool 的文件名映射键是 getPath 规范化后的绝对路径（/打头）。
    exportBytes() {
      const path = filename.startsWith("/") ? filename : `/${filename}`;
      return Promise.resolve(poolUtil.exportFile(path));
    },
  };
}
