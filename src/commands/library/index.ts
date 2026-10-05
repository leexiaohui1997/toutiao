import type { Command } from "commander";
import { registerShareCommands } from "../shares.js";
import { registerFileCommands } from "../files.js";
import { registerRecommendationCommands } from "../recommendations.js";
import { registerNextBookCommand } from "../next-book.js";
import { registerDownloadBookCommand } from "../download-book.js";
import { registerScheduledCommands } from "../scheduled.js";

/**
 * `library` 命令组：电子书库管理。
 */
export function registerLibraryCommand(program: Command): void {
  const library = program
    .command("library")
    .description("电子书库管理（分享链接/文件夹/文件）");

  registerShareCommands(library);
  registerFileCommands(library);
  registerRecommendationCommands(library);
  registerNextBookCommand(library);
  registerDownloadBookCommand(library);
  registerScheduledCommands(library);
}
