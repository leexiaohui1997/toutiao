import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runImageTasks as runDoubaoImageTasks } from "./doubao/image.js";
import { runJimengImageTasks } from "./jimeng/image.js";
import { runYuanbaoImageTasks } from "./yuanbao/image.js";

/** 生图引擎 */
export type ImageEngine = "doubao" | "jimeng" | "yuanbao";

/** 统一的生图任务（三个引擎字段对齐） */
export interface ImageTask {
  prompt: string;
  output: string;
  ref?: string;
}

export interface RunImageOptions {
  headless: boolean;
  /** 已有会话 id（豆包 chatId / 即梦 workspaceId）；不传则新开 */
  sessionId?: string;
}

export interface RunImageResult {
  /** 本次生图所在会话 id（供下次复用） */
  sessionId?: string;
}

/**
 * 统一生图入口：按 engine 分发到豆包 / 即梦 / 元宝。
 * cover / article 命令只调这一层，不直接依赖具体引擎。
 */
export async function runImageTasks(
  engine: ImageEngine,
  tasks: ImageTask[],
  opts: RunImageOptions,
): Promise<RunImageResult> {
  if (tasks.length === 0) return {};

  if (engine === "doubao") {
    // 豆包 runImageTasks 通过 batch JSON 文件接收任务列表，写临时文件桥接
    const tmpFile = resolve(process.cwd(), `.image-tasks-${Date.now()}.json`);
    await writeFile(tmpFile, JSON.stringify(tasks), "utf-8");
    const r = await runDoubaoImageTasks({
      batch: tmpFile,
      chatId: opts.sessionId,
      headless: opts.headless,
    });
    return { sessionId: r.chatId };
  }

  if (engine === "jimeng") {
    const r = await runJimengImageTasks(tasks, {
      headless: opts.headless,
      workspaceId: opts.sessionId,
    });
    return { sessionId: r.workspaceId };
  }

  // yuanbao：不复用会话，每个提示词都开新会话，因此不回填 sessionId
  await runYuanbaoImageTasks(tasks, { headless: opts.headless });
  return {};
}

/** 各引擎在 overview/article JSON 里保存会话 id 的字段名 */
export function sessionIdField(engine: ImageEngine): string {
  switch (engine) {
    case "doubao": return "doubaoChatId";
    case "jimeng": return "jimengWorkspaceId";
    case "yuanbao": return "yuanbaoSessionId";
  }
}
