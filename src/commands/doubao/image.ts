import type { Command } from "commander";
import { launchPersistentContext } from "../../browser.js";
import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renameSession } from "./rename.js";

interface Task {
  prompt: string;
  output?: string;
  ref?: string;
}

/** 生成单张图并保存 */
async function genOne(page: any, task: Task, imageUrls: string[]): Promise<void> {
  // 每次都切到图像生成模式
  const imgTab = page.locator("text=图像生成").first();
  if (await imgTab.isVisible().catch(() => false)) {
    await imgTab.click();
    await page.waitForTimeout(500);
  }

  // 上传参考图
  if (task.ref) {
    const refPath = resolve(process.cwd(), task.ref);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(refPath);
    console.log(`  已上传参考图: ${task.ref}`);
    await page.waitForTimeout(3000);
  }

  // 输入提示词
  const input = page.locator("textarea, [contenteditable=true]").first();
  await input.click();
  await page.keyboard.insertText(task.prompt);
  await page.waitForTimeout(500);

  // 发送
  await page.keyboard.press("Enter");
  console.log(`✓ 已发送: ${task.prompt.slice(0, 30)}...`);

  // 等待生成完成
  await page.waitForTimeout(3000);
  const start = Date.now();
  while (Date.now() - start < 120000) {
    const generating = await page.locator("text=/生成中|正在生成|排队中/i").count();
    if (generating === 0) {
      await page.waitForTimeout(2000);
      console.log("✓ 生成完成");
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (task.output) {
    // hover 最后一张图，出现下载按钮
    const lastImg = page.locator("main img[srcset]").last();
    await lastImg.hover();
    await page.waitForTimeout(1000);

    const dlBtn = page.locator('[data-testid="edit_image_hover_tag_download_btn"]').last();

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      dlBtn.click(),
    ]);

    const outPath = resolve(process.cwd(), task.output);
    await download.saveAs(outPath);
    console.log(`✓ 已保存: ${outPath}`);
  }
}

export function registerDoubaoImageCommand(doubao: Command): void {
  doubao
    .command("image")
    .description("豆包图像生成")
    .requiredOption("-p, --prompt <text>", "提示词，或 JSON 数组 [{prompt, output}]")
    .option("-o, --output <path>", "单张保存路径")
    .option("-b, --batch <json>", "批量任务 JSON 文件路径（同 -p 传 JSON）")
    .option("-c, --chat-id <id>", "指定会话 id")
    .option("--rename <name>", "第一次生图后重命名会话")
    .option("--headless", "无头模式", false)
    .action(async (opts: { prompt?: string; output?: string; batch?: string; chatId?: string; rename?: string; headless: boolean }) => {
      const context = await launchPersistentContext({ headless: opts.headless, acceptDownloads: true });
      const page = context.pages()[0] ?? (await context.newPage());

      // 收集图片相关请求
      const imageUrls: string[] = [];
      page.on("request", req => {
        const u = req.url();
        if (u.includes("imagex") || u.includes("tos-") || u.match(/\.(jpeg|jpg|png|webp)/i)) {
          imageUrls.push(u);
        }
      });

      const url = opts.chatId ? `https://www.doubao.com/chat/${opts.chatId}` : "https://www.doubao.com/";
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);

      // 检测登录态
      const loginBtn = page.locator("button:has-text('登录')").first();
      if (await loginBtn.isVisible().catch(() => false)) {
        console.error("✗ 未登录，请先执行 pnpm dev doubao login");
        await context.close();
        process.exit(1);
      }

      // 新对话
      if (!opts.chatId) {
        await page.locator("text=新对话").first().click();
        await page.waitForTimeout(2000);
      }

      // 任务列表
      let tasks: Task[] = [];
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
        await genOne(page, tasks[i], imageUrls);
        // 第一次生图后重命名会话
        if (i === 0 && opts.rename) {
          await renameSession(page, opts.rename);
        }
      }

      // 打印会话 id
      const chatId = page.url().match(/\/chat\/([a-zA-Z0-9]+)/)?.[1];
      if (chatId) console.log(`会话 id: ${chatId}`);
      await context.close();
    });
}
