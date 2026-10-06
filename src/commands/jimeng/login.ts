import type { Command } from "commander";
import type { Page } from "playwright";
import { launchPersistentContext } from "../../browser.js";

const JIMENG_HOME_URL = "https://jimeng.jianying.com/ai-tool/home";
/** 已登录后页面右上角头像容器的 class 前缀 */
const AVATAR_SELECTOR = '[class^="avatar-action-shell-"]';
/** 今日可用积分数值元素的 class 前缀 */
const CREDIT_SELECTOR = '[class^="credit-amount-text-"]';

/** 即梦登录态 + 积分的返回结构 */
export interface JimengLoginStatus {
  /** 是否已登录 */
  loggedIn: boolean;
  /** 今日可用积分数值；未登录或未取到时为 null */
  credit: number | null;
}

/**
 * 在**当前已打开的页面**上读取今日可用积分数值，不额外跳转/新开页面。
 * 自动剔除非数字字符（如千分位逗号、"积分"字样）后转 number；
 * 找不到元素、文本为空或解析失败时返回 null。
 */
export async function readJimengCredit(page: Page): Promise<number | null> {
  const el = page.locator(CREDIT_SELECTOR).first();
  if ((await el.count()) === 0) return null;
  const text = (await el.textContent())?.trim();
  if (!text) return null;
  const num = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(num) ? num : null;
}

/** 等待积分元素最多 timeoutMs 毫秒出现，再读取；超时则按读不到处理 */
async function readCreditLazily(page: Page, timeoutMs = 5000): Promise<number | null> {
  try {
    await page.locator(CREDIT_SELECTOR).first().waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    // 积分元素可能因接口延迟未渲染，忽略超时，按读不到处理
  }
  return readJimengCredit(page);
}

/**
 * 执行即梦登录检测流程，返回登录态与今日可用积分。
 *
 * - headless：只检测一次，不等待人工登录；
 * - 有头：未登录时打印提示并阻塞等待 2 分钟，期间完成登录则视为成功。
 */
export async function runJimengLogin(headless: boolean): Promise<JimengLoginStatus> {
  const context = await launchPersistentContext({ headless });
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(JIMENG_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  // 等待 SPA 首屏渲染，避免刚跳转时元素尚未挂载导致误判
  await page.waitForTimeout(3000);

  const avatar = page.locator(AVATAR_SELECTOR).first();
  const isLoggedIn = (await avatar.count()) > 0;

  if (headless) {
    const credit = isLoggedIn ? await readCreditLazily(page) : null;
    await context.close();
    return { loggedIn: isLoggedIn, credit };
  }

  if (isLoggedIn) {
    const credit = await readCreditLazily(page);
    await context.close();
    return { loggedIn: true, credit };
  }

  // 有头模式且当前未登录：提示用户手动完成登录，等待头像出现
  console.log("未登录，请在浏览器中完成登录（扫码/手机号），最长等待 2 分钟...");
  try {
    await avatar.waitFor({ state: "visible", timeout: 120000 });
    const credit = await readCreditLazily(page);
    await context.close();
    return { loggedIn: true, credit };
  } catch {
    await context.close();
    return { loggedIn: false, credit: null };
  }
}

export function registerJimengLoginCommand(jimeng: Command): void {
  jimeng
    .command("login")
    .description("登录即梦（未登录则打开页面扫码）")
    .option("--headless", "只检测是否登录，不打开浏览器等待", false)
    .action(async (opts: { headless: boolean }) => {
    const status = await runJimengLogin(opts.headless);
    if (status.loggedIn) {
      console.log("true");
      if (status.credit !== null) console.log(`今日可用积分：${status.credit}`);
    } else {
      console.log("false - 未登录");
    }
    });
}
