import type { Command } from "commander";
import { registerBilibiliCreateCollectionCommand } from "./create-collection.js";
import { registerBilibiliPublishCommand } from "./publish.js";

/**
 * `bilibili` 命令组：B 站网页自动化。
 */
export function registerBilibiliCommand(program: Command): void {
  const bili = program
    .command("bilibili")
    .description("B 站网页自动化");

  registerBilibiliCreateCollectionCommand(bili);
  registerBilibiliPublishCommand(bili);
}
