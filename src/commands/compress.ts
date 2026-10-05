import type { Command } from "commander";
import sharp from "sharp";
import { resolve, extname, basename } from "node:path";
import { readdir, stat, unlink } from "node:fs/promises";
import { openLibraryDb } from "../db/index.js";

/** 压缩单张图片，覆盖原文件，保持原后缀 */
export async function compressImage(imgPath: string): Promise<void> {
  const abs = resolve(process.cwd(), imgPath);
  const ext = extname(abs).toLowerCase();

  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
    console.log(`  跳过（非图片）: ${imgPath}`);
    return;
  }

  const before = (await stat(abs)).size;
  const tmpPath = abs + ".tmp";

  let pipeline = sharp(abs);
  if (ext === ".png") {
    pipeline = pipeline.png({ quality: 80, palette: true, compressionLevel: 9 });
  } else if (ext === ".webp") {
    pipeline = pipeline.webp({ quality: 80 });
  } else {
    pipeline = pipeline.jpeg({ quality: 80, mozjpeg: true });
  }
  await pipeline.toFile(tmpPath);

  // 覆盖原文件
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, abs);

  const after = (await stat(abs)).size;
  const ratio = ((1 - after / before) * 100).toFixed(1);
  console.log(`✓ ${basename(imgPath)}: ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB (-${ratio}%)`);
}

/** 递归扫描目录下所有图片并压缩 */
async function compressDir(dir: string): Promise<void> {
  const abs = resolve(process.cwd(), dir);
  const entries = await readdir(abs, { withFileTypes: true });

  for (const entry of entries) {
    const full = resolve(abs, entry.name);
    if (entry.isDirectory()) {
      await compressDir(full);
    } else if (/\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
      await compressImage(full);
    }
  }
}

export function registerCompressCommand(program: Command): void {
  const compress = program
    .command("compress")
    .description("图片压缩");

  // 单张图
  compress
    .command("image <path>")
    .description("压缩单张图片（覆盖原文件）")
    .action(async (path: string) => {
      await compressImage(path);
    });

  // 目录批量
  compress
    .command("dir <path>")
    .description("递归压缩目录下所有图片")
    .action(async (path: string) => {
      console.log(`压缩目录: ${path}`);
      await compressDir(path);
      console.log("✓ 完成");
    });

  // 推荐书籍工作目录批量压缩
  compress
    .command("rec-workdir <id>")
    .description("按推荐书籍 id 找工作目录，批量压缩所有图片")
    .action(async (id: string) => {
      const db = openLibraryDb();
      const row = db.prepare("SELECT work_dir FROM book_recommendations WHERE id = ?").get(Number(id)) as { work_dir?: string };
      if (!row?.work_dir) {
        console.error("✗ 该推荐书籍没有工作目录");
        process.exit(1);
      }
      console.log(`工作目录: ${row.work_dir}`);
      await compressDir(row.work_dir);
      console.log("✓ 完成");
    });
}
