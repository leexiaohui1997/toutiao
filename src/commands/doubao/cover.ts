import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { runImageTasks } from "./image.js";

interface OverviewJson {
  bookTitle?: string;
  collectionName?: string;
  collectionCoverPrompt?: string;
  cover?: string;
  doubaoChatId?: string;
  [key: string]: any;
}

export function registerDoubaoCoverCommand(doubao: Command): void {
  doubao
    .command("cover")
    .description("从概览 JSON 生成合集封面图")
    .requiredOption("-f, --file <path>", "概览 JSON 文件路径（相对项目根）")
    .option("--overwrite", "已存在封面时强制覆盖", false)
    .option("--headless", "无头模式", false)
    .action(async (opts: { file: string; overwrite: boolean; headless: boolean }) => {
      const overviewPath = resolve(process.cwd(), opts.file);
      const overview: OverviewJson = JSON.parse(await readFile(overviewPath, "utf-8"));

      if (overview.cover && !opts.overwrite) {
        console.log(`✓ 封面已存在: ${overview.cover}（加 --overwrite 可强制覆盖）`);
        process.exit(0);
      }

      if (!overview.collectionCoverPrompt) {
        console.error("✗ 概览 JSON 中没有 collectionCoverPrompt 字段");
        process.exit(1);
      }

      const coverRelPath = resolve(dirname(overviewPath), "cover.png").replace(process.cwd() + "/", "");
      console.log(`生成封面: ${coverRelPath}`);

      // 直接调用 image 指令的完整逻辑
      const { chatId } = await runImageTasks({
        prompt: JSON.stringify([{
          prompt: overview.collectionCoverPrompt,
          output: coverRelPath,
        }]),
        chatId: overview.doubaoChatId,
        rename: overview.doubaoChatId ? undefined : `${overview.bookTitle || "合集"}生图`,
        headless: opts.headless,
      });

      // 更新概览 json
      overview.cover = coverRelPath;
      if (chatId) overview.doubaoChatId = chatId;
      await writeFile(overviewPath, JSON.stringify(overview, null, 2) + "\n", "utf-8");
      console.log(`✓ 已更新概览: cover=${coverRelPath}, doubaoChatId=${chatId || overview.doubaoChatId || "(沿用)"}`);
    });
}
