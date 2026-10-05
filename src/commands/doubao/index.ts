import type { Command } from "commander";
import { registerDoubaoLoginCommand } from "./login.js";
import { registerDoubaoImageCommand } from "./image.js";
import { registerDoubaoRenameCommand } from "./rename-cmd.js";

/**
 * `doubao` 命令组：豆包网页自动化。
 */
export function registerDoubaoCommand(program: Command): void {
  const doubao = program
    .command("doubao")
    .description("豆包网页自动化");

  registerDoubaoLoginCommand(doubao);
  registerDoubaoImageCommand(doubao);
  registerDoubaoRenameCommand(doubao);
}
