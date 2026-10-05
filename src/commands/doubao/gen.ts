import type { Page } from "playwright";
import { resolve } from "node:path";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface GenTask {
  prompt: string;
  output?: string;
  ref?: string;
}

/** 切到图像生成模式 */
export async function switchToImageMode(page: Page): Promise<void> {
  const imgTab = page.locator("text=图像生成").first();
  if (await imgTab.isVisible().catch(() => false)) {
    await imgTab.click();
    await page.waitForTimeout(500);
  }
}

/** 上传参考图 */
export async function uploadRefImage(page: Page, refPath: string): Promise<void> {
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(resolve(process.cwd(), refPath));
  console.log(`  已上传参考图: ${refPath}`);
  await page.waitForTimeout(3000);
}

/** 输入提示词并发送 */
export async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const input = page.locator("textarea, [contenteditable=true]").first();
  await input.click();
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  console.log(`✓ 已发送: ${prompt.slice(0, 30)}...`);
}

/** 等待生成完成 */
export async function waitForGeneration(page: Page, timeoutMs = 120000): Promise<void> {
  await page.waitForTimeout(10000);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const generating = await page.locator("text=/生成中|正在生成|排队中/i").count();
    if (generating === 0) {
      await page.waitForTimeout(2000);
      console.log("✓ 生成完成");
      return;
    }
    await page.waitForTimeout(2000);
  }
}

/** 从 URL query 中提取参数值 */
function getQueryParam(url: string, key: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get(key);
  } catch {
    return null;
  }
}

/** 下载最后一张图：解析 srcset uri → 匹配 get_without_watermark 响应 → node fetch 下载 */
export async function downloadLastImage(page: Page, outputRelPath: string, collectedResponses: any[]): Promise<void> {
  // 1. 取最后一张图的 srcset，解析出 uri
  const lastImg = page.locator("main img[srcset]").last();
  const srcset = await lastImg.getAttribute("srcset");
  if (!srcset) throw new Error("无法获取图片 srcset");

  const firstUrl = srcset.split(",")[0].trim().split(" ")[0];
  const urlObj = new URL(firstUrl);
  const uri = urlObj.pathname.replace(/^\//, "").split("~")[0];
  console.log(`  uri: ${uri}`);

  // 2. 在已收集的响应里找包含该 uri 的 download URL
  let downloadUrl: string | undefined;
  for (const resp of collectedResponses) {
    try {
      const json = JSON.parse(resp.body);
      const entry = json?.data?.download_image?.[uri];
      if (entry?.url) {
        downloadUrl = entry.url;
        break;
      }
    } catch {}
  }

  if (!downloadUrl) {
    console.log("  已收集的 get_without_watermark 响应：");
    collectedResponses.forEach((resp, i) => {
      console.log(`    [${i}]`, resp.url(), "body:", (resp.body || "").slice(0, 300));
    });
    throw new Error("未找到匹配的下载 URL");
  }

  console.log(`✓ 下载 URL: ${downloadUrl}`);

  // 3. 用 node fetch 下载
  const outPath = resolve(process.cwd(), outputRelPath);
  const resp = await fetch(downloadUrl);
  if (!resp.ok) throw new Error(`下载失败: HTTP ${resp.status}`);
  const body = Readable.fromWeb(resp.body as any);
  await pipeline(body, createWriteStream(outPath));
  console.log(`✓ 已保存: ${outPath}`);
}

/** 生成单张图并下载（完整流程） */
export async function genOne(page: Page, task: GenTask): Promise<void> {
  await switchToImageMode(page);

  if (task.ref) {
    await uploadRefImage(page, task.ref);
  }

  // 发送提示词后开始监听 get_without_watermark 响应
  const noWatermarkResponses: any[] = [];
  page.on("response", async (resp) => {
    if (resp.url().includes("get_without_watermark")) {
      try {
        const body = await resp.text();
        noWatermarkResponses.push({ url: resp.url(), body });
      } catch {}
    }
  });

  await sendPrompt(page, task.prompt);

  // 等待 get_without_watermark 响应出现（最多 120s）
  const start = Date.now();
  while (noWatermarkResponses.length === 0 && Date.now() - start < 120000) {
    await page.waitForTimeout(2000);
  }
  if (noWatermarkResponses.length === 0) {
    throw new Error("等待 get_without_watermark 响应超时");
  }
  console.log("✓ 收到 get_without_watermark 响应");

  if (task.output) {
    try {
      await downloadLastImage(page, task.output, noWatermarkResponses);
    } catch (err) {
      console.error(`✗ 下载失败: ${(err as Error).message}`);
    }
  }
}

/** 检测登录态，未登录则退出 */
export async function ensureLogin(page: Page): Promise<boolean> {
  const loginBtn = page.locator("button:has-text('登录')").first();
  if (await loginBtn.isVisible().catch(() => false)) {
    return false;
  }
  return true;
}

/** 打开会话并完成登录检测/新对话 */
export async function setupSession(page: Page, chatId?: string): Promise<void> {
  const url = chatId ? `https://www.doubao.com/chat/${chatId}` : "https://www.doubao.com/";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  if (!(await ensureLogin(page))) {
    console.error("✗ 未登录，请先执行 pnpm dev doubao login");
    process.exit(1);
  }

  if (!chatId) {
    await page.locator("text=新对话").first().click();
    await page.waitForTimeout(2000);
  }
}

/** 获取当前会话 id */
export function getChatId(page: Page): string | undefined {
  return page.url().match(/\/chat\/([a-zA-Z0-9]+)/)?.[1];
}
