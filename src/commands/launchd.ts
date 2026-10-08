import type { Command } from "commander";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";

const PLIST_SRC = join(process.cwd(), "scripts/launchd/com.toutiao.publish.plist");
const PLIST_DST = join(os.homedir(), "Library/LaunchAgents/com.toutiao.publish.plist");
const WIN_TASK_NAME = "ToutiaoPublish";
const WIN_PS1_SRC = join(process.cwd(), "scripts/windows/publish-task.ps1");

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

/** 生成 Windows 任务计划程序要跑的 .ps1 脚本（每次启动时刷新，保证路径正确） */
function ensureWindowsScript(): void {
  mkdirSync(join(process.cwd(), "scripts/windows"), { recursive: true });
  const projectRoot = process.cwd();
  const logsDir = join(projectRoot, "logs");
  // PowerShell 里按天命名日志 + 自动删 7 天前的
  const script = `# 由 publish-start 自动生成，每5分钟跑一次
Set-Location "${projectRoot}"
$logsDir = "${logsDir}"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
# 删 7 天前的日志
Get-ChildItem -Path $logsDir -Filter "publish-*.log" -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force
# 按天命名日志
$today = Get-Date -Format "yyyyMMdd"
$log = Join-Path $logsDir "publish-$today.log"
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -FilePath $log -Append -Encoding utf8
pnpm dev library publish *>> $log
exit $LASTEXITCODE
`;
  writeFileSync(WIN_PS1_SRC, script, "utf-8");
}

export function registerLaunchdCommands(program: Command): void {
  mkdirSync(join(process.cwd(), "logs"), { recursive: true });

  // 开启定时发布
  program
    .command("publish-start")
    .description("开启定时发布（macOS: launchd 每5分钟；Windows: 任务计划程序每5分钟）")
    .action(() => {
      if (isMac) {
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
      } else if (isWin) {
        ensureWindowsScript();
        // 先删旧任务（忽略错误）
        try { execSync(`schtasks /Delete /TN "${WIN_TASK_NAME}" /F`, { stdio: "ignore" }); } catch {}
        // 新建任务：每 5 分钟跑一次 PowerShell 脚本（绕过执行策略）
        execSync(
          `schtasks /Create /TN "${WIN_TASK_NAME}" /TR "\\"powershell.exe\\" -NoProfile -ExecutionPolicy Bypass -File \\"${WIN_PS1_SRC}\\"" /SC MINUTE /MO 5 /F`,
          { stdio: "inherit" }
        );
        console.log("✓ 定时发布已开启（Windows 任务计划程序 + PowerShell），每5分钟检查一次");
        console.log(`  任务名: ${WIN_TASK_NAME}`);
        console.log(`  脚本: ${WIN_PS1_SRC}`);
        console.log(`  日志: logs/publish.log`);
        console.log(`  查看: Get-Content logs\\publish.log -Wait -Tail 50`);
      } else {
        console.error(`✗ 暂不支持的平台: ${process.platform}（仅支持 macOS / Windows）`);
        process.exit(1);
      }
    });

  // 关闭定时发布
  program
    .command("publish-stop")
    .description("关闭定时发布")
    .action(() => {
      if (isMac) {
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
      } else if (isWin) {
        try {
          execSync(`schtasks /Delete /TN "${WIN_TASK_NAME}" /F`, { stdio: "inherit" });
          console.log("✓ 定时发布任务已删除");
        } catch {
          console.log("定时发布本来就没在跑");
        }
      } else {
        console.error(`✗ 暂不支持的平台: ${process.platform}`);
        process.exit(1);
      }
    });
}
