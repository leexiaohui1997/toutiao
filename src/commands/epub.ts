import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Command } from "commander";

/**
 * epub 阅读工具
 * 不落盘：通过 `unzip -p` 把 zip 条目直接输出到 stdout，在内存里转成纯文本。
 * 不写任何临时文件。
 */

function unzipList(epubPath: string): string[] {
  const out = execFileSync("unzip", ["-l", epubPath], { encoding: "utf-8" });
  const files: string[] = [];
  for (const line of out.split("\n")) {
    // 形如：   1234  10-07-2015 12:11   text/part0049.html
    const m = line.match(/^\s*\d+\s+\d+-\d+-\d+\s+\d+:\d+\s+(\S.*\S)\s*$/);
    if (m) {
      const name = m[1].trim();
      if (/\.(x?html)$/i.test(name)) files.push(name);
    }
  }
  return files.sort();
}

function unzipRead(epubPath: string, entry: string): string {
  return execFileSync("unzip", ["-p", epubPath, entry], {
    encoding: "utf-8",
    maxBuffer: 100 * 1024 * 1024,
  });
}

function htmlToText(html: string): string {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "");
  t = t.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function partNumber(name: string): number {
  // 兼容两种命名：
  // 1) text/part0000_split_039.html → 取拆分序号 39（同一卷内多个拆分文件，必须按 split 定位）
  // 2) text/part0049.html            → 取卷号 49
  const splitM = name.match(/split_(\d+)/i);
  if (splitM) return parseInt(splitM[1], 10);
  const m = name.match(/part(\d+)/i);
  return m ? parseInt(m[1], 10) : -1;
}

/** 生成可读的 part 标签：拆分文件显示 split 序号，普通卷显示卷号 */
function fileLabel(name: string): string {
  const splitM = name.match(/split_(\d+)/i);
  if (splitM) return `part0000/split${splitM[1].padStart(3, "0")}`;
  const m = name.match(/part(\d+)/i);
  if (m) return `part${m[1].padStart(4, "0")}`;
  return name;
}

function firstHeading(html: string): string {
  const m = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (!m) return "(无标题)";
  return m[1].replace(/<[^>]+>/g, "").trim().slice(0, 60);
}

export function registerEpubCommand(program: Command): void {
  const epub = program
    .command("epub")
    .description("epub 阅读工具（不落盘，流式读 zip 条目）");

  epub
    .command("ls <file>")
    .description("列出所有正文 HTML 条目：编号 | 标题 | 字数")
    .action((file: string) => {
      const p = resolve(process.cwd(), file);
      const files = unzipList(p);
      for (const f of files) {
        const n = partNumber(f);
        const html = unzipRead(p, f);
        const title = firstHeading(html);
        const text = htmlToText(html);
        console.log(`${fileLabel(f)} | ${title} | ${text.length}字`);
      }
    });

  epub
    .command("grep <file> <keyword>")
    .description("全文搜索关键词，输出命中的 part 与上下文")
    .action((file: string, keyword: string) => {
      const p = resolve(process.cwd(), file);
      const files = unzipList(p);
      let hit = 0;
      for (const f of files) {
        const text = htmlToText(unzipRead(p, f));
        const idx = text.indexOf(keyword);
        if (idx >= 0) {
          const ctx = text
            .slice(Math.max(0, idx - 40), idx + keyword.length + 40)
            .replace(/\s+/g, " ");
          console.log(`${fileLabel(f)}: ...${ctx}...`);
          hit++;
        }
      }
      if (hit === 0) console.log(`(未找到 "${keyword}")`);
    });

  epub
    .command("read <file>")
    .description("读取指定 part 范围的纯文本母稿")
    .option("--parts <range>", "part 范围，如 180-195")
    .option("--head <n>", "只输出前 n 个字符")
    .action((file: string, opts: { parts?: string; head?: string }) => {
      const p = resolve(process.cwd(), file);
      const files = unzipList(p);
      const [aRaw, bRaw] = (opts.parts || "").split("-");
      const start = parseInt(aRaw || "0", 10);
      const end = bRaw === undefined || Number.isNaN(parseInt(bRaw, 10)) ? start : parseInt(bRaw, 10);
      const picked = files.filter((f) => {
        const n = partNumber(f);
        return n >= start && n <= end;
      });
      let out = "";
      for (const f of picked) {
        out += `\n\n===== ${f} =====\n\n` + htmlToText(unzipRead(p, f));
      }
      if (opts.head) out = out.slice(0, Number(opts.head));
      process.stdout.write(out + "\n");
    });
}
