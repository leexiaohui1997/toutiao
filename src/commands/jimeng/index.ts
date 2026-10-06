import type { Command } from "commander";
import { registerJimengLoginCommand } from "./login.js";
import { registerJimengCoverCommand } from "./cover.js";
import { registerJimengArticleCommand } from "./article.js";

/**
 * `jimeng` 命令组：即梦网页自动化。
 */
export function registerJimengCommand(program: Command): void {
  const jimeng = program
    .command("jimeng")
    .description("即梦网页自动化");

  registerJimengLoginCommand(jimeng);
  registerJimengCoverCommand(jimeng);
  registerJimengArticleCommand(jimeng);
}
