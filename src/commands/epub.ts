import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { Command } from "commander";

/**
 * epub 阅读工具
 * 不落盘、不依赖任何外部解压命令：直接用 Node 解析 zip 中央目录，
 * 把条目解压到内存后转成纯文本。跨平台（Windows / macOS / Linux）通用。
 */

interface ZipEntry {
  name: string;
  method: number;
  offset: number;
  compressedSize: number;
}

/** 解析 zip 中央目录，返回全部条目（支持 zip64 之外的常规 epub） */
function readZipCentralDirectory(buf: Buffer): ZipEntry[] {
  // End Of Central Directory signature: 0x06054b50 (little endian: 50 4b 05 06)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 zip/epub 文件（未找到 EOCD）");

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    // Central directory file header signature: 0x02014b50
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf-8", ptr + 46, ptr + 46 + nameLen);
    entries.push({ name, method, offset: localOffset, compressedSize });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 按条目 local header 定位数据区并解压（0=store, 8=deflate） */
function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  // Local file header signature: 0x04034b50
  if (buf.readUInt32LE(entry.offset) !== 0x04034b50) {
    throw new Error(`条目 local header 损坏: ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(entry.offset + 26);
  const extraLen = buf.readUInt16LE(entry.offset + 28);
  const dataStart = entry.offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`不支持的压缩方式 ${entry.method}: ${entry.name}`);
}

/** 打开 epub（zip），返回 html 条目名 → 内容 的懒加载器 */
function openEpub(epubPath: string) {
  const buf = readFileSync(epubPath);
  const entries = readZipCentralDirectory(buf);
  const htmlEntries = entries
    .filter((e) => /\.(x?html)$/i.test(e.name) && !e.name.endsWith("/"))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const cache = new Map<string, string>();
  return {
    names: htmlEntries.map((e) => e.name),
    read(name: string): string {
      const hit = cache.get(name);
      if (hit !== undefined) return hit;
      const entry = htmlEntries.find((e) => e.name === name);
      if (!entry) throw new Error(`epub 中不存在条目: ${name}`);
      const text = readZipEntry(buf, entry).toString("utf-8");
      cache.set(name, text);
      return text;
    },
  };
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
  // 统一取卷号：
  // 1) text/part0001_split_039.html → 卷号 1
  // 2) text/part0049.html            → 卷号 49
  const m = name.match(/part(\d+)/i);
  return m ? parseInt(m[1], 10) : -1;
}

/** 生成可读的 part 标签：拆分文件显示 split 序号，普通卷显示卷号 */
function fileLabel(name: string): string {
  const m = name.match(/part(\d+)(?:_split_(\d+))?/i);
  if (m) {
    const vol = m[1].padStart(4, "0");
    return m[2] ? `part${vol}/split${m[2].padStart(3, "0")}` : `part${vol}`;
  }
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
    .description("epub 阅读工具（不落盘，纯 Node 解析 zip，跨平台）");

  epub
    .command("ls <file>")
    .description("列出所有正文 HTML 条目：编号 | 标题 | 字数")
    .action((file: string) => {
      const p = resolve(process.cwd(), file);
      const book = openEpub(p);
      for (const f of book.names) {
        const html = book.read(f);
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
      const book = openEpub(p);
      let hit = 0;
      for (const f of book.names) {
        const text = htmlToText(book.read(f));
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
      const book = openEpub(p);
      const [aRaw, bRaw] = (opts.parts || "").split("-");
      const start = parseInt(aRaw || "0", 10);
      const end = bRaw === undefined || Number.isNaN(parseInt(bRaw, 10)) ? start : parseInt(bRaw, 10);
      const picked = book.names.filter((f) => {
        const n = partNumber(f);
        return n >= start && n <= end;
      });
      let out = "";
      for (const f of picked) {
        out += `\n\n===== ${f} =====\n\n` + htmlToText(book.read(f));
      }
      if (opts.head) out = out.slice(0, Number(opts.head));
      process.stdout.write(out + "\n");
    });
}
