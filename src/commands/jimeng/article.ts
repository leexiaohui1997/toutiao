import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import { existsSync } from "node:fs";
import { runJimengImageTasks, type JimengImageTask } from "./image.js";

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
  content: ArticleBlock[];
  [key: string]: any;
}

export function registerJimengArticleCommand(jimeng: Command): void {
  jimeng
    .command("article")
    .description("给成稿路径，自动生成封面与插图")
    .requiredOption("-f, --file <path>", "article.json 路径（相对项目根）")
    .option("-w, --workspace <id>", "指定即梦会话 id（workspace）")
    .option("--headless", "无头模式", false)
    .action(async (opts: { file: string; workspace?: string; headless: boolean }) => {
      const articlePath = resolve(process.cwd(), opts.file);
      const article: ArticleJson = JSON.parse(await readFile(articlePath, "utf-8"));
      const articleDir = dirname(articlePath);
      // 图片就放在 article.json 同目录下，路径前缀相对项目根
      const dirPrefix = relative(process.cwd(), articleDir);

      // 找上两级目录的 overview.json
      const overviewPath = join(articleDir, "..", "overview.json");
      let overview: any = {};
      try {
        overview = JSON.parse(await readFile(overviewPath, "utf-8"));
      } catch {}

      // 合集封面是否存在：存在则本篇封面以它为参考图
      const collectionCoverExists = !!overview.cover && existsSync(resolve(process.cwd(), overview.cover));

      const tasks: JimengImageTask[] = [];

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
        tasks.push({
          prompt: block.prompt,
          output: imgOut,
          ...(collectionCoverExists ? { ref: overview.cover } : {}),
        });
        imgNo++;
      }

      if (tasks.length === 0) {
        console.log("✓ 所有图片都已生成，无需重复");
        process.exit(0);
      }

      console.log(`共 ${tasks.length} 张图待生成：`);

      // 调用即梦生图
      const { workspaceId } = await runJimengImageTasks(tasks, {
        headless: opts.headless,
        workspaceId: opts.workspace || overview.jimengWorkspaceId,
      });

      // 回写 article.json：cover / image block.content 写成路径（coverPrompt / block.prompt 保留）
      article.cover = coverOut;
      imgNo = 1;
      for (const block of article.content) {
        if (block.type !== "image") continue;
        block.content = join(dirPrefix, `插图${imgNo}.png`);
        imgNo++;
      }
      await writeFile(articlePath, JSON.stringify(article, null, 2) + "\n", "utf-8");

      // 回写 overview.json 的 jimengWorkspaceId
      if (workspaceId) {
        overview.jimengWorkspaceId = workspaceId;
        await writeFile(overviewPath, JSON.stringify(overview, null, 2) + "\n", "utf-8");
      }

      console.log(`✓ 已更新 article.json，会话 id: ${workspaceId || overview.jimengWorkspaceId || "(沿用)"}`);
      console.log("\n⚠️⚠️⚠️ 请一定要记得检查生成的图片是否符合要求！！⚠️⚠️⚠️");
    });
}
