import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";

interface Block {
  type: "text" | "title" | "image";
  content: string;
}

/** 统计文章 JSON 中正文（text + title）的字数 */
export function countWords(data: { content?: Block[] }): number {
  let total = 0;
  for (const b of data.content ?? []) {
    if (b.type === "text" || b.type === "title") {
      total += (b.content || "").replace(/\s/g, "").length;
    }
  }
  return total;
}

/**
 * `count-words` 命令：统计文章 JSON 中正文（text + title）的字数。
 */
export function registerCountWordsCommand(program: Command): void {
  program
    .command("count-words")
    .description("统计文章 JSON 中正文（text+title）的字数")
    .requiredOption("-f, --file <path>", "文章 JSON 路径，如 docs/书名/第N篇/article.json")
    .action(async (opts: { file: string }) => {
      const p = resolve(process.cwd(), opts.file);
      const raw = await readFile(p, "utf-8");
      const data = JSON.parse(raw);
      const blocks: Block[] = data.content ?? [];
      const total = countWords(data);
      const textCount = blocks.filter(b => b.type === "text").length;
      const titleCount = blocks.filter(b => b.type === "title").length;

      console.log(`文件: ${p}`);
      console.log(`段落数: ${textCount}（text）+ ${titleCount}（title）`);
      console.log(`正文字数: ${total}`);
    });
}
