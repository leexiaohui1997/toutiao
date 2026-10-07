import type { Page } from "playwright";
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";

const WENXIN_HOME = "https://wenxin.baidu.com/";

/**
 * 文心一言（百度 ERNIE）网页操作封装。
 * 所有方法挂在实例上，便于在生图/问答等多个场景复用。
 */
export class Wenxin {
  constructor(public readonly page: Page) {}

  /** 打开文心一言首页 */
  async open(): Promise<void> {
    await this.page.goto(WENXIN_HOME, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`[wenxin] 已打开 ${this.page.url()}`);
  }

  /**
   * 登录检测：
   * 1. 把当前 page 切到前台；
   * 2. 定位 img.chat-aside-avatar-content，若 src 包含 himg.bdimg.com 即视为已登录；
   * 3. 未登录则打印提示并阻塞等待 120s，期间用户完成登录则返回 true；超时仍未登录返回 false。
   */
  async checkLogin(): Promise<boolean> {
    await this.page.bringToFront();

    const avatarImg = this.page.locator("img.chat-aside-avatar-content").first();

    const isLoggedIn = async (): Promise<boolean> => {
      if ((await avatarImg.count()) === 0) return false;
      const src = (await avatarImg.getAttribute("src")) ?? "";
      return src.includes("himg.bdimg.com");
    };

    if (await isLoggedIn()) {
      console.log("[wenxin] 已登录");
      return true;
    }

    console.log("[wenxin] 未登录，请在浏览器中完成登录（扫码/账号），最长等待 120s…");
    try {
      await this.page
        .locator('img.chat-aside-avatar-content[src*="himg.bdimg.com"]')
        .waitFor({ state: "visible", timeout: 120_000 });
      console.log("[wenxin] 登录成功");
      return true;
    } catch {
      console.log("[wenxin] 等待登录超时，仍未登录");
      return false;
    }
  }

  /**
   * 去水印：把本地图片粘贴进输入框，附言"去水印"，发送后等文心一言返回去水印后的图。
   * @param imageRelPath 本地图片路径（相对项目根）
   * @returns 去水印后图片的 URL
   */
  async removeWatermark(imageRelPath: string): Promise<string> {
    await this.page.bringToFront();

    const abs = resolve(process.cwd(), imageRelPath);
    const buf = readFileSync(abs);
    const b64 = buf.toString("base64");
    const ext = extname(abs).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";

    // 1. 聚焦输入框
    const textarea = this.page.locator("textarea#chat-textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 15000 });
    await textarea.focus();

    // 2. 粘贴图片（构造 paste 事件）
    await this.page.evaluate(
      async ({ b64, name, mime }) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const file = new File([arr], name, { type: mime });

        const dt = new DataTransfer();
        dt.items.add(file);

        const ta = document.querySelector("textarea#chat-textarea") as HTMLElement;
        if (!ta) throw new Error("未找到文心一言输入框");
        ta.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      },
      { b64, name: `input${ext}`, mime },
    );
    await this.page.waitForTimeout(1500);

    // 3. 输入"去水印"
    await this.page.keyboard.insertText("去水印");
    await this.page.waitForTimeout(500);

    // 4. 等发送按钮进入可点状态（内部 img 出现 .ci-submit-button-ai-active），再点击
    const sendBtn = this.page.locator("span.ci-submit-button").first();
    await sendBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.page
      .locator("span.ci-submit-button img.ci-submit-button-ai-active")
      .first()
      .waitFor({ state: "visible", timeout: 10000 });
    await sendBtn.click();
    console.log("[wenxin] 已发送去水印请求");
    await this.page.waitForTimeout(2000);

    // 5. 等最新一条 AI 回复里的去水印结果图（该 img 可能不可见，按 attached 等待即可）
    const img = this.page
      .locator(".chat-qa-container div.conversation-flow-answer-container")
      .last()
      .locator("div.cosd-image-scroll img.cos-image-body")
      .first();
    await img.waitFor({ state: "attached", timeout: 180_000 });
    const src = await img.getAttribute("src");
    if (!src) throw new Error("去水印结果图 src 为空");
    console.log(`[wenxin] 去水印完成: ${src}`);
    return src;
  }
}
