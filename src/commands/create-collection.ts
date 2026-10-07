import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import { launchPersistentContext } from "../browser.js";
import { ensureLogin } from "../toutiao/auth.js";
import { createCollection } from "../toutiao/collection.js";
import { compressImage } from "./compress.js";

/**
 * `create-collection` 命令：从 overview.json 创建合集。
 *
 * JSON 格式（overview.json 顶层字段）：
 * {
 *   "collectionName": "合集名",
 *   "cover": "docs/xxx/cover.png"  // 合集封面本地路径，相对项目根
 * }
 */
interface OverviewJson {
  collectionName: string;
  cover?: string;
}

export function registerCreateCollectionCommand(program: Command): void {
  program
    .command("create-collection")
    .description("从 overview.json 创建合集（填名称+封面，自动检测发布状态）")
    .requiredOption("-f, --file <path>", "overview.json 路径")
    .option("--headless", "无头模式", false)
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .action(async (opts: { file: string; headless: boolean; userDataDir?: string }) => {
      const jsonPath = resolve(process.cwd(), opts.file);
      let data: OverviewJson;
      try {
        const raw = await readFile(jsonPath, "utf-8");
        data = JSON.parse(raw);
      } catch (err) {
        console.error(`读取 JSON 失败: ${(err as Error).message}`);
        process.exit(1);
      }
      if (!data.collectionName || !data.cover) {
        console.error("JSON 需包含 collectionName 和 cover 字段");
        process.exit(1);
      }
      console.log(`创建合集：${data.collectionName}`);

      // 上传前先压缩封面图
      console.log("压缩合集封面图…");
      await compressImage(data.cover);

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
        await createCollection(page, data.collectionName, data.cover);
        console.log("✓ 完成");
      } catch (err) {
        console.error("创建合集失败:", (err as Error).message);
        if (opts.headless) {
          await page.screenshot({ path: "create-collection-error.png" }).catch(() => undefined);
        }
        await context.close().catch(() => undefined);
        process.exit(1);
      }

      await context.close().catch(() => undefined);
      process.exit(0);
    });
}
