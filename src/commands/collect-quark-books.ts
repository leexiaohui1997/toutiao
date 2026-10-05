import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Command } from "commander";
import type { Page } from "playwright";
import { launchPersistentContext } from "../browser.js";

/**
 * `collect-quark-books` 命令：BFS 遍历夸克网盘分享链接，收集 epub/mobi/pdf 文件。
 *
 * 数据文件结构 data/{share_id}.json：
 * {
 *   "pools": {
 *     "[父目录URL]": {
 *       "[子文件夹名]": false   // false=待处理, true=已处理
 *     }
 *   },
 *   "books": {
 *     "[书名]": {
 *       "publish": false,
 *       "formats": {
 *         "epub": { "url": "...", "size": "12.3MB" }
 *       }
 *     }
 *   }
 * }
 *
 * 每次取一个未处理的 (parentUrl, folderName)：
 *   goto parentUrl → 点击 folderName 进入 → 列当前目录 →
 *   子文件夹加入 pools[currentUrl] → 文件加入 books → 标记 parentUrl[folderName]=true
 */

const ALLOWED_EXT = new Set(["epub", "mobi", "pdf"]);

interface BookEntry {
  publish: boolean;
  formats: Record<string, { url: string; size: string }>;
}

interface DataFile {
  books: Record<string, BookEntry>;
  pools: Record<string, Record<string, boolean>>;
}

async function loadExisting(path: string): Promise<DataFile> {
  try {
    const raw = await readFile(path, "utf-8");
    const d = JSON.parse(raw);
    return { books: d.books ?? {}, pools: d.pools ?? {} };
  } catch {
    return { books: {}, pools: {} };
  }
}

async function save(data: DataFile, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // 原子写入：先写临时文件再 rename，避免中断时文件被截断
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, path);
}

interface Row {
  fileId: string;
  name: string;
  size: string;
  isFolder: boolean;
}

async function listCurrentDir(page: Page): Promise<Row[]> {
  // 空文件夹没有 tr，5 秒内没出现就视为空目录
  const found = await page.locator("tr.ant-table-row").first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  if (!found) return [];
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const trs = document.querySelectorAll("tr.ant-table-row");
    return Array.from(trs).map(tr => {
      const fileId = tr.getAttribute("data-row-key") || "";
      const name = (tr.querySelector(".filename-text") as HTMLElement)?.title || "";
      const tds = tr.querySelectorAll("td");
      // td[0]=checkbox, td[1]=文件名, td[2]=大小, td[3]=日期
      const size = tds[2]?.textContent?.trim() || "";
      const isFolder = /项$/.test(size);
      return { fileId, name, size, isFolder };
    });
  });
}

