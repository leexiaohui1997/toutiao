import type { Command } from "commander";
import { launchPersistentContext } from "../browser.js";
import { ensureLogin } from "../toutiao/auth.js";

/**
 * `delete-drafts` 命令：循环删除草稿箱所有草稿。
 */
export function registerDeleteDraftsCommand(program: Command): void {
  program
    .command("delete-drafts")
    .description("循环删除草稿箱所有草稿")
    .option("--headless", "无头模式", false)
    .option("--user-data-dir <dir>", "覆盖持久化目录")
    .action(async (opts: { headless: boolean; userDataDir?: string }) => {
      const context = await launchPersistentContext({
        headless: opts.headless,
        userDataDir: opts.userDataDir,
      });
      const page = context.pages()[0] ?? (await context.newPage());

      let loggedIn = false;
      try {
        loggedIn = await ensureLogin(context, { page });
      } catch { /* ignore */ }
      if (!loggedIn) {
        console.error("未登录，请先 pnpm dev login");
        await context.close().catch(() => undefined);
        process.exit(1);
      }

      try {
        console.log("打草稿箱…");
        await page.goto("https://mp.toutiao.com/profile_v4/manage/draft", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(2000);

        let count = 0;
        while (true) {
          // 找第一条草稿的"删除"链接
          const delBtn = page.locator('a:has-text("删除"), button:has-text("删除")').first();
          const exists = await delBtn.isVisible().catch(() => false);
          if (!exists) {
            console.log("没有更多草稿了");
            break;
          }
          await delBtn.click();
          await page.waitForTimeout(1000);

          // 确认弹窗
          const confirmBtn = page
            .locator('.byte-modal-footer button:has-text("确定"), .byte-modal button:has-text("确定"), button:has-text("确认")')
            .last();
          await confirmBtn.waitFor({ state: "visible", timeout: 5000 });
          await confirmBtn.click();
          await page.waitForTimeout(1500);
          count++;
          console.log(`已删除第 ${count} 条草稿`);
        }
        console.log(`✓ 共删除 ${count} 条草稿`);
      } catch (err) {
        console.error("删除草稿失败:", (err as Error).message);
      }

      await context.close().catch(() => undefined);
      process.exit(0);
    });
}
