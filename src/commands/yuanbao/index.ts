import type { Command } from "commander";
import { registerYuanbaoImageCommand } from "./image.js";

/**
 * `yuanbao` 命令组：元宝（接入文心一言能力）网页自动化。
 */
export function registerYuanbaoCommand(program: Command): void {
  const yuanbao = program
    .command("yuanbao")
    .description("元宝网页自动化（接入文心一言能力）");

  registerYuanbaoImageCommand(yuanbao);
}
