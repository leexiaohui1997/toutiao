import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";

/**
 * 浏览器启动封装：使用 launchPersistentContext，
 * userDataDir 指向项目内目录，cookie / localStorage / 登录态跨命令持久保留。
 */
export interface LaunchOptions {
  /** 持久化用户数据目录，默认 <project>/.browser-data/chromium */
  userDataDir?: string;
  /** 是否无头模式，默认 false（有头，便于手动登录/扫码） */
  headless?: boolean;
  /** 视口宽度，默认 1280 */
  viewportWidth?: number;
  /** 视口高度，默认 800 */
  viewportHeight?: number;
  /** 是否允许下载，默认 false */
  acceptDownloads?: boolean;
}

export const DEFAULT_USER_DATA_DIR = resolve(process.cwd(), ".browser-data", "chromium");

export async function launchPersistentContext(options: LaunchOptions = {}): Promise<BrowserContext> {
  const {
    userDataDir = DEFAULT_USER_DATA_DIR,
    headless = false,
    viewportWidth = 1280,
    viewportHeight = 800,
    acceptDownloads = false,
  } = options;

  mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    acceptDownloads,
    viewport: { width: viewportWidth, height: viewportHeight },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  return context;
}
