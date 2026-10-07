import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { runJimengImageTasks } from "./image.js";

interface OverviewJson {
  bookTitle?: string;
  collectionName?: string;
  collectionCoverPrompt?: string;
  cover?: string;
  jimengWorkspaceId?: string;
  [key: string]: any;
}

/** 即梦封面图生成前的组装结果 */
export interface JimengCoverPlan {
  /** 概览 JSON 的绝对路径 */
  overviewPath: string;
  /** 解析后的概览对象 */
  overview: OverviewJson;
  /** 封面输出的相对路径（相对项目根） */
  coverRelPath: string;
  /** 组装好的即梦生图提示词 */
  prompt: string;
}

/**
 * 组装即梦封面图提示词。
 * 目前直接使用概览里的 collectionCoverPrompt；后续可在此追加即梦专属风格词 / 比例 / 模型参数。
 */
function buildJimengCoverPrompt(overview: OverviewJson): string {
  return overview.collectionCoverPrompt ?? "";
}

/**
 * 读取概览 JSON 并完成封面图生成前的校验与提示词组装。
 *
 * - 封面已存在且未指定 overwrite：打印提示并返回 null（调用方应跳过）；
 * - 缺少 collectionCoverPrompt：打印错误并抛错；
 * - 其他情况返回组装好的 {@link JimengCoverPlan}，供后续生图流程复用。
 */
export async function prepareJimengCover(
  file: string,
  overwrite: boolean,
): Promise<JimengCoverPlan | null> {
  const overviewPath = resolve(process.cwd(), file);
  const overview: OverviewJson = JSON.parse(await readFile(overviewPath, "utf-8"));

  if (overview.cover && !overwrite) {
    console.log(`✓ 封面已存在: ${overview.cover}（加 --overwrite 可强制覆盖）`);
    return null;
  }

  if (!overview.collectionCoverPrompt) {
    console.error("✗ 概览 JSON 中没有 collectionCoverPrompt 字段");
    throw new Error("missing collectionCoverPrompt");
  }

  const coverRelPath = resolve(dirname(overviewPath), "cover.png").replace(process.cwd() + "/", "");
  const prompt = buildJimengCoverPrompt(overview);

  return { overviewPath, overview, coverRelPath, prompt };
}

export function registerJimengCoverCommand(jimeng: Command): void {
  jimeng
    .command("cover")
    .description("从概览 JSON 在即梦生成合集封面图")
    .requiredOption("-f, --file <path>", "概览 JSON 文件路径（相对项目根）")
    .option("--overwrite", "已存在封面时强制覆盖", false)
    .option("--headless", "无头模式", false)
    .action(async (opts: { file: string; overwrite: boolean; headless: boolean }) => {
      const plan = await prepareJimengCover(opts.file, opts.overwrite);
      if (!plan) return;

      console.log(`生成封面: ${plan.coverRelPath}`);

      const { workspaceId } = await runJimengImageTasks(
        [{ prompt: plan.prompt, output: plan.coverRelPath }],
        { headless: opts.headless, workspaceId: plan.overview.jimengWorkspaceId },
      );

      plan.overview.cover = plan.coverRelPath;
      if (workspaceId) plan.overview.jimengWorkspaceId = workspaceId;
      await writeFile(plan.overviewPath, JSON.stringify(plan.overview, null, 2) + "\n", "utf-8");
      console.log(`✓ 已更新概览: cover=${plan.coverRelPath}, workspaceId=${workspaceId || plan.overview.jimengWorkspaceId || "(沿用)"}`);
      console.log("\n⚠️⚠️⚠️ 请一定要记得检查生成的图片是否符合要求！！⚠️⚠️⚠️");
    });
}
