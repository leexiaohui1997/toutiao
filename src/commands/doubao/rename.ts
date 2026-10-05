import type { Page } from "playwright";

/** 重命名当前会话：点顶部标题 → 弹窗 → 输入新名 → 确定 */
export async function renameSession(page: Page, newName: string): Promise<void> {
  await page.locator('[data-testid="editable_conversation_name"]').first().click();
  await page.waitForTimeout(1000);

  // 弹窗 input
  const input = page.locator("[role=dialog] input, [class*=modal] input").first();
  await input.fill(newName);
  await page.waitForTimeout(500);

  // 点确定
  await page.locator("[role=dialog] button:has-text('确定'), [class*=modal] button:has-text('确定')").first().click();
  await page.waitForTimeout(500);
  console.log(`✓ 会话已重命名: ${newName}`);
}
