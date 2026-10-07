import type { Command } from "commander";
import { registerXhsCreateCollectionCommand } from "./create-collection.js";

/**
 * `xhs` 命令组：小红书网页自动化。
 */
export function registerXhsCommand(program: Command): void {
  const xhs = program
    .command("xhs")
    .description("小红书网页自动化");

  registerXhsCreateCollectionCommand(xhs);
}
