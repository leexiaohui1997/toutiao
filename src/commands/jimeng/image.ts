import type { Page } from "playwright";
import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { launchPersistentContext } from "../../browser.js";

const JIMENG_HOME_URL = "https://jimeng.jianying.com/ai-tool/home";
/** 提示词输入框：prompt-editor 容器内的 tiptap 富文本编辑区 */
const PROMPT_EDITOR_SELECTOR = '[class^="prompt-editor-"] .tiptap[contenteditable="true"]';
/** 发送/生成按钮：data-generator-submit-available=true，带 [disabled] 表示禁用；:visible 过滤掉 DOM 里隐藏的同名按钮 */
const SUBMIT_SELECTOR = 'button[data-generator-submit-available="true"]:not([disabled]):visible';
/** 工具栏设置区里的下拉触发器：第一个是模式，第二个是模型（切到图片生成后出现） */
const TOOLBAR_COMBOBOX_SELECTOR = '[class*="toolbar-settings-content-"] div[role="combobox"]';
/** 设置面板展开按钮：toolbar-settings-content- 内的 lv-btn */
const SETTINGS_BTN_SELECTOR = '[class*="toolbar-settings-content-"] button.lv-btn';
/** 参考图上传容器：点它会触发选图；内部藏有 input[type=file] */
const REFERENCE_UPLOAD_SELECTOR = '[class^="reference-upload-"]';

/** 即梦生图单条任务 */
export interface JimengImageTask {
  /** 提示词 */
  prompt: string;
  /** 图片保存位置（相对项目根） */
  output: string;
  /** 参考图路径（相对项目根）；不传则不使用参考图 */
  ref?: string;
}

export interface JimengImageOptions {
  headless: boolean;
  /** 即梦会话 id（workspace）；不传则新开会话并自动选模式/模型/参数 */
  workspaceId?: string;
}

/** 生图流程返回结果 */
export interface JimengImageResult {
  /** 本次生图所在的会话 id（workspace），供下次复用 */
  workspaceId?: string;
}

/**
 * 把提示词填入即梦 prompt 编辑器：focus → 清空已有内容 → insertText。
 */
export async function fillPromptEditor(page: Page, prompt: string): Promise<void> {
  const editor = page.locator(PROMPT_EDITOR_SELECTOR).first();
  await editor.waitFor({ state: "visible", timeout: 30000 });
  await editor.focus();
  await page.waitForTimeout(200);

  // 清空输入框：直接清空 innerHTML 并触发 input 事件，确保 tiptap 内部状态同步
  await editor.evaluate((el) => {
    el.innerHTML = "";
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);

  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(500);
  console.log(`✓ 已输入提示词: ${prompt}`);
}

/**
 * 点击发送/生成按钮。
 * 选择器已带 :visible，click 自带 actionability 等待（visible/enabled/stable）。
 */
export async function clickSubmitButton(page: Page): Promise<void> {
  const btn = page.locator(SUBMIT_SELECTOR).first();
  await btn.click({ timeout: 10000 });
  console.log("✓ 已点击生成按钮");
}

/**
 * 等待生成完成：点完后按钮会变成 data-generator-submit-available="false"（生成中），
 * 等它变回 "true" 即表示出图完成。默认超时 3 分钟。
 */
export async function waitForGenerationComplete(page: Page, timeoutMs = 180000): Promise<void> {
  // 先确认按钮已进入生成中状态（available=false），避免点完瞬间还是 true 导致误判
  await page
    .locator('button[data-generator-submit-available="false"]:visible')
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .catch(() => {
      // 若按钮没经历 false 态（如秒出/本地缓存），忽略
    });

  // 等 available 变回 true
  await page
    .locator('button[data-generator-submit-available="true"]:visible')
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs });
  console.log("✓ 生成完成");
}

/**
 * 取最新一张生成图的 src：
 *   ai-generated-record-content- 容器 → 最后一个 div[data-generated-record-body="inset"]
 *   → 内部 img[data-apm-action="ai-generated-image-record-card"] 且 src 非空。
 * 等到元素可见且 src 有值后返回。
 */
export async function getLatestGeneratedImageSrc(page: Page, timeoutMs = 60000): Promise<string> {
  const img = page
    .locator('[class*="ai-generated-record-content-"] div[data-generated-record-body="inset"]')
    .last()
    .locator('img[data-apm-action="ai-generated-image-record-card"]:not([src=""])')
    .first();
  await img.waitFor({ state: "visible", timeout: timeoutMs });

  const src = await img.getAttribute("src");
  if (!src) throw new Error("最新生成图 src 为空");
  console.log(`✓ 最新生成图: ${src}`);
  return src;
}

/** 把图片 URL 下载到本地（output 相对项目根） */
export async function downloadImage(src: string, outputRelPath: string): Promise<void> {
  const outPath = resolve(process.cwd(), outputRelPath);
  mkdirSync(dirname(outPath), { recursive: true });

  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`下载失败: HTTP ${resp.status}`);
  const body = Readable.fromWeb(resp.body as any);
  await pipeline(body, createWriteStream(outPath));
  console.log(`✓ 已保存: ${outPath}`);
}

/**
 * 上传参考图：点 reference-upload 触发器（div），通过 Playwright 的 filechooser 事件直接喂文件，
 * 不依赖 file input 在 DOM 里的具体位置。上传后等待预览加载。
 */
