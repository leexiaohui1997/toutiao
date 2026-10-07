import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { launchPersistentContext } from "../../browser.js";
import { Xhs } from "./xhs.js";

/**
 * `xhs create-collection` 命令：从 overview.json 在小红书创建合集（专辑/收藏夹）。
 */
export function registerXhsCreateCollectionCommand(xhsCmd: Command): void {
  xhsCmd
    .command("create-collection")
    .description("从 overview.json 创建小红书合集（骨架，逻辑待实现）")
    .requiredOption("-f, --file <path>", "overview.json 路径")
    .option("--headless", "无头模式", false)
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .action(async (opts: { file: string; headless: boolean; userDataDir?: string }) => {
      const jsonPath = resolve(process.cwd(), opts.file);
      console.log(`[xhs create-collection] file=${jsonPath} headless=${opts.headless}`);

      const overview: any = JSON.parse(await readFile(jsonPath, "utf-8"));

      // ===== 前置字段校验（不启动浏览器，校验失败直接退出） =====
      const errors: string[] = [];

      if (!overview.collectionName) errors.push("缺 collectionName（合集名）");

      if (!overview.collectionDesc) {
        errors.push("缺 collectionDesc（合集简介）");
      } else if (overview.collectionDesc.length > 100) {
        errors.push(`collectionDesc 超过 100 字（当前 ${overview.collectionDesc.length} 字），请压缩`);
      }

      const coverPath: string | undefined = overview.xhsCover || overview.cover;
      if (!coverPath) {
        errors.push("缺 xhsCover / cover（合集封面图路径）");
      } else if (!existsSync(resolve(process.cwd(), coverPath))) {
        errors.push(`封面文件不存在: ${coverPath}`);
      }

      if (errors.length > 0) {
        console.error("✗ overview.json 校验失败：");
        errors.forEach((e) => console.error(`  - ${e}`));
        process.exit(1);
      }

      const context = await launchPersistentContext({
        headless: opts.headless,
        userDataDir: opts.userDataDir,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      const xhs = new Xhs(page);

      await xhs.open();
      const loggedIn = await xhs.checkLogin();
      if (!loggedIn) {
        console.error("✗ 小红书未登录，退出");
        await context.close();
        process.exit(1);
      }

      // 打开发布页，填标题 + 传封面
      const canCreate = await xhs.openPublishPage(overview.collectionName);
      if (!canCreate) {
        await context.close();
        process.exit(0);
      }

      await xhs.fillTitle(overview.collectionName);
      await xhs.fillDesc(overview.collectionDesc);
      await xhs.uploadCover(coverPath!);
      await xhs.clickCreate();

      // 创建成功，回填 overview.xhsCreated = true
      overview.xhsCreated = true;
      await writeFile(jsonPath, JSON.stringify(overview, null, 2), "utf-8");
      console.log("[xhs] 已回填 overview.xhsCreated = true");

      await context.close();
    });
}
