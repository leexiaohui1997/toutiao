import type { Command } from "commander";
import { launchPersistentContext } from "../../browser.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renameSession } from "./rename.js";
import { genOne, ensureLogin, type GenTask } from "./gen.js";

export interface ImageOptions {
  prompt?: string;
  output?: string;
  batch?: string;
  chatId?: string;
  rename?: string;
  headless: boolean;
}

/** image 命令的完整逻辑：启动浏览器 → 登录检测 → 会话 → 逐张生图 → 重命名 → 关闭 */
export async function runImageTasks(opts: ImageOptions): Promise<{ chatId?: string }> {
  const context = await launchPersistentContext({ headless: opts.headless, acceptDownloads: true });
  const page = context.pages()[0] ?? (await context.newPage());

  const url = opts.chatId ? `https://www.doubao.com/chat/${opts.chatId}` : "https://www.doubao.com/";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  if (!(await ensureLogin(page))) {
    console.error("✗ 未登录，请先执行 pnpm dev doubao login");
    await context.close();
    process.exit(1);
  }

  if (!opts.chatId) {
    await page.locator("text=新对话").first().click();
    await page.waitForTimeout(2000);
  }

  // 任务列表
  let tasks: GenTask[] = [];
  const promptRaw = (opts.prompt || "").trim();
  if (promptRaw.startsWith("[")) {
    tasks = JSON.parse(promptRaw);
  } else if (opts.batch) {
    tasks = JSON.parse(await readFile(resolve(process.cwd(), opts.batch), "utf-8"));
  } else {
    tasks = [{ prompt: opts.prompt!, output: opts.output }];
  }

  for (let i = 0; i < tasks.length; i++) {
    console.log(`\n[${i + 1}/${tasks.length}]`);
    await genOne(page, tasks[i]);
    if (i === 0 && opts.rename) {
      await renameSession(page, opts.rename);
    }
  }

  const chatId = page.url().match(/\/chat\/([a-zA-Z0-9]+)/)?.[1];
  if (chatId) console.log(`会话 id: ${chatId}`);
  await context.close();
  return { chatId };
}

export function registerDoubaoImageCommand(doubao: Command): void {
  doubao
    .command("image")
    .description("豆包图像生成")
    .requiredOption("-p, --prompt <text>", "提示词，或 JSON 数组 [{prompt, output, ref?}]")
    .option("-o, --output <path>", "单张保存路径")
    .option("-b, --batch <json>", "批量任务 JSON 文件路径")
    .option("-c, --chat-id <id>", "指定会话 id")
    .option("--rename <name>", "第一次生图后重命名会话")
    .option("--headless", "无头模式", false)
    .action(async (opts: ImageOptions) => {
      await runImageTasks(opts);
    });
}
