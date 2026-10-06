import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { Command } from "commander";
import { launchPersistentContext } from "../browser.js";
import { ensureLogin } from "../toutiao/auth.js";
import { fillArticle, fillTags, openPublishPage, type ArticleBlock } from "../toutiao/editor.js";
import { fillMainTitle, uploadCover, setLocation, setCollection, publish, CollectionLockedError } from "../toutiao/meta.js";
import { compressDir } from "./compress.js";

/**
 * `edit` 命令：按 JSON 文件填充文章编辑区。
 *
 * JSON 格式：
 * {
 *   "title": "主标题",            // 可选，顶部文章标题
 *   "cover": "/path/to/cover.png",// 可选，封面图（单图模式）
 *   "location": "深圳",           // 可选，添加位置
 *   "collection": "合集名",        // 可选，从已有合集中选择
 *   "content": [
 *     { "type": "title" | "text" | "image", "content": "..." }
 *   ]
 * }
 */
interface ArticleJson {
  title?: string;
  cover?: string;
  location?: string;
  collection?: string;
  content: ArticleBlock[];
  tags?: string[];
}

export function registerEditCommand(program: Command): void {
  program
    .command("edit")
    .description("按 JSON 填充文章编辑区（不自动发布）")
    .requiredOption("-f, --file <path>", "文章 JSON 文件路径")
    .option("--headless", "无头模式运行（完成后自动截图退出）", false)
    .option("--publish", "填充完成后自动点发布（预览并发布 → 确认发布）", false)
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .action(async (opts: { file: string; headless: boolean; userDataDir?: string; publish: boolean }) => {
      // 1. 读 JSON
      const jsonPath = resolve(process.cwd(), opts.file);
      let data: ArticleJson;
      try {
        const raw = await readFile(jsonPath, "utf-8");
        const parsed = JSON.parse(raw);
        data = Array.isArray(parsed) ? { content: parsed } : parsed;
      } catch (err) {
        console.error(`读取/解析 JSON 失败: ${(err as Error).message}`);
        process.exit(1);
      }
      if (!Array.isArray(data.content) || data.content.length === 0) {
        console.error('JSON 格式错误：{ "content": [{type, content}, ...] }');
        process.exit(1);
      }
      console.log(`已读取 ${data.content.length} 个正文块（${jsonPath}）`);

      // 1.5 发布前压缩该文章目录下所有图片
      const articleDir = dirname(jsonPath);
      console.log("压缩文章目录图片…");
      await compressDir(articleDir);

      // 2. 启动浏览器并确保登录
      const context = await launchPersistentContext({
        headless: opts.headless,
        userDataDir: opts.userDataDir,
      });
      const page = context.pages()[0] ?? (await context.newPage());

      let loggedIn = false;
      try {
        loggedIn = await ensureLogin(context, { page });
      } catch (err) {
        console.error("登录检查出错:", (err as Error).message);
      }
      if (!loggedIn) {
        console.error("未登录，退出。请先运行 `pnpm dev login` 扫码。");
        await context.close().catch(() => undefined);
        process.exit(1);
      }

      // 3. 填充流程（合集 disabled 时自动等待重发）
      try {
        for (let attempt = 1; ; attempt++) {
          console.log("打开发布文章页…");
          await openPublishPage(page);

          // 0. 检测每日发文上限弹窗
          const limitModal = page.locator('.byte-modal-title:has-text("无法发布")');
          if (await limitModal.isVisible().catch(() => false)) {
            const msg = await page.locator(".byte-modal-content").first().textContent().catch(() => "");
            console.error(`\n✗ ${msg?.trim() || "今日发文已达上限"}`);
            console.error("✗ 今日不再继续发文，退出。\n");
            await context.close().catch(() => undefined);
            process.exit(2);
          }

          // 3.1 合集（第一步，检测是否 disabled）
          if (data.collection) {
            console.log(`选择合集：${data.collection}`);
            try {
              await setCollection(page, data.collection);
            } catch (err) {
              if (err instanceof CollectionLockedError) {
                console.log(err.message);
                // 去合集列表页轮询，等"已发布"卡片出现
                console.log("前往合集列表页等待…");
                await page.goto("https://mp.toutiao.com/profile_v4/graphic/collections", {
                  waitUntil: "domcontentloaded",
                  timeout: 30000,
                });
                const deadline = Date.now() + 10 * 60 * 1000; // 最多等10分钟
                while (Date.now() < deadline) {
                  const found = await page
                    .locator(".collection-card-item:has-text('已发布')")
                    .first()
                    .isVisible()
                    .catch(() => false);
                  if (found) break;
                  // 检测不到就等2秒再刷新页面
                  await page.waitForTimeout(2000);
                  await page.reload({ waitUntil: "domcontentloaded" });
                  await page.waitForTimeout(2000);
                }
                console.log("检测到已发布内容，重新打开发布页…");
                continue; // 重走整个填充流程
              }
              throw err;
            }
          }

          // 3.2 主标题
          if (data.title) {
            console.log("填主标题…");
            await fillMainTitle(page, data.title);
          }

          // 3.3 封面
          if (data.cover) {
            console.log("上传封面…");
            await uploadCover(page, data.cover);
          }

          // 3.4 正文
          console.log("填充正文…");
          await fillArticle(page, data.content);

          // 3.5 话题标签
          if (data.tags?.length) {
            console.log(`填充 ${data.tags.length} 个话题标签…`);
            const lastIsImage = data.content[data.content.length - 1]?.type === "image";
            await fillTags(page, data.tags, lastIsImage);
          }

          // 3.6 位置
          if (data.location) {
            console.log(`添加位置：${data.location}`);
            await setLocation(page, data.location);
          }

          console.log("✓ 全部填充完成");

          // 3.7 自动发布
          if (opts.publish) {
            console.log("自动发布中…");
            await publish(page, data.title ?? "");
            console.log("✓ 发布完成");
            await context.close().catch(() => undefined);
            process.exit(0);
          }
          break; // 不带 publish 时跳出循环
        }
      } catch (err) {
        console.error("填充失败:", (err as Error).message);
        if (opts.headless) {
          await page.screenshot({ path: "edit-error.png" }).catch(() => undefined);
          console.log("错误截图 -> edit-error.png");
        }
        await context.close().catch(() => undefined);
        process.exit(1);
      }

      // 9. 收尾
      if (opts.headless) {
        const shot = "edit-result.png";
        await page.screenshot({ path: shot }).catch(() => undefined);
        console.log(`无头模式完成，截图 -> ${shot}`);
        await context.close().catch(() => undefined);
        process.exit(0);
      }

      console.log("浏览器保持打开，可检查/继续编辑；按 Ctrl+C 退出（登录态已保存）。");
      const close = async () => {
        await context.close().catch(() => undefined);
        process.exit(0);
      };
      process.on("SIGINT", close);
      process.on("SIGTERM", close);
    });
}
