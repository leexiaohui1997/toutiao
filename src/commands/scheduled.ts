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
    .description("为某本推荐书的所有未发布文章创建定时任务（每天5篇，每篇隔1小时）")
    .requiredOption("-i, --id <id>", "推荐书籍 id")
    .option("--per-day <n>", "每天几篇，默认 5（固定时段：8/12/18/20/22点）", "5")
    .action((opts: { id: string; perDay: string }) => {
      const db = openLibraryDb();
      const rec = db.prepare("SELECT work_dir FROM book_recommendations WHERE id = ?").get(Number(opts.id)) as { work_dir?: string };
      if (!rec?.work_dir) {
        console.error("✗ 该推荐书籍没有工作目录");
        process.exit(1);
      }
      const baseDir = resolve(process.cwd(), rec.work_dir);
      console.log(`工作目录: ${rec.work_dir}`);
      const perDay = Number(opts.perDay);
      // 每天固定发文时段（按 perDay 取前 N 个）
      const timeSlots = [8, 12, 18, 20, 22].slice(0, perDay);

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
      articles.sort((a, b) => {
        const na = Number(a.match(/第(\d+)篇/)?.[1] || 0);
        const nb = Number(b.match(/第(\d+)篇/)?.[1] || 0);
        return na - nb;
      });
      // 过滤掉已在定时任务里的
      const existing = db.prepare("SELECT article_path FROM scheduled_posts").all() as any[];
      const set = new Set(existing.map((r: any) => r.article_path));
      const newArticles = articles.filter(a => !set.has(a));
      console.log(`共 ${articles.length} 篇未发布，其中 ${newArticles.length} 篇尚未排期`);

      // 查现有最大 publish_at，算当天已排几篇
      const maxRow = db.prepare("SELECT MAX(publish_at) as m FROM scheduled_posts WHERE status='pending'").get() as any;
      let cursor = new Date();
      cursor.setHours(9, 0, 0, 0);
      cursor.setDate(cursor.getDate() + 1); // 默认明天 9 点

      if (maxRow?.m) {
        const last = new Date(maxRow.m);
        const dayStr = last.toISOString().slice(0, 10);
        const dayCountRow = db.prepare(
          "SELECT COUNT(*) as c FROM scheduled_posts WHERE status='pending' AND DATE(publish_at)=?"
        ).get(dayStr) as any;
        const dayCount = dayCountRow?.c || 0;
        console.log(`最近一篇: ${maxRow.m}，当天已排 ${dayCount} 篇`);

        if (dayCount < perDay) {
          // 当天没排满，从下一个时段开始
          const lastHour = last.getHours();
          const nextSlot = timeSlots.find(h => h > lastHour);
          if (nextSlot !== undefined) {
            cursor = new Date(last);
            cursor.setHours(nextSlot, 0, 0, 0);
          } else {
            // 当天时段用完了，次日第一个时段
            cursor = new Date(last);
            cursor.setHours(timeSlots[0], 0, 0, 0);
            cursor.setDate(cursor.getDate() + 1);
          }
        } else {
          // 当天排满了，从次日第一个时段开始
          cursor = new Date(last);
          cursor.setHours(timeSlots[0], 0, 0, 0);
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      const insert = db.prepare("INSERT OR IGNORE INTO scheduled_posts (article_path, publish_at) VALUES (?, ?)");
      let count = 0;
      for (let i = 0; i < newArticles.length; i++) {
        const pad = (n: number) => String(n).padStart(2, "0");
        const publishAt = `${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}-${pad(cursor.getDate())} ${pad(cursor.getHours())}:${pad(cursor.getMinutes())}:${pad(cursor.getSeconds())}`;
        insert.run(newArticles[i], publishAt);
        count++;
        console.log(`  ${publishAt} → ${newArticles[i]}`);

        // 找下一个时段：当前时段之后还有就用，没有就次日第一个时段
        const curHour = cursor.getHours();
        const nextSlot = timeSlots.find(h => h > curHour);
        if (nextSlot !== undefined) {
          cursor.setHours(nextSlot, 0, 0, 0);
        } else {
          cursor.setHours(timeSlots[0], 0, 0, 0);
          cursor.setDate(cursor.getDate() + 1);
        }
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

      // 强制发布所有待发布（调试用，固定 false）
      const FORCE_PUBLISH_ALL = true;

      // 1. 先取到点的
      let tasks: any[];
      if (FORCE_PUBLISH_ALL) {
        tasks = db.prepare("SELECT * FROM scheduled_posts WHERE status='pending' ORDER BY publish_at").all() as any[];
      } else {
        tasks = db.prepare("SELECT * FROM scheduled_posts WHERE status='pending' AND publish_at <= ? ORDER BY publish_at").all(now) as any[];
      }
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
      const markDone = db.prepare("UPDATE scheduled_posts SET status='done', publish_at=? WHERE id=?");
      for (const t of tasks) {
        const channel: string = t.channel || "toutiao";
        console.log(`\n→ [${channel}] 发布: ${t.article_path}`);
        try {
          if (channel === "xhs") {
            // 小红书任务：直接跑 xhs publish（脚本自己会写回 xhsPublish=true，已发过则跳过）
            execSync(`pnpm dev xhs publish -f "${t.article_path}" --headless`, { stdio: "inherit" });
            markDone.run(now, t.id);
            console.log(`✓ 小红书完成`);
          } else {
            // 头条任务
            execSync(`pnpm dev edit --file "${t.article_path}" --publish --headless`, { stdio: "inherit" });
            markDone.run(now, t.id);
            // 写回 article.json 的 publish 字段
            const artPath = t.article_path;
            const art = JSON.parse(readFileSync(artPath, "utf-8"));
            art.publish = true;
            writeFileSync(artPath, JSON.stringify(art, null, 2));
            console.log(`✓ 头条完成`);
          }
        } catch (e) {
          console.error(`✗ [${channel}] 失败: ${(e as Error).message}`);
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
