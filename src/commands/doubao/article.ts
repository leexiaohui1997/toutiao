import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { runImageTasks } from "./image.js";
import type { GenTask } from "./gen.js";

interface ArticleContent {
  type: "title" | "text" | "image";
  content: string;
}

interface ArticleJson {
  no: number;
  bookTitle: string;
  cover: string;
  content: ArticleContent[];
  [key: string]: any;
}

export function registerDoubaoArticleCommand(doubao: Command): void {
  doubao
    .command("article")
    .description("给成稿路径，自动生成封面与插图")
    .requiredOption("-f, --file <path>", "article.json 路径（相对项目根）")
    .option("-c, --chat-id <id>", "指定会话 id")
    .option("--headless", "无头模式", false)
    .action(async (opts: { file: string; chatId?: string; headless: boolean }) => {
      const articlePath = resolve(process.cwd(), opts.file);
      const article: ArticleJson = JSON.parse(await readFile(articlePath, "utf-8"));
      const articleDir = dirname(articlePath);

      // 找 overview.json（上两级目录）
      const overviewPath = join(articleDir, "..", "overview.json");
      let overview: any = {};
      try {
        overview = JSON.parse(await readFile(overviewPath, "utf-8"));
      } catch {}

      // 合集封面是否存在
      const collectionCoverExists = !!overview.cover && existsSync(resolve(process.cwd(), overview.cover));

      // 组装生图任务
      const tasks: GenTask[] = [];

      // 封面
      if (!article.cover.startsWith("docs/")) {
        const coverOut = `docs/${article.bookTitle}/第${article.no}篇/cover.png`;
        tasks.push({
          prompt: article.cover,
          output: coverOut,
          ...(collectionCoverExists ? { ref: overview.cover } : {}),
        });
      }

      // 插图
      let imgNo = 1;
      for (const block of article.content) {
        if (block.type === "image" && !block.content.startsWith("docs/")) {
          const imgOut = `docs/${article.bookTitle}/第${article.no}篇/插图${imgNo}.png`;
          tasks.push({ prompt: block.content, output: imgOut });
          imgNo++;
        }
      }

      if (tasks.length === 0) {
        console.log("✓ 所有图片都已生成，无需重复");
        process.exit(0);
      }

      console.log(`共 ${tasks.length} 张图待生成：`);
      tasks.forEach((t, i) => {
        console.log(`  [${i + 1}] ${t.output}`);
        console.log(`      提示词: ${t.prompt}`);
      });

      // 调用生图
      const { chatId } = await runImageTasks({
        prompt: JSON.stringify(tasks),
        chatId: opts.chatId || overview.doubaoChatId,
        headless: opts.headless,
      });

      // 更新 article.json
      imgNo = 1;
      if (!article.cover.startsWith("docs/")) {
        article.cover = `docs/${article.bookTitle}/第${article.no}篇/cover.png`;
      }
      for (const block of article.content) {
        if (block.type === "image" && !block.content.startsWith("docs/")) {
          block.content = `docs/${article.bookTitle}/第${article.no}篇/插图${imgNo}.png`;
          imgNo++;
        }
      }
      await writeFile(articlePath, JSON.stringify(article, null, 2) + "\n", "utf-8");

      // 更新 overview.json 的 doubaoChatId
      if (chatId && overviewPath) {
        overview.doubaoChatId = chatId;
        await writeFile(overviewPath, JSON.stringify(overview, null, 2) + "\n", "utf-8");
      }

      console.log(`✓ 已更新 article.json，会话 id: ${chatId || "(沿用)"}`);
    });
}
