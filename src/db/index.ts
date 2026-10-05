import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrations } from "./migrations.js";

export type Db = Database.Database;

/**
 * 打开 share_id 对应的 SQLite 数据库，自动跑 migration。
 * 文件位置：data/{share_id}.db
 */
export function openDb(shareId: string): Db {
  const dbPath = resolve(process.cwd(), `data/${shareId}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  // WAL 模式：并发更好、崩溃更安全
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const m of migrations) {
    if (m.version > current) {
      console.log(`[db] running migration v${m.version}: ${m.name}`);
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    }
  }
}

/**
 * 打开统一电子书库数据库 data/library.db。
 */
export function openLibraryDb(): Db {
  const dbPath = resolve(process.cwd(), "data/library.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
