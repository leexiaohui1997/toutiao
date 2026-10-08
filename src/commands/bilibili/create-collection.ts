import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { launchPersistentContext } from "../../browser.js";
import { Bilibili } from "./bilibili.js";

/**
 * `bilibili create-collection` 命令：从 overview.json 在 B 站创建文集（合集）。
 */
export function registerBilibiliCreateCollectionCommand(biliCmd: Command): void {
  biliCmd
    .command("create-collection")
    .description("从 overview.json 在 B 站创建文集")
    .requiredOption("-f, --file <path>", "overview.json 路径")
    .option("--headless", "无头模式", false)
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .action(async (opts: { file: string; headless: boolean; userDataDir?: string }) => {
      const jsonPath = resolve(process.cwd(), opts.file);
      console.log(`[bilibili create-collection] file=${jsonPath} headless=${opts.headless}`);

      const overview: any = JSON.parse(await readFile(jsonPath, "utf-8"));

      // ===== 前置检测：已创建过则跳过 =====
      if (overview.bilibiliCollectionId) {
        console.log(`✓ overview.bilibiliCollectionId = ${overview.bilibiliCollectionId}（B 站文集已创建），跳过`);
        process.exit(0);
      }

      // ===== 前置字段校验 =====
      const errors: string[] = [];
      if (!overview.collectionName) errors.push("缺 collectionName（文集名）");
      if (!overview.collectionDesc) errors.push("缺 collectionDesc（文集简介）");
      const coverPath: string | undefined = overview.xhsCover;
      if (!coverPath) {
        errors.push("缺 xhsCover（文集封面图路径，用小红书竖版封面）");
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
      const bili = new Bilibili(page);

      await bili.open();
      const loggedIn = await bili.checkLogin();
      if (!loggedIn) {
        console.error("✗ B 站未登录，退出");
        await context.close();
        process.exit(1);
      }

      // 打开文集管理页
      await bili.openOpusManager();

      // 前置检查：同名文集是否已存在
      const existingId = await bili.checkExistingCollection(overview.collectionName);
      if (existingId) {
        overview.bilibiliCollectionId = existingId;
        await writeFile(jsonPath, JSON.stringify(overview, null, 2), "utf-8");
        console.log(`[bilibili] 已回填 overview.bilibiliCollectionId = ${existingId}（复用已有文集）`);
        await context.close();
        process.exit(0);
      }

      // 点"创建文集"
      await bili.clickCreateCollectionButton();

      // 填标题 + 简介 + 传封面
      await bili.fillCollectionTitle(overview.collectionName);
      await bili.fillCollectionDesc(overview.collectionDesc);
      await bili.uploadCollectionCover(coverPath!);

      // 等封面预览出现 → 点"确认创建"
      await bili.clickConfirmCreate();

      // 等路由跳到 /opus/management/collection/{id}，拿 id 回填
      const collectionId = await bili.waitForCollectionCreated();
      overview.bilibiliCollectionId = collectionId;
      await writeFile(jsonPath, JSON.stringify(overview, null, 2), "utf-8");
      console.log(`[bilibili] 已回填 overview.bilibiliCollectionId = ${collectionId}`);

      await context.close();
    });
}
