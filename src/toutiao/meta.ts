import { resolve } from "node:path";
import type { Page } from "playwright";

/**
 * 文章元信息填写：主标题、封面、位置、合集。
 * 这些控件都在发布页底部/顶部，与正文 ProseMirror 独立。
 */

/** 填顶部主标题 */
export async function fillMainTitle(page: Page, text: string): Promise<void> {
  await page.locator('textarea[placeholder*="请输入文章标题"]').fill(text);
}

/**
 * 上传封面图片（单图模式）。
 * 流程：点封面 + 号 → drawer 弹出 → 点"本地上传" → setInputFiles → 等"已上传 N 张图片" → 点"确定"。
 */
export async function uploadCover(page: Page, localPath: string): Promise<void> {
  const absPath = resolve(process.cwd(), localPath);

  // 确保选中"单图"模式（value=2）。未选中则点它的 label。
  const singleRadio = page.locator('input[type="radio"][value="2"]');
  const isChecked = await singleRadio.isChecked().catch(() => false);
  if (!isChecked) {
    await page.locator('label.byte-radio:has-text("单图")').click();
    await page.waitForTimeout(300);
  }

  // 点 + 号
  await page.locator(".article-cover-add").click();
  await page.waitForTimeout(1000);

  // 切到"上传图片"tab（默认可能停在"正文图片"）
  await page.locator(".byte-tabs-header-title", { hasText: "上传图片" }).click();
  await page.waitForTimeout(500);

  // 点"本地上传"，同时监听 filechooser
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    page.locator('button:has-text("本地上传")').click(),
  ]);
  await fileChooser.setFiles(absPath);

  // 等上传完成
  await page.locator('text=/已上传.*张图片/').waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(500);

  // 点右下角"确定"
  await page.getByRole("button", { name: "确定" }).click();
  await page.waitForTimeout(1000);
}

/**
 * 添加位置（同城标签）。
 * 流程：点 .position-select → 输入城市名 → 等下拉选项 → 点第一个匹配项。
 */
export async function setLocation(page: Page, city: string): Promise<void> {
  const select = page.locator(".position-select").first();
  await select.scrollIntoViewIfNeeded();
  await select.click();
  await page.waitForTimeout(500);

  const input = select.locator("input").first();
  await input.fill(city);
  await page.waitForTimeout(1000);

  // 点第一个选项
  const option = page.locator(".byte-select-option").first();
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
  await page.waitForTimeout(500);
}

/**
 * 自动发布：点"预览并发布" → 等确认弹窗 → 点"确认发布" → 跳转作品管理页 → 验证标题已出现。
 */
export async function publish(page: Page, title: string): Promise<void> {
  // 点右下角"预览并发布"
  await page.locator('button:has-text("预览并发布")').last().click();
  await page.waitForTimeout(2000);

  // 点完"预览并发布"后，右下角按钮直接变为"确认发布"（页面内切换，非弹窗）
  const confirmBtn = page.locator('button:has-text("确认发布")').last();
  await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
  await confirmBtn.click();
  await page.waitForTimeout(5000);

  // 跳转作品管理页
  await page.goto("https://mp.toutiao.com/profile_v4/manage/content/all", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // 验证刚发布的标题在列表里
  await page.locator(`text=${title}`).first().waitFor({ state: "visible", timeout: 15000 });
  console.log(`✓ 作品管理页已确认：找到《${title}》`);
}

/** 合集今日已达上限（项为 disabled 状态） */
export class CollectionLockedError extends Error {
  constructor(public collectionName: string) {
    super(`合集「${collectionName}」今日已达上限，等待解锁…`);
  }
}

/**
 * 从已有合集中选择。
 * 流程：点"添加至合集" → 弹窗列出合集 → 检查目标项是否 disabled → 勾选 → 点"确定"。
 * 若目标项 disabled（今日已发过），throw CollectionLockedError。
 */
export async function setCollection(page: Page, name: string): Promise<void> {
  await page.locator('button:has-text("添加至合集")').click();
  await page.waitForTimeout(1000);

  // 在弹窗里找目标合集项
  const item = page.locator(".add-collection-item", { hasText: name }).first();
  await item.waitFor({ state: "visible", timeout: 5000 });

  // 检查是否 disabled
  const cls = (await item.getAttribute("class")) || "";
  if (cls.includes("disabled")) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    throw new CollectionLockedError(name);
  }

  await item.click();
  await page.waitForTimeout(500);

  // 点弹窗右下角"确定"
  await page.locator('.byte-modal-footer button:has-text("确定"), .byte-modal button:has-text("确定")').last().click();
  await page.waitForTimeout(800);
}
