import type { Command } from "commander";
import { openLibraryDb } from "../db/index.js";
import { launchPersistentContext } from "../browser.js";
import { parseSize, processShareRoot, processFolder } from "./library/shared.js";

/** next-book 命令：按 files→folders→shares 顺序找下一本待处理的书 */
export function registerNextBookCommand(library: Command): void {
  library
    .command("next-book")
    .description("获取下一本未处理的书，按 files→folders→shares 顺序找")
    .option("--ext <exts>", "按格式筛选，逗号分隔，如 pdf,epub", "epub,mobi,pdf")
    .option("--max-size <size>", "最大文件大小，如 50MB, 1GB")
    .option("--limit <n>", "一次返回多少本（默认 1）", "1")
    .action(async (opts: { ext: string; maxSize?: string; limit: string }) => {
      const db = openLibraryDb();
      const exts = opts.ext.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      const maxBytes = opts.maxSize ? parseSize(opts.maxSize) : null;
      const limit = Number(opts.limit);
      const extPlaceholders = exts.map(() => "?").join(",");

      const collected: any[] = [];

      while (true) {
        // 1. files 表找 status=pending 的电子书
        const excludeIds = collected.map(c => c.id);
        const excludePlaceholders = excludeIds.map(() => "?").join(",");
        const params = [...exts, ...(maxBytes ? [maxBytes] : []), ...excludeIds];
        const pendingFile = db.prepare(`
          SELECT * FROM files
          WHERE status = 'pending'
            AND ext IN (${extPlaceholders})
            ${maxBytes ? "AND size_bytes <= ?" : ""}
            ${excludeIds.length ? `AND id NOT IN (${excludePlaceholders})` : ""}
          ORDER BY id LIMIT 1
        `).get(...params) as any;

        if (pendingFile) {
          collected.push({ id: pendingFile.id, name: pendingFile.name, url: pendingFile.url, size: pendingFile.size, ext: pendingFile.ext });
          if (collected.length >= limit) break;
          continue;
        }

        // 2. folders 表找 status=processing 的目录
        const processingFolder = db.prepare(`
          SELECT * FROM folders WHERE status = 'processing' ORDER BY id LIMIT 1
        `).get() as any;
        if (processingFolder) {
          const context = await launchPersistentContext({ headless: true });
          const page = context.pages()[0] ?? (await context.newPage());
          try {
            await processFolder(page, db, processingFolder);
          } catch (err) {
            console.error("处理文件夹失败:", (err as Error).message);
          }
          await context.close().catch(() => undefined);
          continue;
        }

        // 3. folders 表找 status=pending 的目录
        const pendingFolder = db.prepare(`
          SELECT * FROM folders WHERE status = 'pending' ORDER BY id LIMIT 1
        `).get() as any;
        if (pendingFolder) {
          const context = await launchPersistentContext({ headless: true });
          const page = context.pages()[0] ?? (await context.newPage());
          try {
            await processFolder(page, db, pendingFolder);
          } catch (err) {
            console.error("处理文件夹失败:", (err as Error).message);
          }
          await context.close().catch(() => undefined);
          continue;
        }

        // 4. 把 processing 的 share 改为 done
        db.prepare("UPDATE shares SET status = 'done' WHERE status = 'processing'").run();

        // 5. 找 pending 的 share
        const pendingShare = db.prepare(`
          SELECT * FROM shares WHERE status = 'pending' ORDER BY id LIMIT 1
        `).get() as any;
        if (pendingShare) {
          console.log(`处理分享: ${pendingShare.url}`);
          db.prepare("UPDATE shares SET status = 'processing' WHERE id = ?").run(pendingShare.id);

          const context = await launchPersistentContext({ headless: true });
          const page = context.pages()[0] ?? (await context.newPage());
          try {
            await processShareRoot(page, db, pendingShare.id, pendingShare.url);
          } catch (err) {
            console.error("处理分享失败:", (err as Error).message);
          }
          await context.close().catch(() => undefined);
          console.log("完成，重新查找…\n");
          continue;
        }

        // 6. 全部完成
        break;
      }

      console.log(JSON.stringify({ count: collected.length, files: collected }, null, 2));
      db.close();
    });
}
