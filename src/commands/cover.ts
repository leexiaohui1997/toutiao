import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { runImageTasks, sessionIdField, type ImageEngine } from "./image-runner.js";

/**
 * 顶层 cover 命令：从 overview.json 生成合集封面图。
 * 通过 --engine 指定生图引擎（doubao / jimeng / yuanbao）。
 */
export function registerCoverCommand(program: Command): void {
  program
    .command("cover")
    .description("从概览 JSON 生成合集封面图（--engine 选生图引擎）")
    .requiredOption("-f, --file <path>", "概览 JSON 文件路径（相对项目根）")
    .option("--engine <name>", "生图引擎: doubao / jimeng / yuanbao", "jimeng")
    .option("--overwrite", "已存在封面时强制覆盖", false)
    .option("--headless", "无头模式", false)
    .action(async (opts: { file: string; engine: ImageEngine; overwrite: boolean; headless: boolean }) => {
      const overviewPath = resolve(process.cwd(), opts.file);
      const overview: any = JSON.parse(await readFile(overviewPath, "utf-8"));
      const sidField = sessionIdField(opts.engine);

      if (overview.cover && !opts.overwrite) {
        console.log(`✓ 封面已存在: ${overview.cover}（加 --overwrite 可强制覆盖）`);
        process.exit(0);
      }

      if (!overview.collectionCoverPrompt) {
        console.error("✗ 概览 JSON 中没有 collectionCoverPrompt 字段");
        process.exit(1);
      }

      const coverRelPath = resolve(dirname(overviewPath), "cover.png").replace(process.cwd() + "/", "");
      console.log(`[engine=${opts.engine}] 生成合集封面: ${coverRelPath}`);

      const { sessionId } = await runImageTasks(
        opts.engine,
        [{ prompt: overview.collectionCoverPrompt, output: coverRelPath }],
        { headless: opts.headless, sessionId: overview[sidField] },
      );

      overview.cover = coverRelPath;
      if (sessionId) overview[sidField] = sessionId;
      await writeFile(overviewPath, JSON.stringify(overview, null, 2) + "\n", "utf-8");
      console.log(`✓ 已更新概览: cover=${coverRelPath}, ${sidField}=${sessionId || overview[sidField] || "(沿用)"}`);
      console.log("\n⚠️⚠️⚠️ 请一定要记得检查生成的图片是否符合要求！！⚠️⚠️⚠️");
    });
}
