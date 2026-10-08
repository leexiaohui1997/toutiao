import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { Command } from "commander";
import { launchPersistentContext } from "../../browser.js";
import { Bilibili } from "./bilibili.js";

/**
 * `bilibili publish` 命令：从 article.json 在 B 站发布图文笔记。
 */
export function registerBilibiliPublishCommand(biliCmd: Command): void {
  biliCmd
    .command("publish")
    .description("从 article.json 在 B 站发布图文笔记")
    .requiredOption("-f, --file <path>", "article.json 路径")
    .option("--headless", "无头模式", false)
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .action(async (opts: { file: string; headless: boolean; userDataDir?: string }) => {
      const articlePath = resolve(process.cwd(), opts.file);
      console.log(`[bilibili publish] file=${articlePath} headless=${opts.headless}`);

      const article: any = JSON.parse(await readFile(articlePath, "utf-8"));

      // 已发布过则直接退出
      if (article.bilibiliPublish === true) {
        console.log("✗ article.bilibiliPublish 已为 true（B 站已发布过），跳过");
        process.exit(0);
      }

      // 从 article.json 反推 overview.json
      const overviewPath = join(dirname(articlePath), "..", "overview.json");
      let overview: any = {};
      try {
        overview = JSON.parse(await readFile(overviewPath, "utf-8"));
      } catch {}

      // ===== 前置字段校验 =====
      const errors: string[] = [];
      if (!article.title) errors.push("缺 title（文章标题）");
      if (!article.content || !Array.isArray(article.content)) errors.push("缺 content 数组");
      if (!overview.collectionName) errors.push("overview.json 缺 collectionName（文集名）");
      if (!overview.bilibiliCollectionId) errors.push("overview.json 缺 bilibiliCollectionId，请先执行 bilibili create-collection");
      const coverPath: string | undefined = article.bilibiliCover || article.cover;
      if (!coverPath) {
        errors.push("缺 bilibiliCover / cover（封面路径）");
      } else if (!existsSync(resolve(process.cwd(), coverPath))) {
        errors.push(`封面文件不存在: ${coverPath}`);
      }
      if (errors.length > 0) {
        console.error("✗ article.json 校验失败：");
        errors.forEach((e) => console.error(`  - ${e}`));
        process.exit(1);
      }

      const context = await launchPersistentContext({
        headless: opts.headless,
        userDataDir: opts.userDataDir,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      const bili = new Bilibili(page);

      await bili.open();
      const loggedIn = await bili.checkLogin();
      if (!loggedIn) {
        console.error("✗ B 站未登录，退出");
        await context.close();
        process.exit(1);
      }

      // 打开图文编辑器
      await bili.openArticleEditor();

      // 选文集（在封面操作之前）
      await bili.selectCollection(overview.collectionName);

      // 开启自定义封面开关 → 上传封面
      await bili.enableCustomCover();
      await bili.uploadCustomCover(coverPath!);

      // 开启精选评论 + 勾选创作声明
      await bili.enableFeaturedComments();
      await bili.checkAllCreationDeclarations();

      // 填标题 + 正文 + 标签
      await bili.fillArticleTitle(article.title);
      await bili.fillArticleBody(article.content);
      await bili.appendTags(article.tags);

      // 点发布
      await bili.clickPublish();

      // 发布成功，回填 article.bilibiliPublish = true
      article.bilibiliPublish = true;
      await writeFile(articlePath, JSON.stringify(article, null, 2) + "\n", "utf-8");
      console.log("[bilibili] 已回填 article.bilibiliPublish = true");

      await context.close();
    });
}
