import type { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openLibraryDb } from "../db/index.js";

/** 延迟发布小时数（头条发完后隔多久再发小红书 / B 站） */
const DELAY_HOURS = 72;

/**
 * 统一发布文章：
 *  1. 立即发头条（edit --publish）；
 *  2. 不立即发小红书/B 站，在 scheduled_posts 里各插一条 channel='xhs' / 'bilibili'、
 *     publish_at = now + 72h 的定时任务，由 library publish worker 到点执行。
 */
export function registerPublishAllCommand(program: Command): void {
  program
    .command("publish-all")
    .description("立即发头条，72 小时后自动发小红书 + B 站")
    .requiredOption("-f, --file <path>", "article.json 路径")
    .option("--headless", "无头模式（透传给子命令）", false)
    .action(async (opts: { file: string; headless: boolean }) => {
      const articlePath = resolve(process.cwd(), opts.file);
      console.log(`[publish-all] article=${articlePath}`);

      if (!existsSync(articlePath)) {
        console.error(`✗ 文件不存在: ${articlePath}`);
        process.exit(1);
      }

      // 1. 头条立即发
      console.log("\n===== [1/3] 立即发布到头条 =====");
      try {
        execSync(
          `pnpm dev edit --file "${articlePath}" --publish${opts.headless ? " --headless" : ""}`,
          { stdio: "inherit" }
        );
        const art = JSON.parse(readFileSync(articlePath, "utf-8"));
        if (art.publish !== true) {
          art.publish = true;
          writeFileSync(articlePath, JSON.stringify(art, null, 2));
        }
      } catch (e) {
        console.error("✗ 头条发布失败，终止");
        process.exit(1);
      }

      // 2. 小红书 + B 站：不立即发，各插 72h 后的定时任务
      const fireAt = new Date(Date.now() + DELAY_HOURS * 3600 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fireAtStr = `${fireAt.getFullYear()}-${pad(fireAt.getMonth()+1)}-${pad(fireAt.getDate())} ${pad(fireAt.getHours())}:${pad(fireAt.getMinutes())}:${pad(fireAt.getSeconds())}`;

      const db = openLibraryDb();
      try {
        const insert = db.prepare(
          "INSERT OR IGNORE INTO scheduled_posts (article_path, publish_at, channel) VALUES (?, ?, ?)"
        );
        insert.run(articlePath, fireAtStr, "xhs");
        insert.run(articlePath, fireAtStr, "bilibili");
        console.log(`\n===== [2/3] 小红书定时任务已排期 =====`);
        console.log(`  计划时间: ${fireAtStr}（头条发布后 ${DELAY_HOURS} 小时）`);
        console.log(`\n===== [3/3] B 站定时任务已排期 =====`);
        console.log(`  计划时间: ${fireAtStr}（头条发布后 ${DELAY_HOURS} 小时）`);
        console.log(`  到点由 \`pnpm dev library publish\` worker 自动执行对应 publish 命令。`);
      } finally {
        db.close();
      }

      console.log("\n✓ 统一发布流程结束");
    });
}
