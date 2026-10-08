import type { Page } from "playwright";
import { resolve, basename, extname } from "node:path";
import { readFile } from "node:fs/promises";

const BILIBILI_HOME = "https://www.bilibili.com/";
const OPUS_MANAGER_URL = "https://member.bilibili.com/opus/management/collections";
const YORK_EDITOR_URL = "https://member.bilibili.com/york/read-editor";

/**
 * B 站网页操作封装。所有方法挂在实例上，便于在创建合集/发布视频等场景复用。
 */
export class Bilibili {
  constructor(public readonly page: Page) {}

  /** 打开 B 站首页 */
  async open(): Promise<void> {
    await this.page.goto(BILIBILI_HOME, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`[bilibili] 已打开 ${this.page.url()}`);
  }

  /**
   * 登录检测：`.header-avatar-wrap--container img` 的 src 包含 `/bfs/face/` 即已登录。
   * 未登录则等用户自行扫码，最长 120s。
   */
  async checkLogin(): Promise<boolean> {
    await this.page.bringToFront();

    const loggedInAvatar = this.page
      .locator('.header-avatar-wrap--container img[src*="/bfs/face/"]')
      .first();

    // 先等 5s 看头像是否已经存在
    try {
      await loggedInAvatar.waitFor({ state: "visible", timeout: 5_000 });
      console.log("[bilibili] 已登录");
      return true;
    } catch {
      // 不存在 → 未登录，等用户登录
    }

    console.log("[bilibili] 未登录，请在浏览器中完成登录，最长等待 120s…");
    try {
      await loggedInAvatar.waitFor({ state: "visible", timeout: 120_000 });
      console.log("[bilibili] 登录成功");
      return true;
    } catch {
      console.log("[bilibili] 等待登录超时，仍未登录");
      return false;
    }
  }

