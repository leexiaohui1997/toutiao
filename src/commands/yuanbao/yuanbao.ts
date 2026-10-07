import type { Page } from "playwright";
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";

const YUANBAO_HOME = "https://yuanbao.tencent.com/";
/** 输入框：Quill 编辑器 */
const EDITOR_SELECTOR = 'div.ql-editor[contenteditable="true"]';

/**
 * 元宝（腾讯 YuanBao）网页操作封装。
 * 所有方法挂在实例上，便于在生图/问答等多个场景复用。
 */
export class YuanBao {
  constructor(public readonly page: Page) {}

  /** 打开元宝首页 */
  async open(): Promise<void> {
    await this.page.goto(YUANBAO_HOME, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`[yuanbao] 已打开 ${this.page.url()}`);
  }

  /**
   * 登录检测：
   * 1. 把当前 page 切到前台；
   * 2. 定位 `.yb-nav__user .image-container img`，若 src 包含 avatar.yuanbao.tencent.com 即视为已登录；
   * 3. 未登录则打印提示并阻塞等待 120s，期间用户完成登录则返回 true；超时仍未登录返回 false。
   */
  async checkLogin(): Promise<boolean> {
    await this.page.bringToFront();

    const avatarImg = this.page.locator(".yb-nav__user .image-container img").first();

    const isLoggedIn = async (): Promise<boolean> => {
      if ((await avatarImg.count()) === 0) return false;
      const src = (await avatarImg.getAttribute("src")) ?? "";
      return src.includes("avatar.yuanbao.tencent.com");
    };

    if (await isLoggedIn()) {
      console.log("[yuanbao] 已登录");
      return true;
    }

    console.log("[yuanbao] 未登录，请在浏览器中完成登录（扫码/账号），最长等待 120s…");
    try {
      await this.page
        .locator('.yb-nav__user .image-container img[src*="avatar.yuanbao.tencent.com"]')
        .waitFor({ state: "visible", timeout: 120_000 });
      console.log("[yuanbao] 登录成功");
      return true;
    } catch {
      console.log("[yuanbao] 等待登录超时，仍未登录");
      return false;
    }
  }

  /**
   * 生图前置：
   * 1. 切到前台；
   * 2. 切会话：有 sessionId 则打开 /chat/naQivTmsDa/{id}，否则 /chat/naQivTmsDa；
   * 3. 切到 AI 生图模式：输入框操作区里直接有"AI 生图"按钮就点；否则先点"工具"按钮，再在菜单里点"AI 生图"。
   */
  async prepareForImageGeneration(sessionId?: string): Promise<void> {
    await this.page.bringToFront();

    const url = sessionId
      ? `https://yuanbao.tencent.com/chat/naQivTmsDa/${sessionId}`
      : "https://yuanbao.tencent.com/chat/naQivTmsDa";
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`[yuanbao] 已打开会话: ${this.page.url()}`);

    // 输入框操作区容器
    const actions = this.page.locator('div[data-new-input-control="atomic-actions"]').first();
    await actions.waitFor({ state: "visible", timeout: 15000 });

