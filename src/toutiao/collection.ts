import { resolve } from "node:path";
import type { Page } from "playwright";

const CREATE_URL = "https://mp.toutiao.com/profile_v4/graphic/collection-publish?from=collection_publish";
const LIST_URL = "https://mp.toutiao.com/profile_v4/graphic/collections";

/** 轮询合集列表页，等目标合集变成"已发布"，最多10分钟 */
async function waitUntilPublished(page: Page, name: string): Promise<void> {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const found = await page
      .locator(`.collection-card-item:has-text("${name}"):has-text("已发布")`)
      .first()
      .isVisible()
      .catch(() => false);
    if (found) {
      console.log(`✓ 合集《${name}》已发布`);
      return;
    }
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }
  throw new Error(`等待合集《${name}》发布超时（10分钟）`);
}

/**
 * 创建合集（幂等）。
 * 流程：先查合集列表页 →
 *   - 已存在且已发布：直接返回；
 *   - 已存在但未发布：轮询等它发布；
 *   - 不存在：走创建流程（填标题+封面+点创建）→ 轮询等发布。
 */
export async function createCollection(page: Page, name: string, coverPath: string): Promise<void> {
  // 1. 先查合集列表页
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // 合集卡片是否存在（不要求已发布）
  const exists = await page
    .locator(`.collection-card-item:has-text("${name}")`)
    .first()
    .isVisible()
    .catch(() => false);

  if (exists) {
    // 已存在，检查是否已发布
    const published = await page
      .locator(`.collection-card-item:has-text("${name}"):has-text("已发布")`)
      .first()
      .isVisible()
      .catch(() => false);
    if (published) {
      console.log(`合集《${name}》已存在且已发布，跳过创建`);
      return;
    }
    // 存在但未发布，轮询等待
    console.log(`合集《${name}》已存在但未发布，等待…`);
    await waitUntilPublished(page, name);
    return;
  }

  // 2. 不存在，走创建流程
  console.log(`合集《${name}》不存在，开始创建…`);
  const absCover = resolve(process.cwd(), coverPath);

  await page.goto(CREATE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.locator('input[placeholder="请输入"]').fill(name);
  await page.waitForTimeout(300);

  const fileInput = page.locator('input[type="file"][accept*="image"]');
  await fileInput.setInputFiles(absCover);

  // 等待封面编辑弹窗出现
  await page.locator('.byte-modal button:has-text("确定")').waitFor({ state: "visible", timeout: 120000 });

  // 等待预览图加载完成（active 预览出现），再点确定
  await page.locator('.byte-modal .previews .preview.active').waitFor({ state: "visible", timeout: 120000 });
  await page.locator('.byte-modal button:has-text("确定")').click();
  await page.waitForTimeout(1000);

  // 检测图片上传接口完成
  const uploadResp = await page.waitForResponse(
    (r) => r.url().includes("/spice/image?upload_source") && r.status() === 200,
    { timeout: 30000 }
  );
  console.log(`封面上传完成 (${uploadResp.status()})`);
  await page.waitForTimeout(1000);

  await page.locator('button:has-text("创建合集")').last().click();
  await page.waitForTimeout(3000);

  // 3. 跳合集列表页轮询
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitUntilPublished(page, name);
}
