import type { Command } from "commander";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const PLIST_SRC = join(process.cwd(), "scripts/launchd/com.toutiao.publish.plist");
const PLIST_DST = process.env.HOME + "/Library/LaunchAgents/com.toutiao.publish.plist";

export function registerLaunchdCommands(program: Command): void {
  mkdirSync(join(process.cwd(), "logs"), { recursive: true });

  // 开启定时发布
  program
    .command("publish-start")
    .description("开启 launchd 定时发布（每5分钟检查一次）")
    .action(() => {
      // 阻止系统睡眠（合盖也能跑）
      try {
        execSync(`sudo pmset -a sleep 0 disksleep 0`);
        console.log("✓ 已设置合盖不睡");
      } catch {
        console.log("⚠ pmset 设置失败（需要 sudo），合盖后可能中断");
      }
      // 复制 plist
      execSync(`cp "${PLIST_SRC}" "${PLIST_DST}"`);
      execSync(`launchctl unload "${PLIST_DST}" 2>/dev/null || true`);
      execSync(`launchctl load "${PLIST_DST}"`);
      console.log("✓ 定时发布已开启，每5分钟检查一次");
      console.log(`  日志: logs/publish.log`);
      console.log(`  查看: tail -f logs/publish.log`);
    });

  // 关闭定时发布
  program
    .command("publish-stop")
    .description("关闭 launchd 定时发布")
    .action(() => {
      try {
        execSync(`launchctl unload "${PLIST_DST}"`);
        console.log("✓ 定时发布已关闭");
      } catch {
        console.log("定时发布本来就没在跑");
      }
      // 恢复系统默认睡眠
      try {
        execSync(`sudo pmset -a sleep 10 disksleep 10`);
        console.log("✓ 已恢复系统默认睡眠设置");
      } catch {
        console.log("⚠ pmset 恢复失败，手动执行 sudo pmset -a sleep 10");
      }
    });
}