export async function uploadReferenceImage(page: Page, refRelPath: string): Promise<void> {
  const trigger = page.locator(REFERENCE_UPLOAD_SELECTOR).first();
  await trigger.waitFor({ state: "visible", timeout: 10000 });

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    trigger.click(),
  ]);
  await fileChooser.setFiles(resolve(process.cwd(), refRelPath));
  console.log(`✓ 已上传参考图: ${refRelPath}`);
  // 等参考图上传完成并出现在预览区
  await page.waitForTimeout(3000);
}

/**
 * 选择模式：点工具栏第一个 combobox，选中"图片生成"。
 * 应在输入提示词前调用。
 */
export async function openModeSelector(page: Page): Promise<void> {
  const trigger = page.locator(TOOLBAR_COMBOBOX_SELECTOR).nth(0);
  await trigger.waitFor({ state: "visible", timeout: 10000 });
  await trigger.click();
  console.log("✓ 已点击模式下拉触发器");

  const option = page.locator('li[role="option"]', { hasText: "图片生成" }).first();
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
  console.log("✓ 已选择模式：图片生成");
  await page.waitForTimeout(500);
}

/**
 * 选择模型：切到图片生成模式后，工具栏第二个 combobox 会出现，
 * 点开后选中"Seedream 4.7"。需在 {@link openModeSelector} 之后调用。
 */
export async function selectModel(page: Page): Promise<void> {
  const trigger = page.locator(TOOLBAR_COMBOBOX_SELECTOR).nth(1);
  await trigger.waitFor({ state: "visible", timeout: 5000 });
  await trigger.click();
  console.log("✓ 已点击模型下拉触发器");

  const option = page.locator('li[role="option"]', { hasText: "Seedream 4.7" }).first();
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
  console.log("✓ 已选择模型：Seedream 4.7");
  await page.waitForTimeout(500);
}

/**
 * 配置图片参数：展开设置面板 → 画质选"智能" → 分辨率选 2K → 数量选 1。
 * 需在 {@link selectModel} 之后调用。
 */
export async function configureImageSettings(page: Page): Promise<void> {
  // 1. 点设置按钮展开面板
  const settingsBtn = page.locator(SETTINGS_BTN_SELECTOR).nth(0);
  await settingsBtn.waitFor({ state: "visible", timeout: 5000 });
  await settingsBtn.click();
  console.log("✓ 已展开图片设置面板");
  await page.waitForTimeout(300);

  // 2. 画质：智能
  await page.locator("label.lv-radio", { hasText: "智能" }).first().click();
  console.log("✓ 画质：智能");

  // 3. 分辨率：2K（label 内含 input[value=2k]）
  await page
    .locator("label.lv-radio", { has: page.locator('input[value="2k"]') })
    .first()
    .click();
  console.log("✓ 分辨率：2K");

  // 4. 数量：1（label 内含 input[value=1]）
  await page
    .locator("label.lv-radio", { has: page.locator('input[value="1"]') })
    .first()
    .click();
  console.log("✓ 数量：1");

  await page.waitForTimeout(300);
}

/**
 * 即梦生图批量流程。
 * 传 workspaceId 时直接打开已有会话（沿用上次的模式/模型/参数）；否则新开会话并自动配置。
 */
export async function runJimengImageTasks(
  tasks: JimengImageTask[],
  opts: JimengImageOptions,
): Promise<JimengImageResult> {
  if (tasks.length === 0) return {};

  const context = await launchPersistentContext({ headless: opts.headless, acceptDownloads: true });
  const page = context.pages()[0] ?? (await context.newPage());

  const startUrl = opts.workspaceId
    ? `https://jimeng.jianying.com/ai-tool/generate?workspace=${opts.workspaceId}`
    : JIMENG_HOME_URL;
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

  // 等输入框出现；未登录时该元素不会渲染
  try {
    await page.locator(PROMPT_EDITOR_SELECTOR).first().waitFor({ state: "visible", timeout: 15000 });
  } catch {
    console.error("✗ 未找到提示词输入框，可能未登录，请先执行 pnpm dev jimeng login");
    await context.close();
    process.exit(1);
  }

  // 先聚焦输入框，再做后续工具栏操作（模式/模型/参数）
  await page.locator(PROMPT_EDITOR_SELECTOR).first().focus();
  await page.waitForTimeout(300);

  // 新会话才需要选模式/模型/参数；已有会话沿用上次设置
  if (!opts.workspaceId) {
    await openModeSelector(page);
    await selectModel(page);
    await configureImageSettings(page);
  }

  for (let i = 0; i < tasks.length; i++) {
    console.log(`\n[${i + 1}/${tasks.length}] output=${tasks[i].output}`);
    if (tasks[i].ref) {
      await uploadReferenceImage(page, tasks[i].ref!);
    }
    await fillPromptEditor(page, tasks[i].prompt);
    await clickSubmitButton(page);
    await waitForGenerationComplete(page);
    const src = await getLatestGeneratedImageSrc(page);
    await downloadImage(src, tasks[i].output);
  }

  const workspaceId = new URL(page.url()).searchParams.get("workspace") ?? undefined;
  if (workspaceId) console.log(`会话 id: ${workspaceId}`);
  await context.close();
  return { workspaceId };
}
