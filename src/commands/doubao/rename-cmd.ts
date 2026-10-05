import type { Command } from "commander";
import { launchPersistentContext } from "../../browser.js";
import { renameSession } from "./rename.js";

export function registerDoubaoRenameCommand(doubao: Command): void {
  doubao
    .command("rename")
    .description("重命名豆包会话")
    .requiredOption("-i, --chat-id <id>", "会话 id")
    .requiredOption("-n, --name <name>", "新会话名称")
    .option("--headless", "无头模式", false)
    .action(async (opts: { chatId: string; name: string; headless: boolean }) => {
      const context = await launchPersistentContext({ headless: opts.headless });
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`https://www.doubao.com/chat/${opts.chatId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);

      const loginBtn = page.locator("button:has-text('登录')").first();
      if (await loginBtn.isVisible().catch(() => false)) {
        console.error("✗ 未登录");
        await context.close();
        process.exit(1);
      }

      await renameSession(page, opts.name);
      await context.close();
    });
}