    // 直接有"AI 生图"按钮就点
    const directBtn = actions.locator('button[aria-label="AI 生图"]');
    if ((await directBtn.count()) > 0) {
      await directBtn.first().click();
      console.log("[yuanbao] 已点击 AI 生图（直接按钮）");
    } else {
      // 否则先点"工具"按钮，再在菜单里选"AI 生图"
      await actions.locator('button[aria-label="工具"]').first().click();
      console.log("[yuanbao] 已点击工具按钮，展开菜单");
      const menuItem = this.page.locator('button[role="menuitem"][aria-label="AI 生图"]').first();
      try {
        await menuItem.waitFor({ state: "visible", timeout: 5000 });
      } catch {
        throw new Error("✗ 工具菜单中未找到 AI 生图入口，请检查元宝页面或账号是否具备生图能力");
      }
      await menuItem.click();
      console.log("[yuanbao] 已在工具菜单中选择 AI 生图");
    }
    await this.page.waitForTimeout(500);
  }

  /**
   * 清空输入框内容（保留焦点）。
   */
  async clearPrompt(): Promise<void> {
    const editor = this.page.locator(EDITOR_SELECTOR).first();
    await editor.waitFor({ state: "visible", timeout: 15000 });
    await editor.focus();
    await this.page.waitForTimeout(100);
    await editor.evaluate((el) => {
      el.innerHTML = "";
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await this.page.waitForTimeout(100);
  }

  /**
   * 把提示词填入输入框：先清空，再用键盘插入文本。
   */
  async fillPrompt(prompt: string): Promise<void> {
    await this.clearPrompt();
    await this.page.keyboard.insertText(prompt);
    await this.page.waitForTimeout(500);
    console.log(`[yuanbao] 已输入提示词: ${prompt}`);
  }

  /**
   * 清除已粘贴的参考图附件：列表项可能有多个，逐个 hover 出关闭按钮并点击删除，直到清干净。
   */
  async clearReferenceImages(): Promise<void> {
    const items = this.page.locator(
      'div[class^="FileList_inputFileListItem__"][aria-label^="预览图片"]',
    );
    const total = await items.count();
    if (total === 0) return;

    for (let i = 0; i < total; i++) {
      const item = items.first();
      await item.hover();
      await this.page
        .locator('div[class^="FileList_inputFileListItemClose__"]')
        .first()
        .click();
      await this.page.waitForTimeout(300);
    }
    console.log(`[yuanbao] 已清除 ${total} 张参考图`);
  }

  /**
   * 上传参考图：把图片读成 File，构造 paste 事件直接派发到输入框，
   * 等价于用户把图片复制到剪贴板后在输入框里 Cmd/Ctrl+V。
   */
  async uploadReferenceImage(refRelPath: string): Promise<void> {
    const abs = resolve(process.cwd(), refRelPath);
    const buf = readFileSync(abs);
    const b64 = buf.toString("base64");
    const ext = extname(abs).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";

    await this.page.evaluate(
      async ({ b64, name, mime, editorSelector }) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const file = new File([arr], name, { type: mime });

        const dt = new DataTransfer();
        dt.items.add(file);

        const editor = document.querySelector(editorSelector) as HTMLElement;
        if (!editor) throw new Error("未找到元宝输入框");
        editor.focus();
        editor.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      },
      { b64, name: `ref${ext}`, mime, editorSelector: EDITOR_SELECTOR },
    );
    console.log(`[yuanbao] 已粘贴参考图: ${refRelPath}`);
  }

  /**
   * 点击发送按钮：div#yuanbao-send-btn；禁用时 class 含 SendButton_sendNot__。
   * 等按钮可用（class 不含 SendButton_sendNot__）后点击。
   */
  async clickSend(): Promise<void> {
    const btn = this.page.locator("div#yuanbao-send-btn").first();
    await btn.waitFor({ state: "visible", timeout: 10000 });
    await this.page
      .locator("div#yuanbao-send-btn:not([class*='SendButton_sendNot__'])")
      .first()
      .waitFor({ state: "visible", timeout: 10000 });
    await btn.click();
    console.log("[yuanbao] 已点击发送");
    await this.page.waitForTimeout(2000);
  }

  /**
   * 等最新一条 AI 回复里的出图卡片出现，打印其 data-download-url 并返回。
   * 定位：.agent-chat__list__content 下最后一个 .agent-chat__list__item[data-conv-speaker="ai"]
   *       → 内部第一个 img.dic-card-item__img--loaded。
   */
  async waitForAndGetLatestImage(timeoutMs = 180_000): Promise<string> {
    const img = this.page
      .locator('.agent-chat__list__content .agent-chat__list__item[data-conv-speaker="ai"]')
      .last()
      .locator("img.dic-card-item__img--loaded")
      .first();
    await img.waitFor({ state: "visible", timeout: timeoutMs });
    const url = await img.getAttribute("data-download-url");
    if (!url) throw new Error("最新出图卡片 data-download-url 为空");
    console.log(`[yuanbao] 出图下载地址: ${url}`);
    return url;
  }
}
