import type { Page } from "playwright";
import { createWriteStream } from "node:fs";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { launchPersistentContext } from "../../browser.js";
import { readJimengCredit } from "./login.js";

const JIMENG_HOME_URL = "https://jimeng.jianying.com/ai-tool/home";
/** 提示词输入框：prompt-editor 容器内的 tiptap 富文本编辑区 */
const PROMPT_EDITOR_SELECTOR = '[class^="prompt-editor-"] .tiptap[contenteditable="true"]';
/** 发送/生成按钮：data-generator-submit-available=true，带 [disabled] 表示禁用；:visible 过滤掉 DOM 里隐藏的同名按钮 */
const SUBMIT_SELECTOR = 'button[data-generator-submit-available="true"]:not([disabled]):visible';
/** 工具栏设置区里的下拉触发器：第一个是模式，第二个是模型（切到图片生成后出现） */
const TOOLBAR_COMBOBOX_SELECTOR = '[class*="toolbar-settings-content-"] div[role="combobox"]';
/** 设置面板展开按钮：toolbar-settings-content- 内的 lv-btn */
const SETTINGS_BTN_SELECTOR = '[class*="toolbar-settings-content-"] button.lv-btn';
/** 参考图组容器：drop 事件上传目标，缩略图会渲染在这里 */
const REFERENCE_GROUP_SELECTOR = '[class*="reference-group-content-"]';

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
 * 上传参考图：即梦页面没有 <input type="file">，加号按钮在 headless 下点击不会触发
 * filechooser。改用浏览器内构造 File + DataTransfer，直接 dispatch dragenter/dragover/drop
 * 事件到参考图组容器，等价于用户把文件拖进去。实测可成功触发上传缩略图。
 */
export async function uploadReferenceImage(page: Page, refRelPath: string): Promise<void> {
  const absPath = resolve(process.cwd(), refRelPath);
  const buf = readFileSync(absPath);
  const b64 = buf.toString("base64");
  const ext = extname(absPath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";

  await page.evaluate(
    async ({ b64, name, mime }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], name, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);

      const target = document.querySelector('[class*="reference-group-content-"]') as HTMLElement
        || document.querySelector('[class*="reference-group-"]') as HTMLElement;
      if (!target) throw new Error("未找到参考图上传容器");

      const opts: DragEventInit = { bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent("dragenter", opts));
      target.dispatchEvent(new DragEvent("dragover", opts));
      target.dispatchEvent(new DragEvent("drop", opts));
    },
    { b64, name: `ref${ext}`, mime },
  );

  // 等缩略图出现并上传完成（drop 后容器内会渲染 img.image-*）
  await page
    .locator(`${REFERENCE_GROUP_SELECTOR} img[src^="blob:"]`)
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  // 再留时间让上传完成、loading 消失
  await page.waitForTimeout(3000);
  console.log(`✓ 已上传参考图: ${refRelPath}`);
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

  // 前置积分检查：等积分元素渲染后读取，不够本次任务数则直接终止
  await page.waitForTimeout(2000);
  const credit = await readJimengCredit(page);
  if (credit !== null) {
    console.log(`今日可用积分：${credit}，本次需生成 ${tasks.length} 张`);
    if (credit < tasks.length) {
      console.error(`✗✗✗ 即梦积分不足，立即暂停所有流程 ✗✗✗`);
      console.error(`当前可用积分 ${credit}，本次需要至少 ${tasks.length} 张，无法继续生图。`);
      console.error(`请停止后续所有成稿/生图/发布流水线，等待积分恢复或明日再试。`);
      await context.close();
      process.exit(1);
    }
  } else {
    console.log("⚠ 未取到积分数值，跳过积分检查");
  }

  // 先聚焦输入框，再做后续工具栏操作（模式/模型/参数）
  await page.locator(PROMPT_EDITOR_SELECTOR).first().focus();
  await page.waitForTimeout(300);

  // 新会话才需要选模式/模型/参数；已有会话沿用上次设置
  await openModeSelector(page);
  await selectModel(page);
  await configureImageSettings(page);

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
