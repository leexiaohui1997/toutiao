import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import { existsSync } from "node:fs";
import { runImageTasks, sessionIdField, type ImageEngine, type ImageTask } from "./image-runner.js";

interface ArticleBlock {
  type: "title" | "text" | "image";
  content: string;
  prompt?: string;
}

interface ArticleJson {
  no: number;
  bookTitle: string;
  cover: string;
  coverPrompt?: string;
  bilibiliCover?: string;
  bilibiliCoverPrompt?: string;
  content: ArticleBlock[];
  [key: string]: any;
}

/**
 * 顶层 article 命令：从 article.json 批量生成封面 + 插图。
 * 通过 --engine 指定生图引擎（doubao / jimeng / yuanbao）。
 */
export function registerArticleCommand(program: Command): void {
  program
    .command("article")
    .description("给成稿路径，自动生成封面与插图（--engine 选生图引擎）")
    .requiredOption("-f, --file <path>", "article.json 路径（相对项目根）")
    .option("--engine <name>", "生图引擎: doubao / jimeng / yuanbao", "jimeng")
    .option("-w, --session <id>", "指定会话 id（覆盖 overview 里的值）")
    .option("--headless", "无头模式", false)
    .action(async (opts: { file: string; engine: ImageEngine; session?: string; headless: boolean }) => {
      const articlePath = resolve(process.cwd(), opts.file);
      const article: ArticleJson = JSON.parse(await readFile(articlePath, "utf-8"));
      const articleDir = dirname(articlePath);
      const dirPrefix = relative(process.cwd(), articleDir);
      const sidField = sessionIdField(opts.engine);

      // 找上两级目录的 overview.json
      const overviewPath = join(articleDir, "..", "overview.json");
      let overview: any = {};
      try {
        overview = JSON.parse(await readFile(overviewPath, "utf-8"));
      } catch {}

      // 合集封面是否存在：存在则本篇封面以它为参考图
      const collectionCoverExists = !!overview.cover && existsSync(resolve(process.cwd(), overview.cover));

      const tasks: ImageTask[] = [];

      // 封面：cover 指向的文件不存在则生成，提示词从 coverPrompt 读
      const coverOut = join(dirPrefix, "cover.png");
      if (!existsSync(resolve(process.cwd(), coverOut))) {
        if (!article.coverPrompt) {
          console.error(`✗ ${articlePath} 缺少 coverPrompt 字段`);
          process.exit(1);
        }
        tasks.push({
          prompt: article.coverPrompt,
          output: coverOut,
          ...(collectionCoverExists ? { ref: overview.cover } : {}),
        });
      }

      // B 站封面（16:9）：若存在 bilibiliCoverPrompt 且文件未生成，以本篇默认封面为参考图再出一张
      const biliCoverOut = join(dirPrefix, "bilibili-cover.png");
      if (article.bilibiliCoverPrompt && !existsSync(resolve(process.cwd(), biliCoverOut))) {
        tasks.push({
          prompt: article.bilibiliCoverPrompt,
          output: biliCoverOut,
          ref: coverOut, // 用刚生成的默认封面作为参考图（任务按顺序跑，cover.png 此时已落盘）
        });
      }

      // 插图：content 指向的文件不存在则生成，提示词从 block.prompt 读
      let imgNo = 1;
      for (const block of article.content) {
        if (block.type !== "image") continue;
        const imgOut = join(dirPrefix, `插图${imgNo}.png`);
        if (existsSync(resolve(process.cwd(), imgOut))) {
          imgNo++;
          continue;
        }
        if (!block.prompt) {
          console.error(`✗ 插图${imgNo} 缺少 prompt 字段`);
          process.exit(1);
        }
        tasks.push({ prompt: block.prompt, output: imgOut });
        imgNo++;
      }

      if (tasks.length === 0) {
        console.log("✓ 所有图片都已生成，无需重复");
        process.exit(0);
      }

      console.log(`[engine=${opts.engine}] 共 ${tasks.length} 张图待生成：`);

      const { sessionId } = await runImageTasks(opts.engine, tasks, {
        headless: opts.headless,
        sessionId: opts.session || overview[sidField],
      });

      // 回写 article.json：cover / bilibiliCover / image block.content 写成路径（prompt 字段保留）
      article.cover = coverOut;
      if (article.bilibiliCoverPrompt) {
        article.bilibiliCover = biliCoverOut;
      }
      imgNo = 1;
      for (const block of article.content) {
        if (block.type !== "image") continue;
        block.content = join(dirPrefix, `插图${imgNo}.png`);
        imgNo++;
      }
      await writeFile(articlePath, JSON.stringify(article, null, 2) + "\n", "utf-8");

      // 回写 overview.json 的会话 id
      if (sessionId) {
        overview[sidField] = sessionId;
        await writeFile(overviewPath, JSON.stringify(overview, null, 2) + "\n", "utf-8");
      }

      console.log(`✓ 已更新 article.json，${sidField}: ${sessionId || overview[sidField] || "(沿用)"}`);
      console.log("\n⚠️⚠️⚠️ 请一定要记得检查生成的图片是否符合要求！！⚠️⚠️⚠️");
    });
}
