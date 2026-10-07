import type { Command } from "commander";
import { launchPersistentContext } from "../../browser.js";
import { YuanBao } from "./yuanbao.js";
import { Wenxin } from "./wenxin.js";
import { downloadImage } from "../jimeng/image.js";

/** 元宝生图单条任务 */
export interface YuanbaoImageTask {
  /** 提示词 */
  prompt: string;
  /** 图片保存位置（相对项目根） */
  output: string;
  /** 参考图路径（相对项目根）；不传则不使用参考图 */
  ref?: string;
}

export interface YuanbaoImageOptions {
  headless: boolean;
}

/** 元宝生图流程返回结果 */
export interface YuanbaoImageResult {
  [key: string]: any;
}

/**
 * 元宝批量生图主流程（action 抽离以便复用）。
 * 不做会话复用：每个提示词都开新会话（/chat/naQivTmsDa），避免多轮对话互相污染。
 */
export async function runYuanbaoImageTasks(
  tasks: YuanbaoImageTask[],
  opts: YuanbaoImageOptions,
): Promise<YuanbaoImageResult> {
  if (tasks.length === 0) return {};

  const context = await launchPersistentContext({ headless: opts.headless, acceptDownloads: true });

  // 第一个 page 给元宝，新开一个 page 给文心一言
  const yuanbaoPage = context.pages()[0] ?? (await context.newPage());
  const wenxinPage = await context.newPage();

  const yuanbao = new YuanBao(yuanbaoPage);
  const wenxin = new Wenxin(wenxinPage);

  await yuanbao.open();
  await wenxin.open();

  const loggedIn = await yuanbao.checkLogin();
  if (!loggedIn) {
    console.error("✗ 元宝未登录，退出");
    await context.close();
    process.exit(1);
  }

  const wenxinLoggedIn = await wenxin.checkLogin();
  if (!wenxinLoggedIn) {
    console.error("✗ 文心一言未登录，退出");
    await context.close();
    process.exit(1);
  }

  // 流水线：上一张图在文心一言去水印时，元宝并行开新会话出下一张
  let pendingWm: Promise<string> | null = null;
  let pendingOutput: string | null = null;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`\n[yuanbao ${i + 1}/${tasks.length}] output=${task.output}`);

    // 0. 先收掉上一张的去水印结果（若在跑就 await）
    if (pendingWm && pendingOutput) {
      const noWmSrc = await pendingWm;
      await downloadImage(noWmSrc, pendingOutput);
      pendingWm = null;
      pendingOutput = null;
    }

    // 1. 每轮都新开一个生图会话（不复用历史会话），并切到 AI 生图模式
    await yuanbao.prepareForImageGeneration();

    // 2. 参考图（如有）
    if (task.ref) {
      await yuanbao.uploadReferenceImage(task.ref);
    }

    // 3. 填提示词 → 点发送 → 等出图 → 下载原图
    await yuanbao.fillPrompt(task.prompt);
    await yuanbao.clickSend();
    const src = await yuanbao.waitForAndGetLatestImage();
    await downloadImage(src, task.output);

    // 4. 立刻 fire-and-forget 丢给文心一言去水印，元宝继续下一轮
    pendingWm = wenxin.removeWatermark(task.output);
    pendingOutput = task.output;

    // 调试阶段：每轮之间停 2s
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 收掉最后一张的去水印结果
  if (pendingWm && pendingOutput) {
    const noWmSrc = await pendingWm;
    await downloadImage(noWmSrc, pendingOutput);
  }
  await context.close();
  return {};
}

export function registerYuanbaoImageCommand(yuanbao: Command): void {
  yuanbao
    .command("image")
    .description("元宝批量生图（接入文心一言能力）")
    .option("--headless", "无头模式", false)
    .action(async (opts: { headless: boolean }) => {
      await runYuanbaoImageTasks(
        [{ prompt: "调试占位提示词", output: "docs/_debug/yuanbao.png" }],
        { headless: opts.headless },
      );
    });
}
