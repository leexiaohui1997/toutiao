import type { BrowserContext, Page } from "playwright";

/**
 * 夸克网盘登录态判断与保障。
 *
 * 判断依据：访问 https://pan.quark.cn/，若 URL 跳转到文件列表（非登录页）即视为已登录。
 */

const HOME_URL = "https://pan.quark.cn/";

export interface EnsureQuarkLoginOptions {
  /** 已存在的 page，复用；不传则新建 */
  page?: Page;
  /** 未登录、弹出二维码后回调 */
  onNeedLogin?: () => void;
  /** 扫码等待超时（毫秒），默认 5 分钟 */
  scanTimeoutMs?: number;
  /** 轮询间隔（毫秒），默认 2000 */
  pollIntervalMs?: number;
}

/** 访问首页，判断当前 URL 是否已登录（跳转到文件列表） */
function isLoggedInUrl(url: string): boolean {
  return url !== HOME_URL && !url.includes("/login");
}

/**
 * 确保夸克网盘登录态。
 * - 已登录：直接返回 true；
 * - 未登录：打开登录页（显示二维码），轮询等待扫码成功后返回 true；
 * - 超时未扫码：返回 false。
 *
 * 注意：本函数不会关闭传入的 context / page，由调用方负责收尾。
 */
export async function ensureQuarkLogin(
  context: BrowserContext,
  options: EnsureQuarkLoginOptions = {}
): Promise<boolean> {
  const {
    page: givenPage,
    onNeedLogin,
    scanTimeoutMs = 5 * 60 * 1000,
    pollIntervalMs = 2000,
  } = options;

  const page = givenPage ?? context.pages()[0] ?? (await context.newPage());
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  if (isLoggedInUrl(page.url())) {
    return true;
  }

  onNeedLogin?.();

  const deadline = Date.now() + scanTimeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(pollIntervalMs);
    if (isLoggedInUrl(page.url())) {
      return true;
    }
  }

  return false;
}
