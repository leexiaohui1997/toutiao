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

  /**
   * 从合集卡片进入长文笔记编辑器：
   * hover .article-card → 点"管理" → 点"添加长文笔记" → 点"写长文笔记"
   */
  async enterLongArticleEditor(collectionName: string): Promise<void> {
    const card = this.page
      .locator(`.article-card:has-text("${collectionName}")`)
      .first();
    await card.waitFor({ state: "visible", timeout: 15_000 });

    // hover .content-section 才会浮出"管理"按钮
    const contentSection = card.locator(".content-section").first();
    await contentSection.hover();

    const manageBtn = card.locator('button:has-text("管理")').first();
    await manageBtn.waitFor({ state: "visible", timeout: 5_000 });
    await manageBtn.click();
    console.log("[xhs] 已点击 管理");

    const addBtn = this.page.locator('button:has-text("添加长文笔记")').first();
    await addBtn.waitFor({ state: "visible", timeout: 5_000 });
    await addBtn.click();
    console.log("[xhs] 已点击 添加长文笔记");

    const writeBtn = this.page.locator('button:has-text("写长文笔记")').first();
    await writeBtn.waitFor({ state: "visible", timeout: 5_000 });
    await writeBtn.click();
    console.log("[xhs] 已点击 写长文笔记");
  }

  /** 长文编辑器：填标题（fill 后读回验证，失败则 click 聚焦 + 键盘逐字补输入） */
  async fillArticleTitle(title: string): Promise<void> {
    const ta = this.page.locator('textarea[placeholder="输入标题"]').first();
    await ta.waitFor({ state: "visible", timeout: 15_000 });

    // 先 click 聚焦，再 fill
    await ta.click();
    await ta.fill(title);

    // 读回验证：若 value 不对，retry 一次（clear + 键盘逐字输入）
    let val = await ta.inputValue();
    if (val !== title) {
      console.log(`[xhs] 标题 fill 后读回不一致（"${val}"），重试…`);
      await ta.click();
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.press("Backspace");
      await this.page.keyboard.type(title, { delay: 30 });
      val = await ta.inputValue();
    }

    if (val !== title) {
      throw new Error(`标题填充失败：期望 "${title}"，实际 "${val}"`);
    }
    console.log(`[xhs] 已填写文章标题: ${title}`);
  }

  /**
   * 长文编辑器：按 content 块顺序填正文。
   * - title：先点 .edit-page .header .mid button.menu-item 第三个（小标题按钮），再插文字；
   * - text：直接插文字；
   * - image：点 .edit-page .header .mid button.menu-item 第九个（上传图片按钮），用 fileChooser 选文件；
   * 每填完一块（后面还有块）按一次 Enter 换行。
   */
  async fillArticleBody(blocks: Array<{ type: string; content?: string; prompt?: string }>): Promise<void> {
    const editor = this.page
      .locator('.rich-editor-content div.tiptap[contenteditable="true"]')
      .first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.focus();
    console.log(`[xhs] 正文编辑器已聚焦，共 ${blocks.length} 个块`);

    let uploadedImageCount = 0;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const hasNext = i < blocks.length - 1;

      if (block.type === "title") {
        // 点小标题菜单按钮（.edit-page .header .mid .menu-item 第三个）
        const menuBtn = this.page
          .locator(".edit-page .header .mid button.menu-item")
          .nth(2);
        await menuBtn.waitFor({ state: "visible", timeout: 5_000 });
        await menuBtn.click();
        await new Promise((r) => setTimeout(r, 300));
        await this.page.keyboard.insertText(block.content ?? "");
        console.log(`[xhs] [${i + 1}/${blocks.length}] title: ${(block.content ?? "").slice(0, 20)}…`);
      } else if (block.type === "text") {
        await this.page.keyboard.insertText(block.content ?? "");
        console.log(`[xhs] [${i + 1}/${blocks.length}] text: ${(block.content ?? "").slice(0, 20)}…`);
      } else if (block.type === "image") {
        const rel = block.content ?? "";
        if (!rel) throw new Error(`image 块缺 content 路径: #${i + 1}`);
        uploadedImageCount += 1;
        await this.uploadImageViaMenu(rel, uploadedImageCount);
        console.log(`[xhs] [${i + 1}/${blocks.length}] image: ${rel}（已上传 ${uploadedImageCount} 张）`);
      } else {
        console.log(`[xhs] [${i + 1}/${blocks.length}] 未知块类型 ${block.type}，跳过`);
      }

      // 图片块上传后编辑器会自动换行，不用手动 Enter；其他块后面还有内容才手动换行
      if (hasNext && block.type !== "image") {
        await this.page.keyboard.press("Enter");
      }
    }
    console.log("[xhs] 正文填充完成");
  }

  /**
   * 通过点工具栏第 9 个 menu-item 触发系统文件选择框上传图片，
   * 然后等 editor 内 div[data-imgs] 数量达到 expectedCount。
   */
  private async uploadImageViaMenu(relPath: string, expectedCount: number): Promise<void> {
    const abs = resolve(process.cwd(), relPath);

    // 先监听 filechooser，再点按钮
    const [fileChooser] = await Promise.all([
      this.page.waitForEvent("filechooser", { timeout: 10_000 }),
      this.page
        .locator(".edit-page .header .mid button.menu-item")
        .nth(8)
        .click(),
    ]);
    await fileChooser.setFiles(abs);
    console.log(`[xhs] 已通过文件选择框上传: ${relPath}`);

    // 等编辑器里 div[data-imgs] 数量达到 expectedCount（最长 30s，每 500ms 轮询一次）
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const n = await this.page.locator(".rich-editor-content div[data-imgs]").count();
      if (n >= expectedCount) {
        console.log(`[xhs] 图片已渲染：editor 内 div[data-imgs]=${n}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `等待图片上传超时：期望 editor 内 div[data-imgs] >= ${expectedCount}，但 30s 内未达到`,
    );
  }

  /**
   * 正文填完后：点"一键排版" → 点"下一步" → 若有 tags 则在 tags 输入框里填话题。
   * @param tags 形如 ["#话题1#", "#话题2#"]，空格拼接成 "#话题1# #话题2#"；空数组则跳过输入
   */
  async finishAndAddTags(tags: string[]): Promise<void> {
    // 1. 点"一键排版"
    const oneKeyBtn = this.page.locator('button:has-text("一键排版")').first();
    await oneKeyBtn.waitFor({ state: "visible", timeout: 15_000 });
    await oneKeyBtn.click();
    console.log("[xhs] 已点击 一键排版");
    await new Promise((r) => setTimeout(r, 1000));

    // 2. 等"下一步"按钮出现并点击
    const nextBtn = this.page.locator('button:has-text("下一步")').first();
    await nextBtn.waitFor({ state: "visible", timeout: 15_000 });
    await nextBtn.click();
    console.log("[xhs] 已点击 下一步");

    // 3. 有 tags 才填；没有则跳过
    if (!tags || tags.length === 0) {
      console.log("[xhs] 无 tags，跳过话题输入");
      return;
    }

    // 等 tags 输入框（.tiptap-container 下的 div[contenteditable=true]）出现，聚焦后输入
    const tagEditor = this.page
      .locator(".tiptap-container div[contenteditable='true']")
      .first();
    await tagEditor.waitFor({ state: "visible", timeout: 0 });
    await tagEditor.focus();
    // 小红书 tags 格式：左 # 开头、结尾不带 #；article.json 里是 "#话题#"，去掉结尾 #
    const tagsText = tags.map((t) => t.replace(/#\s*$/, "")).join(" ");
    await this.page.keyboard.insertText(tagsText);
    console.log(`[xhs] 已输入 tags: ${tagsText}`);
  }

  /**
   * 发布前最后两步：
   * 1. 点"选择合集" → 在 popover 里点当前合集名；
   * 2. 点 .custom-switch-switch 勾选原创；若弹确认 modal，先勾 checkbox-simulator，再点"声明原创"。
   */
  async selectCollectionAndOriginal(collectionName: string): Promise<void> {
    // 1. 点"选择合集"
    const selectBtn = this.page
      .locator('.collection-plugin-button:has-text("选择合集")')
      .first();
    await selectBtn.waitFor({ state: "visible", timeout: 15_000 });
    await selectBtn.click();
    console.log("[xhs] 已点击 选择合集");

    // 在 popover 里点合集名
    const collectionItem = this.page
      .locator(`.collection-plugin-popover-content .item:has-text("${collectionName}")`)
      .first();
    await collectionItem.waitFor({ state: "visible", timeout: 10_000 });
    await collectionItem.click();
    console.log(`[xhs] 已选择合集: ${collectionName}`);

    // 2. 点原创开关
    const origSwitch = this.page.locator(".custom-switch-switch").first();
    await origSwitch.waitFor({ state: "visible", timeout: 10_000 });
    await origSwitch.click();
    console.log("[xhs] 已点击原创声明开关");

    // 若弹确认 modal：先勾 checkbox-simulator，再点"声明原创"按钮
    const modal = this.page.locator("div.d-modal").first();
    try {
      await modal.waitFor({ state: "visible", timeout: 3_000 });
      const checkbox = modal.locator(".d-checkbox-simulator").first();
      await checkbox.waitFor({ state: "visible", timeout: 3_000 });
      await checkbox.click();
      console.log("[xhs] 已勾选原创确认弹窗的 checkbox");

      const confirmBtn = modal
        .locator('button:not(.disabled):has-text("声明原创")')
        .first();
      await confirmBtn.waitFor({ state: "visible", timeout: 5_000 });
      await confirmBtn.click();
      console.log('[xhs] 已点击"声明原创"确认按钮');

      // 等 modal 关闭
      await modal.waitFor({ state: "hidden", timeout: 10_000 });
    } catch {
      console.log("[xhs] 未弹出原创确认 modal，跳过");
    }
  }

  /** 点"发布"按钮，等"发布成功"提示出现 */
  async clickPublish(): Promise<void> {
    const btn = this.page.locator('button:has-text("发布")').first();
    await btn.waitFor({ state: "visible", timeout: 15_000 });
    await btn.click();
    console.log("[xhs] 已点击 发布");

    await this.page
      .locator("text=发布成功")
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });
    console.log("[xhs] ✓ 发布成功");
  }
}
