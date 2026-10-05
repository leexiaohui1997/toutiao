import type { Command } from "commander";
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openLibraryDb } from "../db/index.js";
import { execSync } from "node:child_process";
import { getWorkdirStatus } from "./recommendations.js";

/** 定时发布相关子命令 */
export function registerScheduledCommands(library: Command): void {
  // 为某本书的所有未发布文章创建定时任务
  library
    .command("schedule-book")
    .description("为某本书的所有未发布文章创建定时任务（每天5篇，每篇隔1小时）")
    .requiredOption("-d, --dir <dir>", "工作目录，如 docs/书名")
    .option("--per-day <n>", "每天几篇，默认 5", "5")
    .option("--hour-gap <h>", "每篇间隔小时，默认 1", "1")
    .action((opts: { dir: string; perDay: string; hourGap: string }) => {
      const db = openLibraryDb();
      const baseDir = resolve(process.cwd(), opts.dir);
      const perDay = Number(opts.perDay);
      const gap = Number(opts.hourGap);

      // 收集所有未发布的 article.json
      const articles: string[] = [];
      if (existsSync(baseDir)) {
        for (const entry of readdirSync(baseDir)) {
          if (!/^第\d+篇$/.test(entry)) continue;
          const articlePath = join(baseDir, entry, "article.json");
          if (existsSync(articlePath)) {
            const art = JSON.parse(readFileSync(articlePath, "utf-8"));
            if (!art.publish) articles.push(articlePath);
          }
        }
      }
      articles.sort();
      // 过滤掉已在定时任务里的
      const existing = db.prepare("SELECT article_path FROM scheduled_posts").all() as any[];
      const set = new Set(existing.map((r: any) => r.article_path));
      const newArticles = articles.filter(a => !set.has(a));
      console.log(`共 ${articles.length} 篇未发布，其中 ${newArticles.length} 篇尚未排期`);

      // 从现有最大 publish_at 接下去，或从明天早9点开始
      const maxRow = db.prepare("SELECT MAX(publish_at) as m FROM scheduled_posts WHERE status='pending'").get() as any;
      let startTime = new Date();
      startTime.setHours(9, 0, 0, 0);
      startTime.setDate(startTime.getDate() + 1); // 明天开始
      if (maxRow?.m) {
        const existing = new Date(maxRow.m);
        if (existing > startTime) startTime = existing;
      }

      const insert = db.prepare("INSERT OR IGNORE INTO scheduled_posts (article_path, publish_at) VALUES (?, ?)");
      let count = 0;
      let cursor = new Date(startTime);
      for (let i = 0; i < newArticles.length; i++) {
        if (i > 0 && i % perDay === 0) {
          cursor.setHours(9, 0, 0, 0);
          cursor.setDate(cursor.getDate() + 1);
        }
        const pad = (n: number) => String(n).padStart(2, "0");
        const publishAt = `${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}-${pad(cursor.getDate())} ${pad(cursor.getHours())}:${pad(cursor.getMinutes())}:${pad(cursor.getSeconds())}`;
        insert.run(newArticles[i], publishAt);
        count++;
        console.log(`  ${publishAt} → ${newArticles[i]}`);
        cursor.setHours(cursor.getHours() + gap);
      }
      console.log(`✓ 已创建 ${count} 个定时任务`);
      db.close();
    });

  // 列出定时任务
  library
    .command("list-scheduled")
    .description("列出定时任务")
    .action(() => {
      const db = openLibraryDb();
      const rows = db.prepare("SELECT * FROM scheduled_posts ORDER BY publish_at").all() as any[];
      for (const r of rows) {
        console.log(`  ${r.publish_at} [${r.status}] ${r.article_path}`);
      }
      db.close();
    });

  // 发布到点的文章
  library
    .command("publish")
    .description("发布到点的定时文章")
    .option("-n, --count <n>", "本次发布几篇；不传则只发到点的")    .option("--order <order>", "补取顺序：near（最近，默认）/ far（最远）", "near")
    .action((opts: { count: string }) => {
      const db = openLibraryDb();
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      // 1. 先取到点的
      let tasks = db.prepare("SELECT * FROM scheduled_posts WHERE status='pending' AND publish_at <= ? ORDER BY publish_at").all(now) as any[];
      // 2. 显式指定 -n 才补
      if (opts.count) {
        const want = Number(opts.count);
        if (tasks.length < want) {
          const more = db.prepare("SELECT * FROM scheduled_posts WHERE status='pending' AND publish_at > ? ORDER BY publish_at LIMIT ?").all(now, want - tasks.length) as any[];
          tasks = [...tasks, ...more];
        }
        tasks = tasks.slice(0, want);
      }

      console.log(`本次将发布 ${tasks.length} 篇`);
      const markDone = db.prepare("UPDATE scheduled_posts SET status='done' WHERE id=?");
      for (const t of tasks) {
        console.log(`\n→ 发布: ${t.article_path}`);
        try {
          execSync(`pnpm dev edit --file "${t.article_path}" --publish --headless`, { stdio: "inherit" });
          markDone.run(t.id);
          // 写回 article.json 的 publish 字段
          const artPath = t.article_path;
          const art = JSON.parse(readFileSync(artPath, "utf-8"));
          art.publish = true;
          writeFileSync(artPath, JSON.stringify(art, null, 2));
          console.log(`✓ 完成`);
        } catch (e) {
          console.error(`✗ 失败: ${(e as Error).message}`);
        }
      }

      // 检查推荐书是否全部发布完
      const recs = db.prepare("SELECT * FROM book_recommendations WHERE status='processing'").all() as any[];
      for (const rec of recs) {
        const status = getWorkdirStatus(rec);
        if (status.articleCount > 0 && status.publishedCount >= status.articleCount) {
          db.prepare("UPDATE book_recommendations SET status='done' WHERE id=?").run(rec.id);
          console.log(`✓ 推荐书 #${rec.id} 全部发布完，标记 done`);
        }
      }
      db.close();
    });
}
