import type { Command } from "commander";
import { openLibraryDb } from "../db/index.js";
import { parseSize } from "./library/shared.js";

/** 文件/文件夹/分享状态相关子命令：set-status / backfill-size */
export function registerFileCommands(library: Command): void {
  // 修改状态
  library
    .command("set-status")
    .description("修改分享/文件夹/文件的状态")
    .requiredOption("-t, --type <type>", "对象类型 share/folder/file/recommendation")
    .requiredOption("-i, --id <id>", "对象 id")
    .requiredOption("-s, --status <status>", "目标状态 pending/processing/done")
    .action((opts: { type: string; id: string; status: string }) => {
      const db = openLibraryDb();
      const table = opts.type === "share" ? "shares" : opts.type === "folder" ? "folders" : opts.type === "file" ? "files" : opts.type === "recommendation" ? "book_recommendations" : null;
      if (!table) {
        console.error("type 必须是 share/folder/file/recommendation");
        process.exit(1);
      }
      const info = db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).run(opts.status, Number(opts.id));
      if (info.changes > 0) {
        console.log(`✓ ${opts.type} #${opts.id} → ${opts.status}`);
      } else {
        console.log(`未找到 ${opts.type} #${opts.id}`);
      }
      db.close();
    });

  // 回填历史文件的 size_bytes
  library
    .command("backfill-size")
    .description("回填历史 files 记录的 size_bytes 字段")
    .action(() => {
      const db = openLibraryDb();
      const rows = db.prepare("SELECT id, size FROM files").all() as any[];
      console.log(`共 ${rows.length} 条记录待回填`);
      const stmt = db.prepare("UPDATE files SET size_bytes = ? WHERE id = ?");
      for (const r of rows) {
        stmt.run(parseSize(r.size), r.id);
      }
      console.log(`✓ 已回填 ${rows.length} 条记录`);
      db.close();
    });
}