  /** 打开文集管理页 */
  async openOpusManager(): Promise<void> {
    await this.page.goto(OPUS_MANAGER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    console.log(`[bilibili] 已打开文集管理页: ${this.page.url()}`);
  }

  /**
   * 检查同名文集是否已存在：.collection-card 下的 h3 包含合集名。
   * 存在则 hover .collection-card__info 并点击进入详情页，从 URL 提取 id 返回；
   * 不存在返回 null。
   */
  async checkExistingCollection(name: string): Promise<number | null> {
    const card = this.page
      .locator(`.collection-card:has(h3:has-text("${name}"))`)
      .first();
    try {
      await card.waitFor({ state: "visible", timeout: 5_000 });
    } catch {
      return null;
    }
    console.log(`[bilibili] 检测到已存在同名文集"${name}"，进入详情页…`);

    const info = card.locator(".collection-card__info").first();
    await info.hover();
    await info.click();

    // 等路由跳到 /opus/management/collection/{id}
    await this.page.waitForURL(/\/opus\/management\/collection\/(\d+)/, { timeout: 15_000 });
    const m = this.page.url().match(/\/opus\/management\/collection\/(\d+)/);
    const id = m ? Number(m[1]) : NaN;
    if (!id) throw new Error(`无法从 URL 解析合集 id: ${this.page.url()}`);
    console.log(`[bilibili] ✓ 已进入已有文集，合集 id = ${id}`);
    return id;
  }

  /** 点"创建文集"按钮 */
  async clickCreateCollectionButton(): Promise<void> {
    const btn = this.page
      .locator('.collection-list .header .vui_button:has-text("创建文集")')
      .first();
    await btn.waitFor({ state: "visible", timeout: 15_000 });
    await btn.click();
    console.log('[bilibili] 已点击"创建文集"');
  }

  /** 填文集标题 */
  async fillCollectionTitle(title: string): Promise<void> {
    const input = this.page.locator("input.vui_input__input").first();
    await input.waitFor({ state: "visible", timeout: 15_000 });
    await input.fill(title);
    console.log(`[bilibili] 已填写文集标题: ${title}`);
  }

  /** 填文集简介 */
  async fillCollectionDesc(desc: string): Promise<void> {
    const ta = this.page.locator("textarea.collection-form__input").first();
    await ta.waitFor({ state: "visible", timeout: 15_000 });
    await ta.fill(desc);
    console.log(`[bilibili] 已填写文集简介（${desc.length} 字）`);
  }

  /**
   * 上传文集封面：.collection-cover-upload 下的 input[type=file] 直接 setInputFiles；
   * 上传后会弹裁剪弹窗，点"确定"关闭。
   */
  async uploadCollectionCover(relPath: string): Promise<void> {
    const abs = resolve(process.cwd(), relPath);
    const fileInput = this.page
      .locator(".collection-cover-upload input[type=file]")
      .first();
    await fileInput.waitFor({ state: "attached", timeout: 15_000 });
    await fileInput.setInputFiles(abs);
    console.log(`[bilibili] 已选择封面: ${relPath}`);

    // 等裁剪弹窗出现 → 点"确定"
    const dialog = this.page.locator(".vui_dialog--content").first();
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    const confirmBtn = dialog.locator('.vui_button:has-text("确定")').first();
    await confirmBtn.waitFor({ state: "visible", timeout: 10_000 });
    await confirmBtn.click();
    console.log('[bilibili] 已确认裁剪（点了"确定"）');

    // 等弹窗关闭
    await dialog.waitFor({ state: "hidden", timeout: 15_000 });
    console.log("[bilibili] 裁剪弹窗已关闭");
  }

  /**
   * 封面上传完成后（.collection-cover-upload .cover 不再有 .empty），
   * 等 2s 再点"确认创建"。
   */
  async clickConfirmCreate(): Promise<void> {
    // 等封面预览出现：.collection-cover-upload .cover 节点不带 .empty
    const coverPreview = this.page
      .locator(".collection-cover-upload .cover:not(.empty)")
      .first();
    await coverPreview.waitFor({ state: "visible", timeout: 0 });
    console.log("[bilibili] 封面预览已出现（.cover 不再 empty）");

    // 再等 2s 让表单状态稳定
    await new Promise((r) => setTimeout(r, 2_000));

    const btn = this.page
      .locator('.vui_button:not(.vui_button--disabled):has-text("确认创建")')
      .first();
    await btn.waitFor({ state: "visible", timeout: 15_000 });
    await btn.click();
    console.log('[bilibili] 已点击"确认创建"');
  }

  /**
   * 点完"确认创建"后，等路由跳到 /opus/management/collection/{id}，
   * 从 URL 提取合集 id 返回。
   */
  async waitForCollectionCreated(): Promise<number> {
    await this.page.waitForURL(/\/opus\/management\/collection\/(\d+)/, {
      timeout: 30_000,
    });
    const m = this.page.url().match(/\/opus\/management\/collection\/(\d+)/);
    const id = m ? Number(m[1]) : NaN;
    if (!id) throw new Error(`无法从 URL 解析合集 id: ${this.page.url()}`);
    console.log(`[bilibili] ✓ 创建成功，合集 id = ${id}`);
    return id;
  }

  /** 打开图文（york）编辑器 */
  async openArticleEditor(): Promise<void> {
    await this.page.goto(YORK_EDITOR_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    console.log(`[bilibili] 已打开图文编辑器: ${this.page.url()}`);
  }

  /**
   * 选择文集：
   * 1. 点 button:has-text("选择文集")；
   * 2. 等 .vui_dialog--body 下 .collection-list 出现；
   * 3. 在 .collection-list 里找 label[role=radio]:has-text(合集名)，有则点，无则报错；
   * 4. 点 .vui_dialog--footer 下 button:has-text("确定"):not(.vui_button--disabled)。
   */
  async selectCollection(name: string): Promise<void> {
    const openBtn = this.page.locator('button:has-text("选择文集")').first();
    await openBtn.waitFor({ state: "visible", timeout: 15_000 });
    await openBtn.click();
    console.log('[bilibili] 已点击"选择文集"');

    // 等弹窗里的 collection-list
    const dialogBody = this.page.locator(".vui_dialog--body").first();
    const list = dialogBody.locator(".collection-list").first();
    await list.waitFor({ state: "visible", timeout: 10_000 });

    // 找对应文集的 radio
    const radio = list.locator(`label[role=radio]:has-text("${name}")`).first();
    try {
      await radio.waitFor({ state: "visible", timeout: 5_000 });
    } catch {
      throw new Error(`在文集列表中未找到名为"${name}"的文集，请先执行 bilibili create-collection 创建`);
    }
    await radio.dispatchEvent("click");
    console.log(`[bilibili] 已勾选文集: ${name}`);

    // 点确定
    const footer = this.page.locator(".vui_dialog--footer").first();
    const confirmBtn = footer
      .locator('button:has-text("确定"):not(.vui_button--disabled)')
      .first();
    await confirmBtn.waitFor({ state: "visible", timeout: 5_000 });
    await confirmBtn.click();
    console.log('[bilibili] 已确认选择文集');

    // 等弹窗关闭
    await footer.waitFor({ state: "hidden", timeout: 10_000 });
  }

  /**
   * 开启"自定义封面"开关：
   * 定位 .form-item:has-text("自定义封面") 下的 .vui_switch--switch，点击；
   * 等 .select-cover 区域出现。
   */
  async enableCustomCover(): Promise<void> {
    const formItem = this.page
      .locator('.form-item:has-text("自定义封面")')
      .first();
    await formItem.waitFor({ state: "visible", timeout: 15_000 });
    const sw = formItem.locator(".vui_switch--switch").first();
    await sw.click();
    console.log("[bilibili] 已点击 自定义封面 开关");

    // 等 .select-cover 上传区出现
    const selectCover = this.page.locator(".select-cover").first();
    await selectCover.waitFor({ state: "visible", timeout: 10_000 });
    console.log("[bilibili] .select-cover 区域已出现");
  }

  /**
   * 上传自定义封面：
   * 1. 点 .select-cover → 弹出选项菜单；
   * 2. 点 .select-option:has-text("本地上传") → 触发文件选择弹窗；
   * 3. fileChooser.setFiles。
   */
  async uploadCustomCover(relPath: string): Promise<void> {
    const abs = resolve(process.cwd(), relPath);

    // 先监听 filechooser，再点 .select-cover → 点"本地上传"
    const [fileChooser] = await Promise.all([
      this.page.waitForEvent("filechooser", { timeout: 10_000 }),
      (async () => {
        const selectCover = this.page.locator(".select-cover").first();
        await selectCover.click();
        console.log("[bilibili] 已点击 .select-cover");

        const localOpt = this.page
          .locator('.select-option:has-text("本地上传")')
          .first();
        await localOpt.waitFor({ state: "visible", timeout: 5_000 });
        await localOpt.click();
        console.log('[bilibili] 已点击"本地上传"');
      })(),
    ]);
    await fileChooser.setFiles(abs);
    console.log(`[bilibili] 已上传自定义封面: ${relPath}`);

    // 等裁剪弹窗出现 → 点 .vui_dialog--footer 下的"确定"
    const dialog = this.page.locator(".vui_dialog--footer").first();
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    const confirmBtn = dialog.locator('button:has-text("确定")').first();
    await confirmBtn.waitFor({ state: "visible", timeout: 10_000 });
    await confirmBtn.click();
    console.log('[bilibili] 已确认裁剪（点了"确定"）');

    // 等弹窗关闭
    await dialog.waitFor({ state: "hidden", timeout: 15_000 });
    console.log("[bilibili] 裁剪弹窗已关闭");

    // 等 1s 让封面上传状态开始流转
    await new Promise((r) => setTimeout(r, 1_000));

    // 轮询等 .selected-cover 下不再有"上传中"文字
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const uploading = await this.page
        .locator('.selected-cover:has-text("上传中")')
        .count();
      if (uploading === 0) {
        console.log('[bilibili] 封面上传完成（.selected-cover 已无"上传中"）');
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('等待封面上传完成超时（30s 内 .selected-cover 仍显示"上传中"）');
  }

  /** 开启"精选评论"开关 */
  async enableFeaturedComments(): Promise<void> {
    const formItem = this.page
      .locator('.form-item:has-text("精选评论")')
      .first();
    await formItem.waitFor({ state: "visible", timeout: 15_000 });
    const sw = formItem.locator(".vui_switch--switch").first();
    await sw.click();
    console.log("[bilibili] 已点击 精选评论 开关");
  }

  /** 勾选"创作声明"下所有 label[role=checkbox] */
  async checkAllCreationDeclarations(): Promise<void> {
    const formItem = this.page
      .locator('.form-item:has-text("创作声明")')
      .first();
    await formItem.waitFor({ state: "visible", timeout: 15_000 });
    const boxes = formItem.locator("label[role=checkbox]");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      // 直接在 label 上派发 click 事件，避免 Playwright 点到 label 内的文字/span 子元素
      await boxes.nth(i).dispatchEvent("click");
      console.log(`[bilibili] 已勾选创作声明选项 ${i + 1}/${n}`);
    }
  }

  /** 填文章标题：textarea[placeholder^=请输入标题] */
  async fillArticleTitle(title: string): Promise<void> {
    const ta = this.page.locator('textarea[placeholder^="请输入标题"]').first();
    await ta.waitFor({ state: "visible", timeout: 15_000 });
    await ta.click();
    await ta.fill(title);

    // 读回验证，失败则键盘逐字输入
    let val = await ta.inputValue();
    if (val !== title) {
      console.log(`[bilibili] 标题 fill 后读回不一致（"${val}"），重试…`);
      await ta.click();
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.press("Backspace");
      await this.page.keyboard.type(title, { delay: 30 });
      val = await ta.inputValue();
    }
    if (val !== title) {
      throw new Error(`标题填充失败：期望 "${title}"，实际 "${val}"`);
    }
    console.log(`[bilibili] 已填写文章标题: ${title}`);
  }

  /**
   * 填正文：
   * - title 块：行首输入 "## " + 空格触发 TipTap markdown 规则转 H2；
   * - text 块：直接 insertText；
   * - image 块：把图片文件读成 buffer，在编辑器上 dispatch paste 事件（DataTransfer 带 File）。
   */
  async fillArticleBody(blocks: Array<{ type: string; content?: string; prompt?: string }>): Promise<void> {
    const editor = this.page
      .locator('div.tiptap[contenteditable="true"]')
      .first();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await editor.click();
    await editor.focus();
    console.log(`[bilibili] 正文编辑器已聚焦，共 ${blocks.length} 个块`);

    // 清空编辑器内已有内容（避免开头多空行）
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");
    await new Promise((r) => setTimeout(r, 300));

    // 先拿到当前已有的 img 数量，作为基准
    let uploadedImageCount = await this.page.locator("div.tiptap img").count();
    console.log(`[bilibili] 当前编辑器内已有图片: ${uploadedImageCount} 张`);

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const hasNext = i < blocks.length - 1;

      if (block.type === "title") {
        // 行首 "## " + 空格 → TipTap markdown 规则转 H2
        await this.page.keyboard.insertText("## ");
        await this.page.keyboard.press(" ");
        await this.page.keyboard.insertText(block.content ?? "");
        console.log(`[bilibili] [${i + 1}/${blocks.length}] title: ${(block.content ?? "").slice(0, 20)}…`);
      } else if (block.type === "text") {
        await this.page.keyboard.insertText(block.content ?? "");
        console.log(`[bilibili] [${i + 1}/${blocks.length}] text: ${(block.content ?? "").slice(0, 20)}…`);
      } else if (block.type === "image") {
        const rel = block.content ?? "";
        if (!rel) throw new Error(`image 块缺 content 路径: #${i + 1}`);
        const abs = resolve(process.cwd(), rel);
        await this.pasteImageIntoEditor(abs);
        uploadedImageCount += 1;
        console.log(`[bilibili] [${i + 1}/${blocks.length}] image: ${rel}（已粘贴，等待上传完成）`);

        // 1. 等新的 .eva3-image-box 出现（数量达到 uploadedImageCount）
        let deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const n = await this.page.locator("div.tiptap .eva3-image-box").count();
          if (n >= uploadedImageCount) break;
          await new Promise((r) => setTimeout(r, 300));
        }

        // 2. 等所有 .eva3-image-box 都不再包含 .eva3-loading（上传完成）
        deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const loading = await this.page
            .locator("div.tiptap .eva3-image-box:has(.eva3-loading)")
            .count();
          if (loading === 0) {
            console.log(`[bilibili] 图片上传完成（所有 .eva3-image-box 均无 .eva3-loading）`);
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      } else {
        console.log(`[bilibili] [${i + 1}/${blocks.length}] 未知块类型 ${block.type}，跳过`);
      }

      // 图片块上传后自动换行，不用手动 Enter；其他块后面还有内容才按 Enter
      if (hasNext && block.type !== "image") {
        await this.page.keyboard.press("Enter");
      }
    }
    console.log("[bilibili] 正文填充完成");
  }

  /**
   * 在正文编辑器末尾另起一行填标签（article.json tags 已是 "#话题#" 格式，B 站同样首尾 #）。
   */
  async appendTags(tags: string[]): Promise<void> {
    if (!tags || tags.length === 0) {
      console.log("[bilibili] 无 tags，跳过");
      return;
    }
    // 末尾新起一行
    await this.page.keyboard.press("Enter");
    const text = tags.join(" ");
    await this.page.keyboard.insertText(text);
    console.log(`[bilibili] 已在正文末尾填写标签: ${text}`);
  }

  /**
   * 把本地图片文件通过合成 paste 事件粘进编辑器。
   * 读文件成 buffer → 在浏览器里 new File → DataTransfer → ClipboardEvent("paste") dispatch 到编辑器。
   */
  private async pasteImageIntoEditor(absPath: string): Promise<void> {
    const buf = await readFile(absPath);
    const ext = extname(absPath).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    const filename = basename(absPath);
    // Buffer 转 Uint8Array 才能结构化克隆到浏览器上下文
    const u8 = new Uint8Array(buf);

    await this.page.evaluate(
      async ({ bytes, name, type }) => {
        const editor = document.querySelector('div.tiptap[contenteditable="true"]') as HTMLElement;
        if (!editor) throw new Error("未找到正文编辑器 div.tiptap");
        editor.focus();
        const blob = new Blob([bytes], { type });
        const file = new File([blob], name, { type });
        const dt = new DataTransfer();
        dt.items.add(file);
        const evt = new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        editor.dispatchEvent(evt);
      },
      { bytes: u8, name: filename, type: mime },
    );
  }

  /** 点 .footer-right 下的"发布"按钮，等"你的专栏已提交成功"提示出现 */
  async clickPublish(): Promise<void> {
    const btn = this.page
      .locator('.footer-right button:has-text("发布")')
      .first();
    await btn.waitFor({ state: "visible", timeout: 15_000 });
    await btn.click();
    console.log('[bilibili] 已点击"发布"');

    await this.page
      .locator("text=你的专栏已提交成功")
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });
    console.log('[bilibili] ✓ 检测到"你的专栏已提交成功"，发布成功');
  }
}
