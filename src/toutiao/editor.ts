import { resolve } from "node:path";
import type { Page } from "playwright";

/**
 * 今日头条发布文章页编辑器操作。
 *
 * 页面：https://mp.toutiao.com/profile_v4/graphic/publish
 *  - 主标题：textarea[placeholder*="请输入文章标题"]（本脚本不自动填）
 *  - 正文：.ProseMirror contenteditable（TipTap/ProseMirror）
 *  - H1 小标题：工具栏 H 按钮（.syl-toolbar-button nth(4)）toggle
 *  - 图片：工具栏图片按钮 → 弹对话框 → 页面内 input[type=file] → 点"确定"插入
 */

export const PUBLISH_URL = "https://mp.toutiao.com/profile_v4/graphic/publish";

export type ArticleBlock =
  | { type: "title"; content: string }
  | { type: "text"; content: string }
  | { type: "image"; content: string };

/** 打开发布文章页，并关闭遮挡的 AI 助手抽屉 */
export async function openPublishPage(page: Page): Promise<void> {
  await page.goto(PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const d = document.querySelector(".ai-assistant-drawer");
    if (d) (d as HTMLElement).style.display = "none";
    const m = document.querySelector(".byte-drawer-mask");
    if (m) (m as HTMLElement).style.display = "none";
  });
}

/**
 * 在当前空段落里输入 H1 小标题。
 * 前提：调用方已通过 Enter 把光标移到一个新空段落。
 * 流程：点 H 按钮把空段落切成 h1 → type 标题文字。
 * 结束后不切回 p——h1 末尾按 Enter 会自动新起 p。
 */
export async function typeH1Heading(page: Page, text: string): Promise<void> {
  await page.locator(".syl-toolbar-button").nth(4).click();
  await page.waitForTimeout(250);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(150);
}

/**
 * 插入一张本地图片到当前光标位置。
 */
export async function insertImage(page: Page, localPath: string): Promise<void> {
  const absPath = resolve(process.cwd(), localPath);

  const imgsBefore = await page.locator(".ProseMirror img").count();

  const imgBtn = page
    .locator(
      'button[title*="图"], [aria-label*="图"], [class*="toolbar"] [class*="image"], [class*="toolbar"] [class*="Image"]'
    )
    .first();
  await imgBtn.click();
  await page.waitForTimeout(1000);

  const fileInput = page.locator('input[type="file"][accept*="image"]').first();
  await fileInput.waitFor({ state: "attached", timeout: 10000 });
  await fileInput.setInputFiles(absPath);

  await page
    .locator('text=/已上传.*张图片/')
    .waitFor({ state: "visible", timeout: 30000 });

  await page.getByRole("button", { name: "确定" }).click();

  await page.waitForFunction(
    (prev) => document.querySelectorAll(".ProseMirror img").length > prev,
    imgsBefore,
    { timeout: 30000 }
  );
  await page.waitForTimeout(300);
}

/**
 * 填充话题标签段落。
 * 流程：新起一段 → 把每个 tag 规范化为 "#tag#" 格式 → 空格分隔 → 一次性插入。
 * @param lastBlockIsImage 上一块是否为 image（image 后编辑器已自动留空段，无需再按 Enter）
 */
export async function fillTags(page: Page, tags: string[], lastBlockIsImage: boolean): Promise<void> {
  if (!tags.length) return;

  if (!lastBlockIsImage) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
  }

  const normalized = tags.map((t) => `#${t.replace(/^#+/, "").replace(/#+$/, "")}#`);
  await page.keyboard.insertText(normalized.join(" "));
  await page.waitForTimeout(300);
}

/**
 * 按 JSON blocks 顺序填充正文。
 * - title 块：正文里的 H1 小标题
 * - text 块：普通正文段落
 * - image 块：在当前光标处插入图片
 *
 * 每个块开始前先按 Enter 新起一段（首块除外），保证块之间不串行。
 */
export async function fillArticle(page: Page, blocks: ArticleBlock[]): Promise<void> {
  const editor = page.locator(".ProseMirror").first();
  await editor.click();
  await page.waitForTimeout(300);

  let prevType: ArticleBlock["type"] | null = null;
  for (const block of blocks) {
    // 块间换行：
    // - 首块不换
    // - 上一块是 image 时不换（图片是块级元素，插入后编辑器已自动在其后留空段落，光标就在那里）
    if (prevType !== null && prevType !== "image") {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
    }

    if (block.type === "title") {
      await typeH1Heading(page, block.content);
    } else if (block.type === "text") {
      await page.keyboard.insertText(block.content);
    } else if (block.type === "image") {
      await insertImage(page, block.content);
    }
    prevType = block.type;
  }
}
