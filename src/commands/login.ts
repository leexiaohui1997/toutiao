import type { Command } from "commander";
import { launchPersistentContext } from "../browser.js";
import { ensureLogin } from "../toutiao/auth.js";

/**
 * `login` 命令：检查今日头条登录态。
 * - 已登录：打印结果，正常退出。
 * - 未登录：打开浏览器并停留扫码登录弹窗，等待用户扫码；登录成功后自动退出。
 *
 * 退出码：0 = 已登录；1 = 扫码超时或出错。
 */
export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("检查今日头条登录态；未登录则打开浏览器等待扫码")
    .option("--headless", "无头模式（未登录时无法扫码，仅用于已登录校验）", false)
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .action(async (opts: { headless: boolean; userDataDir?: string }) => {
      const context = await launchPersistentContext({
        headless: opts.headless,
        userDataDir: opts.userDataDir,
      });

      let ok = false;
      try {
        ok = await ensureLogin(context, {
          onNeedLogin: () => {
            console.log("未检测到登录态，请在弹出的浏览器中使用「今日头条 App」扫码登录…");
            console.log("（二维码有效期约几分钟，过期可在页面上点刷新）");
          },
        });
      } catch (err) {
        console.error("登录检查出错:", (err as Error).message);
      }

      if (ok) {
        console.log("✓ 登录态有效");
      } else {
        console.error("✗ 未检测到登录态（扫码超时或出错）");
      }

      await context.close().catch(() => undefined);
      process.exit(ok ? 0 : 1);
    });
}
