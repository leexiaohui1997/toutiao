import type { Command } from "commander";
import { launchPersistentContext } from "../browser.js";
import { ensureQuarkLogin } from "../quark/auth.js";

/**
 * `quark-login` 命令：夸克网盘扫码登录（登录态持久化到 .browser-data/chromium）。
 */
export function registerQuarkLoginCommand(program: Command): void {
  program
    .command("quark-login")
    .description("夸克网盘扫码登录（登录态持久化，供后续命令复用）")
    .option("--headless", "无头模式：只检测登录态，未登录直接退出", false)
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .action(async (opts: { headless: boolean; userDataDir?: string }) => {
      const context = await launchPersistentContext({
        headless: opts.headless,
        userDataDir: opts.userDataDir,
      });
      const page = context.pages()[0] ?? (await context.newPage());

      const ok = await ensureQuarkLogin(context, {
        page,
        onNeedLogin: () => {
          if (!opts.headless) {
            console.log("未登录，请用夸克网盘 APP 扫码登录…等待中（最多 5 分钟）…");
          }
        },
        scanTimeoutMs: opts.headless ? 5000 : 5 * 60 * 1000,
      });

      if (ok) {
        console.log(`✓ 已登录夸克网盘，当前 URL: ${page.url()}`);
        await context.close().catch(() => undefined);
        process.exit(0);
      }

      if (opts.headless) {
        console.error("✗ 未登录夸克网盘，请先运行 `pnpm dev quark-login` 扫码");
      } else {
        console.error("登录超时（5 分钟未扫码）");
      }
      await context.close().catch(() => undefined);
      process.exit(1);
    });
}
