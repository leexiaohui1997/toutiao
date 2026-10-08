import type { Command } from "commander";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { openLibraryDb } from "../db/index.js";
import { countWords } from "./count-words.js";

/** 推荐书籍相关子命令 */
export function registerRecommendationCommands(library: Command): void {
  // 添加推荐书籍
  library
    .command("add-recommendation")
    .description("添加推荐书籍")
    .requiredOption("-f, --file-id <id>", "关联文件 id")
    .requiredOption("-s, --score <score>", "推荐分数")
    .option("-r, --reason <reason>", "推荐理由", "")
    .option("-w, --work-dir <dir>", "工作目录（docs/书名）", "")
    .action((opts: { fileId: string; score: string; reason: string; workDir: string }) => {
      const db = openLibraryDb();
      const file = db.prepare("SELECT id, name FROM files WHERE id = ?").get(Number(opts.fileId)) as any;
      if (!file) {
        console.error(`未找到 file #${opts.fileId}`);
        process.exit(1);
      }
      try {
        db.prepare("INSERT INTO book_recommendations (file_id, name, score, reason, work_dir) VALUES (?, ?, ?, ?, ?)")
          .run(Number(opts.fileId), file.name, Number(opts.score), opts.reason, opts.workDir);
        console.log(`✓ 已添加推荐: ${file.name}（${opts.score}分）`);
      } catch (err: any) {
        if (err.message.includes("UNIQUE")) {
          console.log(`file #${opts.fileId} 已在推荐表中，跳过`);
        } else {
          throw err;
        }
      }
      db.close();
    });

  // 获取一本待处理的推荐书
  library
    .command("next-recommendation")
    .description("获取一本待处理的推荐书籍（status=pending）")
    .action(() => {
      const db = openLibraryDb();
      let row = db.prepare(`
        SELECT r.id, r.file_id, r.name, r.score, r.reason, r.work_dir, f.url, f.size
        FROM book_recommendations r
        JOIN files f ON f.id = r.file_id
        WHERE r.status = 'processing'
        ORDER BY r.score DESC, r.id
        LIMIT 1
      `).get() as any;

      if (!row) {
        row = db.prepare(`
          SELECT r.id, r.file_id, r.name, r.score, r.reason, r.work_dir, f.url, f.size
          FROM book_recommendations r
          JOIN files f ON f.id = r.file_id
          WHERE r.status = 'pending'
          ORDER BY r.score DESC, r.id
          LIMIT 1
        `).get() as any;
      }

      if (!row) {
        console.log("✓ 推荐表中没有待处理的书了");
        db.close();
        process.exit(0);
      }

      if (row.status === 'pending') db.prepare("UPDATE book_recommendations SET status = 'processing' WHERE id = ?").run(row.id);
      console.log(JSON.stringify(row, null, 2));
      db.close();
    });

  // 设置推荐书工作目录
  library
    .command("set-workdir")
    .description("设置推荐书的工作目录")
    .requiredOption("-i, --id <id>", "推荐书 id")
    .requiredOption("-d, --dir <dir>", "工作目录，如 docs/书名")
    .action((opts: { id: string; dir: string }) => {
      const db = openLibraryDb();
      const info = db.prepare("UPDATE book_recommendations SET work_dir = ? WHERE id = ?").run(opts.dir, Number(opts.id));
      if (info.changes > 0) {
        console.log(`✓ 推荐书 #${opts.id} 工作目录 → ${opts.dir}`);
      } else {
        console.log(`未找到推荐书 #${opts.id}`);
      }
      db.close();
    });

  // 获取推荐书工作区属性
  library
    .command("rec-workdir")
    .description("获取推荐书的工作区属性")
    .requiredOption("-i, --id <id>", "推荐书 id")
    .action((opts: { id: string }) => {
      const db = openLibraryDb();
      const rec = db.prepare("SELECT * FROM book_recommendations WHERE id = ?").get(Number(opts.id)) as any;
      if (!rec || !rec.work_dir) {
        console.error("未找到推荐书或未设置 work_dir");
        process.exit(1);
      }
      console.log(JSON.stringify(getWorkdirStatus(rec), null, 2));
      db.close();
    });
}

/** 获取推荐书工作区状态（可复用） */
export function getWorkdirStatus(rec: { id: number; name: string; work_dir: string }): any {
  const dir = resolve(process.cwd(), rec.work_dir);
  const overviewPath = join(dir, "overview.json");
  const result: any = { id: rec.id, name: rec.name, workDir: rec.work_dir };

  if (existsSync(overviewPath)) {
    const ov = JSON.parse(readFileSync(overviewPath, "utf-8"));
    result.collectionName = ov.collectionName || "";
    result.collectionCover = ov.cover ? existsSync(resolve(process.cwd(), ov.cover)) : false;
    result.xhsCollectionCover = ov.xhsCover ? existsSync(resolve(process.cwd(), ov.xhsCover)) : false;
    result.articleCount = ov.articlePlan?.length || 0;
    result.collectionCreated = ov.created === true;
    result.xhsCollectionCreated = ov.xhsCreated === true;
    result.bilibiliCollectionCreated = !!ov.bilibiliCollectionId;
    result.tagsCollected = ov.tagsCollected === true;
  }

  const articles: Record<number, any> = {};
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      const m = entry.match(/^第(\d+)篇$/);
      if (!m) continue;
      const no = Number(m[1]);
      const articleDir = join(dir, entry);
      const articlePath = join(articleDir, "article.json");
      const hasArticle = existsSync(articlePath);
      const hasImages = readdirSync(articleDir).some(f => f.startsWith("插图") || f === "cover.png");
      let published = false; let xhsPublished = false; let bilibiliPublished = false; let title = "";
      let wordCount = 0;
      if (hasArticle) {
        const art = JSON.parse(readFileSync(articlePath, "utf-8"));
        published = art.publish === true;
        xhsPublished = art.xhsPublish === true;
        bilibiliPublished = art.bilibiliPublish === true;
        title = art.title || "";
        wordCount = countWords(art);
      }
      articles[no] = { title, hasArticle, hasImages, published, xhsPublished, bilibiliPublished, wordCount };
    }
  }
  result.articles = articles;
  result.publishedCount = Object.values(articles).filter((a: any) => a.published).length;
  result.xhsPublishedCount = Object.values(articles).filter((a: any) => a.xhsPublished).length;
  result.bilibiliPublishedCount = Object.values(articles).filter((a: any) => a.bilibiliPublished).length;
  return result;
}
