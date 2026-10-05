import type { Command } from "commander";
import { launchPersistentContext } from "../browser.js";

/**
 * `open` 命令：打开浏览器到指定 URL，复用上次的登录态。
 * 默认有头模式，方便第一次手动登录；登录态写在 userDataDir，下次自动带上。
 */
export function registerOpenCommand(program: Command): void {
  program
    .command("open")
    .description("打开浏览器（保留登录态），手动登录后退出即可，下次自动复用")
    .argument("[url]", "要打开的页面地址", "about:blank")
    .option("--headless", "无头模式运行", false)
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .action(async (url: string, opts: { headless: boolean; userDataDir?: string }) => {
      const context = await launchPersistentContext({
        headless: opts.headless,
        userDataDir: opts.userDataDir,
      });

      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(url, { waitUntil: "domcontentloaded" }).catch((err: unknown) => {
        console.warn(`[warn] goto ${url} 失败: ${(err as Error).message}`);
      });

      console.log(`已打开 ${url}`);
      console.log("登录态目录：", opts.userDataDir ?? "(默认 .browser-data/chromium)");
      console.log("按 Ctrl+C 退出（登录态会自动保存）");

      const close = async () => {
        await context.close().catch(() => undefined);
        process.exit(0);
      };
      process.on("SIGINT", close);
      process.on("SIGTERM", close);
    });
}
