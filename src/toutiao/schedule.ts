import { openLibraryDb } from "../db/index.js";

/** 头条每日发布上限 */
const DAILY_CAP = 50;

/** 每天凌晨 4 点排期（补位时段） */
const PAD_HOUR = 4;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 头条今日已达 50 篇上限时，把当前这篇文章自动排到下一个有空位的日期凌晨 4 点。
 *
 * 规则：
 *  1. 从明天开始往后逐天扫描；
 *  2. 每天查 scheduled_posts 里 channel='toutiao' 且 status='pending' 的任务数；
 *  3. 第一个 <50 的日期，插一条 publish_at = 那天 04:00:00, channel='toutiao'；
 *  4. 返回实际排到的时间字符串。
 */
export function rescheduleToNextAvailableDay(articlePath: string): string {
  const db = openLibraryDb();
  try {
    // 从明天 00:00 开始，最多往后扫 30 天
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    let chosenDate: Date | null = null;
    for (let i = 0; i < 30; i++) {
      const day = new Date(tomorrow);
      day.setDate(tomorrow.getDate() + i);
      const dayStart = `${fmtDate(day)} 00:00:00`;
      const dayEnd = `${fmtDate(day)} 23:59:59`;
      const row = db
        .prepare(
          "SELECT COUNT(*) AS c FROM scheduled_posts WHERE channel='toutiao' AND status='pending' AND publish_at >= ? AND publish_at <= ?"
        )
        .get(dayStart, dayEnd) as { c: number };
      if (row.c < DAILY_CAP) {
        chosenDate = day;
        break;
      }
    }

    if (!chosenDate) {
      throw new Error("往后 30 天都排满 50 篇，无法自动补位");
    }

    chosenDate.setHours(PAD_HOUR, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    const fireAt = `${chosenDate.getFullYear()}-${pad(chosenDate.getMonth() + 1)}-${pad(chosenDate.getDate())} ${pad(chosenDate.getHours())}:${pad(chosenDate.getMinutes())}:${pad(chosenDate.getSeconds())}`;

    db.prepare(
      "INSERT OR IGNORE INTO scheduled_posts (article_path, publish_at, channel) VALUES (?, ?, 'toutiao')"
    ).run(articlePath, fireAt);

    console.log(`[toutiao] 今日已达 ${DAILY_CAP} 篇上限，已将本文排期到 ${fireAt}`);
    return fireAt;
  } finally {
    db.close();
  }
}
