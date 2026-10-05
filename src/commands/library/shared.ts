import type Database from "better-sqlite3";
import type { Page } from "playwright";
import bytes from "bytes";

/** 把 "6.6M" / "141.4MB" / "500KB" / "1.2GB" 转为字节数（整数） */
export function parseSize(text: string): number {
  const normalized = text.trim().replace(/^([\d.]+)\s*([KMG])$/i, "$1$2B");
  return bytes.parse(normalized) ?? 0;
}

/** 列出当前目录的行（自动滚动加载全部，处理虚拟滚动） */
export async function listDir(page: Page): Promise<{ fileId: string; name: string; size: string; isFolder: boolean }[]> {
  const found = await page.locator("tr.ant-table-row").first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  if (!found) return [];
  await page.waitForTimeout(800);

  const collected = new Map<string, { fileId: string; name: string; size: string; isFolder: boolean }>();
  let stagnant = 0;

  while (stagnant < 3) {
    const rows = await page.evaluate(() => {
      const trs = document.querySelectorAll("tr.ant-table-row");
      return Array.from(trs).map(tr => {
        const fileId = tr.getAttribute("data-row-key") || "";
        const name = (tr.querySelector(".filename-text") as HTMLElement)?.title || "";
        const tds = tr.querySelectorAll("td");
        const size = tds[2]?.textContent?.trim() || "";
        const isFolder = /项$/.test(size);
        return { fileId, name, size, isFolder };
      });
    });
    const before = collected.size;
    for (const r of rows) {
      if (r.fileId) collected.set(r.fileId, r);
    }
    if (collected.size === before) stagnant++;
    else stagnant = 0;

    await page.evaluate(() => {
      const c = document.querySelector(".ant-table-body") as HTMLElement;
      if (c) c.scrollTop += c.clientHeight * 0.8;
    });
    await page.waitForTimeout(800);
  }

  return Array.from(collected.values());
}

type Db = Database.Database;

/** 处理一个分享链接的根目录 */
export async function processShareRoot(page: Page, db: Db, shareId: number, shareUrl: string): Promise<void> {
  await page.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const rows = await listDir(page);
  const insertFolder = db.prepare(
    "INSERT OR IGNORE INTO folders (share_id, parent_id, url, name, file_count, status) VALUES (?, NULL, ?, ?, ?, 'pending')"
  );
  const insertFile = db.prepare(
    "INSERT OR IGNORE INTO files (share_id, folder_id, url, name, size, ext, size_bytes, status) VALUES (?, NULL, ?, ?, ?, ?, ?, 'pending')"
  );

  let folderCount = 0, fileCount = 0;
  for (const r of rows) {
    if (r.isFolder) {
      const url = `${shareUrl}#/list/share/${r.fileId}`;
      const m = r.size.match(/(\d+)\s*项/);
      insertFolder.run(shareId, url, r.name, m ? Number(m[1]) : 0);
      folderCount++;
    } else {
      const ext = r.name.match(/\.([^.]+)$/)?.[1].toLowerCase() || "";
      insertFile.run(shareId, shareUrl, r.name, r.size, ext, parseSize(r.size));
      fileCount++;
    }
  }
  console.log(`  根目录扫描完成: ${folderCount} 个文件夹, ${fileCount} 个文件`);
}

/** 处理一个子文件夹 */
export async function processFolder(
  page: Page,
  db: Db,
  folder: { id: number; share_id: number; url: string; name: string }
): Promise<void> {
  console.log(`处理文件夹: ${folder.name}`);
  db.prepare("UPDATE folders SET status = 'processing' WHERE id = ?").run(folder.id);

  await page.goto(folder.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const rows = await listDir(page);
  const insertFolder = db.prepare(
    "INSERT OR IGNORE INTO folders (share_id, parent_id, url, name, file_count, status) VALUES (?, ?, ?, ?, ?, 'pending')"
  );
  const insertFile = db.prepare(
    "INSERT OR IGNORE INTO files (share_id, folder_id, url, name, size, ext, size_bytes, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')"
  );

  let folderCount = 0, fileCount = 0;
  for (const r of rows) {
    if (r.isFolder) {
      const url = `${folder.url.split("#")[0]}#/list/share/${r.fileId}`;
      const m = r.size.match(/(\d+)\s*项/);
      insertFolder.run(folder.share_id, folder.id, url, r.name, m ? Number(m[1]) : 0);
      folderCount++;
    } else {
      const ext = r.name.match(/\.([^.]+)$/)?.[1].toLowerCase() || "";
      insertFile.run(folder.share_id, folder.id, folder.url, r.name, r.size, ext, parseSize(r.size));
      fileCount++;
    }
  }

  db.prepare("UPDATE folders SET status = 'done' WHERE id = ?").run(folder.id);
  console.log(`  文件夹扫描完成: ${folderCount} 个文件夹, ${fileCount} 个文件`);
}
