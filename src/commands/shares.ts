import type { Command } from "commander";
import { openLibraryDb } from "../db/index.js";
import { launchPersistentContext } from "../browser.js";

/** 分享链接相关子命令：add-share / list-shares / stats / reset */
export function registerShareCommands(library: Command): void {
  // 添加分享链接
  library
    .command("add-share")
    .description("添加夸克网盘分享链接")
    .argument("<url>", "分享链接")
    .action(async (url: string) => {
      const db = openLibraryDb();

      // 1. 去掉 # 后面的部分
      const cleanUrl = url.split("#")[0];

      // 2. 校验格式
      if (!/^https:\/\/pan\.quark\.cn\/s\/\w+$/.test(cleanUrl)) {
        console.error(`✗ 链接格式不正确: ${cleanUrl}`);
        process.exit(1);
      }

      // 3. 是否已存在
      const existing = db.prepare("SELECT id FROM shares WHERE url = ?").get(cleanUrl);
      if (existing) {
        console.log(`✓ 已存在: ${cleanUrl}`);
        db.close();
        return;
      }

      // 4. 用 playwright 验证链接有效
      console.log("验证链接有效性…");
      const context = await launchPersistentContext({ headless: true });
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(cleanUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const invalid = await page.locator("text=页面不存在").count();
      await context.close().catch(() => undefined);
      if (invalid) {
        console.error(`✗ 链接无效或已失效: ${cleanUrl}`);
        process.exit(1);
      }

      // 5. 写入数据库
      db.prepare("INSERT INTO shares (url, type) VALUES (?, ?)").run(cleanUrl, "quark");
      console.log(`✓ 已添加: ${cleanUrl}`);
      db.close();
    });

  // 列出所有分享链接
  library
    .command("list-shares")
    .description("列出所有分享链接")
    .action(() => {
      const db = openLibraryDb();
      const rows = db.prepare(`
        SELECT s.id, s.url, s.type, s.status,
               (SELECT COUNT(*) FROM folders f WHERE f.share_id = s.id) AS folder_count,
               (SELECT COUNT(*) FROM files f WHERE f.share_id = s.id) AS file_count
        FROM shares s ORDER BY s.id
      `).all() as any[];
      console.log(`共 ${rows.length} 个分享链接：\n`);
      for (const r of rows) {
        console.log(`  #${r.id} [${r.type}] ${r.url}`);
        console.log(`     状态: ${r.status} | 文件夹: ${r.folder_count} | 文件: ${r.file_count}`);
      }
      db.close();
    });

  // 统计概览
  library
    .command("stats")
    .description("统计书库概览")
    .action(() => {
      const db = openLibraryDb();
      const shares = db.prepare("SELECT status, COUNT(*) c FROM shares GROUP BY status").all() as any[];
      const folders = db.prepare("SELECT status, COUNT(*) c FROM folders GROUP BY status").all() as any[];
      const files = db.prepare("SELECT status, COUNT(*) c FROM files GROUP BY status").all() as any[];
      console.log("分享链接:", shares);
      console.log("文件夹:", folders);
      console.log("文件:", files);
      db.close();
    });

  // 重置某个分享的状态（重新爬取）
  library
    .command("reset")
    .description("重置某个分享的状态（删除其文件夹/文件，重新爬取）")
    .requiredOption("-i, --id <id>", "分享 id")
    .action((opts: { id: string }) => {
      const db = openLibraryDb();
      db.prepare("DELETE FROM files WHERE share_id = ?").run(Number(opts.id));
      db.prepare("DELETE FROM folders WHERE share_id = ?").run(Number(opts.id));
      db.prepare("UPDATE shares SET status = 'pending' WHERE id = ?").run(Number(opts.id));
      console.log(`✓ 分享 #${opts.id} 已重置`);
      db.close();
    });
}
