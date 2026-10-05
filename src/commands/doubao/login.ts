import type { Command } from "commander";
import { launchPersistentContext } from "../../browser.js";

export function registerDoubaoLoginCommand(doubao: Command): void {
  doubao
    .command("login")
    .description("登录豆包（未登录则打开页面扫码）")
    .option("--headless", "无头模式（只检测是否登录）", false)
    .action(async (opts: { headless: boolean }) => {
      const context = await launchPersistentContext({ headless: opts.headless });
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto("https://www.doubao.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);

      const loginBtn = page.locator("button:has-text('登录')").first();
      const isLoggedIn = !(await loginBtn.isVisible().catch(() => false));

      if (isLoggedIn) {
        console.log("true");
        await context.close();
      } else {
        console.log("false - 未登录");
        if (opts.headless) {
          await context.close();
        } else {
          await loginBtn.click();
          console.log("已弹出登录窗口，请扫码登录...");
          await page.waitForSelector("button:has-text('登录')", { state: "detached", timeout: 300000 })
            .catch(() => console.log("超时未检测到登录"));
          console.log("true - 登录成功");
          await context.close();
        }
      }
    });
}
