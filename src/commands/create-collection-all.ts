import type { Command } from "commander";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * 统一创建合集：依次执行头条 + 小红书 + B 站。
 * 任一端失败即停下报错，不继续下一端。
 */
export function registerCreateCollectionAllCommand(program: Command): void {
  program
    .command("create-collection-all")
    .description("依次在头条 + 小红书 + B 站三端后台创建合集")
    .requiredOption("-f, --file <path>", "overview.json 路径")
    .option("--headless", "无头模式", false)
    .action(async (opts: { file: string; headless: boolean }) => {
      const overviewPath = resolve(process.cwd(), opts.file);
      console.log(`[create-collection-all] overview=${overviewPath}`);

      // 1. 头条
      console.log("\n===== [1/3] 创建头条合集 =====");
      try {
        execSync(
          `pnpm dev create-collection --file "${overviewPath}"${opts.headless ? " --headless" : ""}`,
          { stdio: "inherit" }
        );
      } catch (e) {
        console.error("✗ 头条合集创建失败，终止");
        process.exit(1);
      }

      // 2. 小红书
      console.log("\n===== [2/3] 创建小红书合集 =====");
      try {
        execSync(
          `pnpm dev xhs create-collection -f "${overviewPath}"${opts.headless ? " --headless" : ""}`,
          { stdio: "inherit" }
        );
      } catch (e) {
        console.error("✗ 小红书合集创建失败");
        process.exit(1);
      }

      // 3. B 站
      console.log("\n===== [3/3] 创建 B 站文集 =====");
      try {
        execSync(
          `pnpm dev bilibili create-collection -f "${overviewPath}"${opts.headless ? " --headless" : ""}`,
          { stdio: "inherit" }
        );
      } catch (e) {
        console.error("✗ B 站文集创建失败");
        process.exit(1);
      }

      console.log("\n✓ 三端合集均已创建");
    });
}
