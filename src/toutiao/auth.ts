import type { BrowserContext, Page } from "playwright";

/**
 * 今日头条登录态判断与保障。
 *
 * 判断依据：cookie 中存在 sessionid / sessionid_ss（字节系通用登录态字段）即视为已登录。
 * 该信号比 DOM 更稳定，不随前端改版失效。
 */

const LOGIN_COOKIE_NAMES = ["sessionid", "sessionid_ss"] as const;
const HOME_URL = "https://www.toutiao.com";

export interface EnsureLoginOptions {
  /** 已存在的 page，复用；不传则新建 */
  page?: Page;
  /** 未登录、弹出二维码后回调（可用于打印提示） */
  onNeedLogin?: () => void;
  /** 扫码等待超时（毫秒），默认 5 分钟 */
  scanTimeoutMs?: number;
  /** 轮询 cookie 间隔（毫秒），默认 2000 */
  pollIntervalMs?: number;
}

/** 检查 context 中是否存在登录 cookie */
export async function hasLoginCookie(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies("https://www.toutiao.com");
  return cookies.some(
    (c) => (LOGIN_COOKIE_NAMES as readonly string[]).includes(c.name) && c.value.length > 0
  );
}

/**
 * 确保登录态：已登录直接返回 true；未登录则弹出扫码登录二维码，
 * 保持浏览器会话不关闭，轮询等待用户扫码成功后返回 true。
 *
 * 注意：本函数不会关闭传入的 context / page，由调用方负责收尾。
 */
export async function ensureLogin(context: BrowserContext, options: EnsureLoginOptions = {}): Promise<boolean> {
  const {
    page: givenPage,
    onNeedLogin,
    scanTimeoutMs = 5 * 60 * 1000,
    pollIntervalMs = 2000,
  } = options;

  // 1. 先看 cookie，已登录直接返回，不打扰浏览器
  if (await hasLoginCookie(context)) {
    return true;
  }

  // 2. 打开首页
  const page = givenPage ?? context.pages()[0] ?? (await context.newPage());
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);

  // 3. 首页加载后再查一次 cookie（可能静默刷新出登录态）
  if (await hasLoginCookie(context)) {
    return true;
  }

  // 4. 点击页面右上角「登录」按钮，弹出扫码登录弹窗
  const loginTrigger = page.locator('a:has-text("登录"):visible').first();
  await loginTrigger.click();

  // 5. 等扫码二维码出现（弹窗右侧"扫码登录"标题）
  await page
    .getByText("扫码登录", { exact: true })
    .waitFor({ state: "visible", timeout: 15000 });

  onNeedLogin?.();

  // 6. 轮询 cookie 等扫码成功
  const deadline = Date.now() + scanTimeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(pollIntervalMs);
    if (await hasLoginCookie(context)) {
      return true;
    }
  }

  return false;
}
