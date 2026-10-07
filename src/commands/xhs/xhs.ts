import type { Page } from "playwright";
import { resolve } from "node:path";

const XHS_CREATOR_HOME = "https://creator.xiaohongshu.com/";
const XHS_PUBLISH_PAGE =
  "https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=article";

/**
 * 小红书网页操作封装。所有方法挂在实例上，便于在创建合集/发布笔记等场景复用。
 */
export class Xhs {
  constructor(public readonly page: Page) {}

  /** 打开小红书创作者中心首页 */
  async open(): Promise<void> {
    await this.page.goto(XHS_CREATOR_HOME, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`[xhs] 已打开 ${this.page.url()}`);
  }

  /**
   * 登录检测：goto 创作者中心后会异步重定向——未登录会被跳到 /login。
   * 先主动等 3s 看是否会跳到 /login；跳了就是未登录，等用户登录后 URL 离开 /login。
   */
  async checkLogin(): Promise<boolean> {
    await this.page.bringToFront();

    // 等 3s 看是否会被重定向到 /login
    try {
      await this.page.waitForURL(/\/login/, { timeout: 3000 });
    } catch {
      // 3s 内没跳 login → 已登录
      console.log("[xhs] 已登录");
      return true;
    }

    // 走到这里说明已经跳到 /login，未登录
    console.log("[xhs] 未登录（被重定向到登录页），请在浏览器中完成登录，最长等待 120s…");
    try {
      await this.page.waitForURL((url) => !url.toString().includes("/login"), {
        timeout: 120_000,
      });
      console.log("[xhs] 登录成功");
      return true;
    } catch {
      console.log("[xhs] 等待登录超时，仍未登录");
      return false;
    }
  }

  /**
   * 打开发布/合集创建页。
   * 若页面上已存在"合集标题"卡片（说明同名合集已创建过），返回 false 让上层终止；
   * 否则切到上传模式，返回 true。
   */
  async openPublishPage(existingName?: string): Promise<boolean> {
    await this.page.goto(XHS_PUBLISH_PAGE, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`[xhs] 已打开发布页: ${this.page.url()}`);

    // 前置判断：若 .article-card .top-section 已含同名合集标题，说明合集已创建过
    if (existingName) {
      const existingCard = this.page
        .locator(`.article-card .top-section:has-text("${existingName}")`)
        .first();
      try {
        await existingCard.waitFor({ state: "visible", timeout: 5000 });
        console.log(`[xhs] ✗ 检测到已存在同名合集卡片（"${existingName}"），说明合集已创建，终止`);
        return false;
      } catch {
        // 没找到，说明是新建态，继续
      }
    }

    // 切到上传模式：先找 .create-new-icon，找不到再找 .new-drop-zone
    const createNew = this.page.locator(".create-new-icon").first();
    try {
      await createNew.waitFor({ state: "visible", timeout: 8000 });
      await createNew.click();
      console.log("[xhs] 已点击 .create-new-icon 切换到上传模式");
    } catch {
      const dropZone = this.page.locator(".new-drop-zone").first();
      try {
        await dropZone.waitFor({ state: "visible", timeout: 5000 });
        await dropZone.click();
        console.log("[xhs] 已点击 .new-drop-zone 切换到上传模式");
      } catch {
        console.log("[xhs] 未找到 .create-new-icon / .new-drop-zone，跳过点击");
      }
    }
    return true;
  }

  /** 填写合集/笔记标题 */
  async fillTitle(name: string): Promise<void> {
    const input = this.page.locator('input.d-text[placeholder="请输入标题"]').first();
    await input.waitFor({ state: "visible", timeout: 15000 });
    await input.fill(name);
    console.log(`[xhs] 已填写标题: ${name}`);
  }

  /** 填写合集简介 */
  async fillDesc(desc: string): Promise<void> {
    const ta = this.page.locator('textarea.d-text[placeholder="请输入介绍"]').first();
    await ta.waitFor({ state: "visible", timeout: 15000 });
    await ta.fill(desc);
    console.log(`[xhs] 已填写简介（${desc.length} 字）`);
  }

  /**
   * 上传封面：input.upload-input 是原生 <input type=file>，直接 setFiles；
   * 选完文件会弹裁剪弹窗（div.d-modal），点"确定"关闭，等弹窗消失。
   */
  async uploadCover(relPath: string): Promise<void> {
    const abs = resolve(process.cwd(), relPath);
    const fileInput = this.page.locator("input.upload-input").first();
    await fileInput.waitFor({ state: "attached", timeout: 15000 });
    await fileInput.setInputFiles(abs);
    console.log(`[xhs] 已选择封面文件: ${relPath}`);

    // 等裁剪弹窗出现 → 点"确定"
    const modal = this.page.locator("div.d-modal").first();
    await modal.waitFor({ state: "visible", timeout: 15000 });
    const confirmBtn = modal.locator('button:has-text("确定")').first();
    await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
    await confirmBtn.click();
    console.log("[xhs] 已确认裁剪");

    // 等弹窗消失
    await modal.waitFor({ state: "hidden", timeout: 15000 });
    console.log("[xhs] 裁剪弹窗已关闭");
  }

  /** 点击"创建"按钮（div.new-article-ui 下 button:has-text("创建")），等"创建成功"提示后 reload */
  async clickCreate(): Promise<void> {
    const btn = this.page
      .locator('div.new-article-ui button:has-text("创建")')
      .first();
    await btn.waitFor({ state: "visible", timeout: 15000 });
    await btn.click();
    console.log("[xhs] 已点击创建按钮");

    // 等"创建成功"提示出现
    await this.page
      .locator("text=创建成功")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    console.log("[xhs] 创建成功");

    // reload 页面
    await this.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    console.log("[xhs] 页面已 reload");
  }
}
