import type { Command } from "commander";
import { registerJimengLoginCommand } from "./login.js";

/**
 * `jimeng` 命令组：即梦网页自动化（底层生图能力由顶层 cover/article --engine jimeng 调用）。
 */
export function registerJimengCommand(program: Command): void {
  const jimeng = program
    .command("jimeng")
    .description("即梦网页自动化");

  registerJimengLoginCommand(jimeng);
}