/** 在 parentUrl 页面点击 folderName 进入，处理里面的内容 */
async function processFolder(
  page: Page,
  parentUrl: string,
  folderName: string,
  data: DataFile,
  quiet: boolean
): Promise<void> {
  await page.goto(parentUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // 点击 folderName 对应的行
  const row = page.locator("tr.ant-table-row", { hasText: folderName }).first();
  await row.locator(".file-click-wrap").click();
  await page.waitForTimeout(2000);

  const currentUrl = page.url();
  console.log(`  进入: ${folderName} → ${currentUrl}`);

  // 初始化当前 URL 的 pools
  if (!data.pools[currentUrl]) data.pools[currentUrl] = {};

  const rows = await listCurrentDir(page);
  for (const r of rows) {
    if (r.isFolder) {
      if (!(r.name in data.pools[currentUrl])) {
        data.pools[currentUrl][r.name] = false;
        if (!quiet) console.log(`    📁 ${r.name} (${r.size}) → 加入队列`);
      }
    } else {
      const m = r.name.match(/\.([^.]+)$/);
      if (!m) continue;
      const ext = m[1].toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;
      const bookName = r.name.replace(/\.[^.]+$/, "").trim();

      if (data.books[bookName]?.formats?.[ext]) continue;
      if (!data.books[bookName]) {
        data.books[bookName] = { publish: false, formats: {} };
      }
      // url = 文件所在目录的当前页面链接
      data.books[bookName].formats[ext] = { url: currentUrl, size: r.size };
      console.log(`    📄 ${bookName}.${ext} (${r.size})`);
    }
  }
}

export function registerCollectQuarkBooksCommand(program: Command): void {
  program
    .command("collect-quark-books")
    .description("BFS 遍历夸克网盘分享链接，收集 epub/mobi/pdf 到 data/{share_id}.json")
    .requiredOption("-u, --url <url>", "夸克分享链接，如 https://pan.quark.cn/s/xxxxx")
    .option("--user-data-dir <dir>", "覆盖持久化用户数据目录")
    .option("--quiet", "不打印文件夹加入队列的日志", false)
    .action(async (opts: { url: string; userDataDir?: string; quiet: boolean }) => {
      const m = opts.url.match(/pan\.quark\.cn\/s\/([^#/?]+)/);
      if (!m) {
        console.error("无法从链接提取 share_id：", opts.url);
        process.exit(1);
      }
      const shareId = m[1];
      const outPath = `data/${shareId}.json`;

      const context = await launchPersistentContext({
        headless: true,
        userDataDir: opts.userDataDir,
      });
      const page = context.pages()[0] ?? (await context.newPage());

      try {
        const data = await loadExisting(outPath);

        // 首次运行：打开入口链接，把根目录下的所有文件夹加入 pools
        if (Object.keys(data.pools).length === 0) {
          console.log("首次运行，扫描根目录…");
          await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(3000);
          data.pools[opts.url] = {};
          const rootRows = await listCurrentDir(page);
          for (const r of rootRows) {
            if (r.isFolder) {
              data.pools[opts.url][r.name] = false;
              if (!opts.quiet) console.log(`  📁 ${r.name} → 加入队列`);
            } else {
              // 根目录直接就是文件的情况
              const m2 = r.name.match(/\.([^.]+)$/);
              if (m2 && ALLOWED_EXT.has(m2[1].toLowerCase())) {
                const bookName = r.name.replace(/\.[^.]+$/, "");
                data.books[bookName] = data.books[bookName] ?? { publish: false, formats: {} };
                data.books[bookName].formats[m2[1].toLowerCase()] = { url: opts.url, size: r.size };
              }
            }
          }
          await save(data, outPath);
        }

        console.log(`数据文件: ${outPath}`);
        console.log(`书籍库: ${Object.keys(data.books).length} 本\n`);

        let i = 0;
        while (true) {
          // 找一个 (parentUrl, folderName) where false
          let found: [string, string] | null = null;
          for (const [parentUrl, folders] of Object.entries(data.pools)) {
            const name = Object.entries(folders).find(([, done]) => !done)?.[0];
            if (name) { found = [parentUrl, name]; break; }
          }
          if (!found) break;
          const [parentUrl, folderName] = found;
          i++;
          console.log(`[${i}] ${parentUrl} → ${folderName}`);
          try {
            await processFolder(page, parentUrl, folderName, data, opts.quiet);
            data.pools[parentUrl][folderName] = true;
          } catch (err) {
            const msg = (err as Error).message;
            // 浏览器已关闭等致命错误：保存当前状态后直接退出
            if (/closed|Target page|browser has been/i.test(msg)) {
              console.error(`\n✗ 浏览器已关闭，保存当前进度后退出: ${msg}`);
              await save(data, outPath);
              await context.close().catch(() => undefined);
              process.exit(1);
            }
            console.error(`  ✗ 失败: ${msg}，保持待处理状态，保存后退出`);
            // 不标记为 true，下次续跑会重试这个文件夹
            await save(data, outPath);
            await context.close().catch(() => undefined);
            process.exit(1);
          }
          await save(data, outPath);
        }

        console.log(`\n✓ 完成，共 ${Object.keys(data.books).length} 本书，已写入 ${outPath}`);
      } catch (err) {
        console.error("收集失败:", (err as Error).message);
      }

      await context.close().catch(() => undefined);
      process.exit(0);
    });
}
