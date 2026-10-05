import type { Command } from "commander";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { openLibraryDb } from "../db/index.js";
import { launchPersistentContext } from "../browser.js";

/** download-book 命令：根据推荐书 id，本地有则返回路径，没有则从夸克下载 */
export function registerDownloadBookCommand(library: Command): void {
  library
    .command("download-book")
    .description("根据推荐书 id 获取本地文件路径，不存在则从夸克下载")
    .requiredOption("-i, --id <id>", "推荐书 id（book_recommendations.id）")
    .action(async (opts: { id: string }) => {
      const db = openLibraryDb();
      const rec = db.prepare(`
        SELECT r.id, r.file_id, r.name, r.score, f.url, f.ext
        FROM book_recommendations r
        JOIN files f ON f.id = r.file_id
        WHERE r.id = ?
      `).get(Number(opts.id)) as any;

      if (!rec) {
        console.error(`未找到推荐书 #${opts.id}`);
        process.exit(1);
      }

      // 1. 检查本地 books/ 目录
      const booksDir = resolve(process.cwd(), "books");
      mkdirSync(booksDir, { recursive: true });
      const localFile = join(booksDir, `${rec.file_id}.${rec.ext}`);
      if (existsSync(localFile)) {
        console.log(JSON.stringify({ localPath: localFile, name: rec.name }, null, 2));
        db.close();
        return;
      }

      // 2. 从夸克下载
      console.log(`本地不存在，从夸克下载: ${rec.name}`);
      const context = await launchPersistentContext({ headless: true, acceptDownloads: true });
      const page = context.pages()[0] ?? (await context.newPage());

      try {
        await page.goto(rec.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);

        // 虚拟滚动：边滚边找目标文件名
        const safeName = rec.name.replace(/[.*+?^${}()|[]\]/g, "\$&");
        let targetRow = page.locator(`tr.ant-table-row:has(.filename-text[title="${safeName}"])`);
        let found = await targetRow.count() > 0;
        let stagnant = 0;
        const totalRows = await page.locator("tr.ant-table-row").count();
        console.log(`当前目录行数: ${totalRows}, 找: ${rec.name}`);
        while (!found && stagnant < 8) {
          await page.evaluate(() => {
            const c = document.querySelector(".ant-table-body") as HTMLElement;
            if (c) c.scrollTop += c.clientHeight * 0.8;
          });
          await page.waitForTimeout(800);
          targetRow = page.locator(`tr.ant-table-row:has(.filename-text[title="${safeName}"])`);
          const c = await targetRow.count();
          console.log(`  滚动 ${stagnant + 1}/8, 匹配行数: ${c}`);
          if (c > 0) found = true;
          else stagnant++;
        }

        if (!found) {
          console.error(`未找到文件: ${rec.name}`);
          process.exit(1);
        }

        // 先取消全选，再只勾目标行
        const headerCheckbox = page.locator("thead input[type=checkbox]");
        if (await headerCheckbox.count() > 0 && await headerCheckbox.isChecked()) {
          await headerCheckbox.click();
          await page.waitForTimeout(500);
        }
        await targetRow.locator("input[type=checkbox]").check();
        await page.waitForTimeout(5000);

        // 点底部下载按钮
        const dlBtn = page.locator(".share-download:has-text('下载')").last();
        await dlBtn.waitFor({ state: "visible", timeout: 5000 });
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 60000 }),
          dlBtn.click(),
        ]);

        await download.saveAs(localFile);
        console.log(`✓ 下载完成: ${localFile}`);
        console.log(JSON.stringify({ localPath: localFile, name: rec.name }, null, 2));
      } catch (err) {
        console.error("下载失败:", (err as Error).message);
        process.exit(1);
      } finally {
        await context.close().catch(() => undefined);
        db.close();
      }
    });
}
