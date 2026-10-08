import type { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openLibraryDb } from "../db/index.js";

/** 小红书延迟发布小时数（头条发完后隔多久再发小红书） */
const XHS_DELAY_HOURS = 72;

/**
 * 统一发布文章：
 *  1. 立即发头条（edit --publish）；
 *  2. 不立即发小红书，而是在 scheduled_posts 里插一条 channel='xhs'、
 *     publish_at = now + 72h 的定时任务，由 library publish worker 到点执行。
 */
export function registerPublishAllCommand(program: Command): void {
  program
    .command("publish-all")
    .description("立即发头条 + 72 小时后自动发小红书")
    .requiredOption("-f, --file <path>", "article.json 路径")
    .option("--headless", "无头模式（透传给头条子命令）", false)
    .action(async (opts: { file: string; headless: boolean }) => {
      const articlePath = resolve(process.cwd(), opts.file);
      console.log(`[publish-all] article=${articlePath}`);

      if (!existsSync(articlePath)) {
        console.error(`✗ 文件不存在: ${articlePath}`);
        process.exit(1);
      }

      // 1. 头条
      console.log("\n===== [1/2] 立即发布到头条 =====");
      try {
        execSync(
          `pnpm dev edit --file "${articlePath}" --publish${opts.headless ? " --headless" : ""}`,
          { stdio: "inherit" }
        );
        // edit --publish 不一定写回 publish 字段，这里兜底写一次
        const art = JSON.parse(readFileSync(articlePath, "utf-8"));
        if (art.publish !== true) {
          art.publish = true;
          writeFileSync(articlePath, JSON.stringify(art, null, 2));
        }
      } catch (e) {
        console.error("✗ 头条发布失败，终止");
        process.exit(1);
      }

      // 2. 小红书：不立即发，插 72h 后的定时任务
      const fireAt = new Date(Date.now() + XHS_DELAY_HOURS * 3600 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fireAtStr = `${fireAt.getFullYear()}-${pad(fireAt.getMonth()+1)}-${pad(fireAt.getDate())} ${pad(fireAt.getHours())}:${pad(fireAt.getMinutes())}:${pad(fireAt.getSeconds())}`;

      const db = openLibraryDb();
      try {
        db.prepare(
          "INSERT OR IGNORE INTO scheduled_posts (article_path, publish_at, channel) VALUES (?, ?, 'xhs')"
        ).run(articlePath, fireAtStr);
        console.log(`\n===== [2/2] 小红书定时任务已排期 =====`);
        console.log(`  文章: ${articlePath}`);
        console.log(`  计划小红书发布时间: ${fireAtStr}（头条发布后 ${XHS_DELAY_HOURS} 小时）`);
        console.log(`  到点由 \`pnpm dev library publish\` worker 自动执行 xhs publish。`);
      } finally {
        db.close();
      }

      console.log("\n✓ 统一发布流程结束");
    });
}
