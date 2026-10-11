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
    .option("--headless", "无头模式", true)
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
          // 隐藏头条发布页上所有可能拦截点击的弹窗/抽屉/遮罩
          const selectors = [
            ".ai-assistant-drawer", ".byte-drawer-mask", ".byte-modal-wrapper",
            ".byte-modal-mask", ".byte-mask", ".byte-drawer", ".byte-popup",
            "[class*='byte-modal']", "[class*='byte-drawer']", "[class*='byte-mask']",
          ];
          selectors.forEach(s => {
            document.querySelectorAll(s).forEach(el => (el as HTMLElement).style.display = "none");
          });
        });

        // 正文编辑器：优先取带"正文"占位的 ProseMirror，否则取最后一个
        const bodyEditor = page.locator(
          ".ProseMirror[data-placeholder*='正文'], .ProseMirror[aria-placeholder*='正文'], .ProseMirror:has-text('请输入正文')"
        );
        const target = (await bodyEditor.count()) > 0 ? bodyEditor.first() : page.locator(".ProseMirror").last();
        // 常规点击聚焦（遮罩已隐藏），确保焦点在正文
        await target.click({ timeout: 15000 });
        await page.waitForTimeout(500);
        await page.evaluate(() => {
          const p = document.querySelector(".ProseMirror");
          if (p) (p as HTMLElement).focus();
        });
        // 必须逐字 type，insertText 不触发 # 的话题监听
        await page.keyboard.type(`#${opts.keyword}`, { delay: 80 });
        await page.waitForTimeout(6000);

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
