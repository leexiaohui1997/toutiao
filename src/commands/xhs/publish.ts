import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import type { Command } from "commander";
import { launchPersistentContext } from "../../browser.js";
import { Xhs } from "./xhs.js";

const XHS_PUBLISH_PAGE =
  "https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=article";

/**
 * `xhs publish` 命令：从 article.json 在小红书发布图文笔记。
 */
export function registerXhsPublishCommand(xhsCmd: Command): void {
  xhsCmd
    .command("publish")
    .description("从 article.json 在小红书发布笔记")
    .requiredOption("-f, --file <path>", "article.json 路径")
    .option("--headless", "无头模式", false)
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .action(async (opts: { file: string; headless: boolean; userDataDir?: string }) => {
      const articlePath = resolve(process.cwd(), opts.file);
      console.log(`[xhs publish] file=${articlePath} headless=${opts.headless}`);

      const article: any = JSON.parse(await readFile(articlePath, "utf-8"));

      // 已发布过则直接退出
      if (article.xhsPublish === true) {
        console.log("✗ article.xhsPublish 已为 true（小红书已发布过），跳过");
        process.exit(0);
      }

      // 从 article.json 路径反推 overview.json（docs/{书名}/第N篇/article.json → docs/{书名}/overview.json）
      const overviewPath = join(dirname(dirname(articlePath)), "overview.json");
      let overview: any;
      try {
        overview = JSON.parse(await readFile(overviewPath, "utf-8"));
      } catch {
        console.error(`✗ 找不到 overview.json: ${overviewPath}`);
        process.exit(1);
      }

      // ===== 前置字段校验 =====
      const errors: string[] = [];
      if (!overview.collectionName) errors.push("overview.json 缺 collectionName（合集名）");
      if (!overview.xhsCreated) errors.push("overview.json 的 xhsCreated 为 false，请先执行 xhs create-collection 创建小红书合集");
      if (!article.title) errors.push("article.json 缺 title（标题）");
      if (!article.content || !Array.isArray(article.content)) errors.push("article.json 缺 content 数组");

      if (errors.length > 0) {
        console.error("✗ 校验失败：");
        errors.forEach((e) => console.error(`  - ${e}`));
        process.exit(1);
      }

      const context = await launchPersistentContext({
        headless: opts.headless,
        userDataDir: opts.userDataDir,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      const xhs = new Xhs(page);

      await xhs.open();
      const loggedIn = await xhs.checkLogin();
      if (!loggedIn) {
        console.error("✗ 小红书未登录，退出");
        await context.close();
        process.exit(1);
      }

      // 打开发布页
      await page.goto(XHS_PUBLISH_PAGE, { waitUntil: "domcontentloaded", timeout: 30_000 });
      console.log(`[xhs] 已打开发布页: ${page.url()}`);

      // 检测同名合集是否存在：.article-card .top-section 下应含 collectionName
      const collectionName: string = overview.collectionName;
      const existingCard = page
        .locator(`.article-card .top-section:has-text("${collectionName}")`)
        .first();
      try {
        await existingCard.waitFor({ state: "visible", timeout: 15_000 });
        console.log(`[xhs] ✓ 合集"${collectionName}"已存在，可以继续发布`);
      } catch {
        console.error(`✗ 未检测到合集"${collectionName}"，请先执行 xhs create-collection 创建合集`);
        await context.close();
        process.exit(1);
      }

      // hover 合集卡片 → 管理 → 添加长文笔记 → 写长文笔记
      await xhs.enterLongArticleEditor(collectionName);

      // 填标题 + 正文
      await xhs.fillArticleTitle(article.title);
      await xhs.fillArticleBody(article.content);

      // 一键排版 → 下一步 → 填 tags
      await xhs.finishAndAddTags(article.tags);

      // 选合集 + 勾选原创
      await xhs.selectCollectionAndOriginal(collectionName);

      // 点发布，等"发布成功"
      await xhs.clickPublish();

      // 发布成功，回填 article.xhsPublish = true
      article.xhsPublish = true;
      await writeFile(articlePath, JSON.stringify(article, null, 2), "utf-8");
      console.log("[xhs] 已回填 article.xhsPublish = true");
      await context.close();
    });
}
