import type { Command } from "commander";
import { launchPersistentContext } from "../browser.js";
import { ensureLogin } from "../toutiao/auth.js";

/**
 * `collect-topics` 命令：输入 #关键词，收集头条推荐的话题列表。
 */
export function registerCollectTopicsCommand(program: Command): void {
  program
    .command("collect-topics")
    .description("输入 #关键词，收集头条正文编辑器推荐的话题列表")
    .requiredOption("-k, --keyword <text>", "关键词，如：通胀")
    .option("--headless", "无头模式", false)
    .option("--user-data-dir <dir>", "覆盖持久化目录")
    .action(async (opts: { keyword: string; headless: boolean; userDataDir?: string }) => {
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
        console.log(`收集「#${opts.keyword}」相关话题…`);
        await page.goto("https://mp.toutiao.com/profile_v4/graphic/publish", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(3000);
        await page.evaluate(() => {
          const d = document.querySelector(".ai-assistant-drawer");
          if (d) (d as HTMLElement).style.display = "none";
          const m = document.querySelector(".byte-drawer-mask");
          if (m) (m as HTMLElement).style.display = "none";
        });

        await page.locator(".ProseMirror").click();
        // 必须逐字 type，insertText 不触发 # 的话题监听
        await page.keyboard.type(`#${opts.keyword}`, { delay: 50 });
        await page.waitForTimeout(2000);

        // 每个 .forum-list-item 含话题名(.forum-list-item-text)和讨论数(第二个div)
        const items = await page.evaluate(() => {
          return Array.from(document.querySelectorAll(".forum-list-item")).map(el => {
            const name = el.querySelector(".forum-list-item-text")?.textContent?.trim() || "";
            const meta = el.querySelector("div:nth-child(2)")?.textContent?.trim() || "";
            return { name, meta };
          });
        });
        console.log(`\n找到 ${items.length} 个话题：`);
        items.forEach((t, i) => console.log(`  ${i + 1}. #${t.name}#  (${t.meta})`));
      } catch (err) {
        console.error("收集失败:", (err as Error).message);
      }

      await context.close().catch(() => undefined);
      process.exit(0);
    });
}
