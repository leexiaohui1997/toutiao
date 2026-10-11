/**
 * 平台总开关：控制小红书 / B 站是否允许创建合集和发布文章。
 * 设为 false 时，对应平台的 create-collection / publish 命令会在前置检查阶段打印提示并退出。
 */
export const ENABLE_XHS = false;
export const ENABLE_BILIBILI = false;

/**
 * 在 xhs / bilibili 的 create-collection 和 publish 命令入口调用：
 * 对应平台开关为 false 时打印提示并退出进程。
 */
export function assertPlatformEnabled(platform: "xhs" | "bilibili"): void {
  const enabled = platform === "xhs" ? ENABLE_XHS : ENABLE_BILIBILI;
  if (!enabled) {
    const name = platform === "xhs" ? "小红书" : "B站";
    console.log(`✗ ${name} 平台开关已关闭（src/config.ts 中 ENABLE_${platform.toUpperCase()} = false），跳过`);
    process.exit(0);
  }
}
