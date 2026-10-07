import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { runImageTasks, sessionIdField, type ImageEngine, type ImageTask } from "./image-runner.js";

/**
 * 顶层 cover 命令：从 overview.json 生成合集封面图。
 * 通过 --engine 指定生图引擎（doubao / jimeng / yuanbao）。
 *
 * 流程：一次性构造 tasks 数组，只调用一次 runImageTasks：
 *   1. 头条横版封面（collectionCoverPrompt → cover.png）；
 *   2. 若有 xhsCollectionCoverPrompt，追加小红书竖版封面（xhs-cover.png），
 *      ref 指向第一步的 cover.png（runner 内部按顺序执行，跑到第 2 个时第 1 个已下载落地）。
 */
export function registerCoverCommand(program: Command): void {
  program
    .command("cover")
    .description("从概览 JSON 生成合集封面图（含头条横版 + 小红书竖版，--engine 选生图引擎）")
    .requiredOption("-f, --file <path>", "概览 JSON 文件路径（相对项目根）")
    .option("--engine <name>", "生图引擎: doubao / jimeng / yuanbao", "jimeng")
    .option("--overwrite", "已存在封面时强制覆盖", false)
    .option("--headless", "无头模式", false)
    .action(async (opts: { file: string; engine: ImageEngine; overwrite: boolean; headless: boolean }) => {
      const overviewPath = resolve(process.cwd(), opts.file);
      const overview: any = JSON.parse(await readFile(overviewPath, "utf-8"));
      const sidField = sessionIdField(opts.engine);

      const dir = dirname(overviewPath);
      const toRel = (abs: string) => abs.replace(process.cwd() + "/", "");
      const coverRelPath = toRel(resolve(dir, "cover.png"));
      const xhsCoverRelPath = toRel(resolve(dir, "xhs-cover.png"));

      // 构造待生成任务列表
      const tasks: ImageTask[] = [];

      // 1. 头条横版封面
      if (overview.cover && !opts.overwrite) {
        console.log(`✓ 头条封面已存在: ${overview.cover}（加 --overwrite 可强制覆盖）`);
      } else {
        if (!overview.collectionCoverPrompt) {
          console.error("✗ 概览 JSON 中没有 collectionCoverPrompt 字段");
          process.exit(1);
        }
        tasks.push({ prompt: overview.collectionCoverPrompt, output: coverRelPath });
      }

      // 2. 小红书竖版封面（若有提示词）—— ref 提前指向 cover.png 路径
      if (overview.xhsCollectionCoverPrompt) {
        if (overview.xhsCover && !opts.overwrite) {
          console.log(`✓ 小红书封面已存在: ${overview.xhsCover}（加 --overwrite 可强制覆盖）`);
        } else {
          tasks.push({
            prompt: overview.xhsCollectionCoverPrompt,
            output: xhsCoverRelPath,
            ref: coverRelPath, // 第二个任务跑到时，第一个任务已把 cover.png 下载落地
          });
        }
      } else {
        console.log("ℹ️ 概览 JSON 无 xhsCollectionCoverPrompt，跳小红书封面");
      }

      if (tasks.length === 0) {
        console.log("✓ 全部封面已存在，无需生图");
        console.log("\n⚠️⚠️⚠️ 请一定要记得检查已生成的图片是否符合要求！！⚠️⚠️⚠️");
        return;
      }

      console.log(`[engine=${opts.engine}] 待生成封面 ${tasks.length} 张:`, tasks.map((t) => t.output));
      const { sessionId } = await runImageTasks(opts.engine, tasks, {
        headless: opts.headless,
        sessionId: overview[sidField],
      });

      // 回填结果
      overview.cover = coverRelPath;
      if (overview.xhsCollectionCoverPrompt) overview.xhsCover = xhsCoverRelPath;
      if (sessionId) overview[sidField] = sessionId;
      await writeFile(overviewPath, JSON.stringify(overview, null, 2) + "\n", "utf-8");

      console.log(`\n✓ 概览已更新: cover=${overview.cover}, xhsCover=${overview.xhsCover || "(无)"}, ${sidField}=${overview[sidField] || "(沿用)"}`);
      console.log("\n⚠️⚠️⚠️ 请一定要记得检查生成的图片是否符合要求！！⚠️⚠️⚠️");
    });
}
