---
name: doubao-book-to-toutiao-local
cn_name: 书籍导读转头条成稿（本地版）
description: 书籍导读与今日头条成稿协作技能（本地 JSON 输出版）。与 doubao-book-to-toutiao 的区别：①所有产出（概览、成稿、图片）写入本地 docs/ 目录而非云盘飞书文档；②概览与成稿均为 JSON 文件，可直接喂给本仓库的 `pnpm dev edit` 命令自动填充今日头条发布页。当用户提供书籍/长文档并希望以"导读助手"身份工作，且最终要本地 JSON 交付、可直接自动化发布时使用。典型触发语："做一个全书总览""讲解第一章""下一章""成稿不要出现书籍的概念""给这篇成稿生图""发布这篇"，以及快捷指令"5+书名"（单本深度选书评估）、"51"（批量书名快速打分列表）、"1"（下一篇）、"2+0"（合集封面）、"2+序号"（该篇生图）、"3"（成稿→生图一路做完全部剩余篇章）、"3+m~n"（只处理第m到n篇）、"3+6+m~n"（成稿→生图→发布，限第m到n篇）、"4+序号"（本地发布该篇）。
---

# 书籍导读 → 今日头条成稿（本地 JSON 版）

## 角色定位

作为用户的"导读助手"：读完整本书后，以大众科普作者身份向读者讲述内容。全程遵守两条用户硬约束：

1. **成稿无书籍概念**：面向读者的成稿绝不出现"书、章节、目录、这本书"等表述，以读完后自己的总结向大众讲述的独立科普文章呈现；
2. **配图以提示词交付，生图后替换为本地路径**：封面图提示词 2054x1600；插图提示词 16:9，每 1~2 个段落之间一张。

## 与云盘版的核心差异

| 维度 | 云盘版（doubao-book-to-toutiao） | 本地版（本技能） |
|---|---|---|
| 概览文件 | 飞书文档 | `docs/{书名}/overview.json` |
| 成稿文件 | 飞书文档 | `docs/{书名}/第N篇/article.json` |
| 图片存放 | 云盘同目录 | 本地同目录，带 png/jpg/jpeg 后缀 |
| 发布方式 | 人工复制粘贴 | `pnpm dev edit --file <article.json>` 自动填充 |

## 本地目录结构

```
docs/
  {书名}/
    overview.json              # 全书总览
    cover.png                  # 合集封面（生图后）
    第1篇/
      article.json             # 成稿
      cover.png                # 本篇封面
      插图1.png
      插图2.png
    第2篇/
      ...
```

工作目录为当前项目根（即 toutiao 仓库根），`docs/` 为相对路径。

## JSON Schema

### overview.json（全书总览）

> ⚠️ **新建 overview.json 时，以下面"空模板"为唯一字段骨架填值。**
> 不要去翻 `docs/` 下其他书的旧 overview.json 抄结构——旧文件里可能带有历史迭代残留的额外字段（如 doubaoChatId / jimengWorkspaceId / tagsCollected / 旧字段名等），照抄会污染新书结构。字段以本 SKILL 此处列出的为准，模板里没列的字段一律不要写。

**空模板（字段齐全、值留空，按此填）：**

```jsonc
{
  "bookTitle": "",
  "theme": "",

  "chapters": [
    { "index": 1, "title": "", "topics": [], "summary": "" }
  ],

  "collectionNameCandidates": [],
  "collectionName": "",
  "collectionDesc": "",
  "collectionCoverPrompt": "",
  "xhsCollectionCoverPrompt": "",
  "cover": "",
  "xhsCover": "",
  "created": false,
  "xhsCreated": false,
  "bilibiliCollectionId": null,
  "tags": [],

  "articlePlan": [
    { "no": 1, "topic": "", "sourceChapters": [] }
  ],

  "coverPromptTemplate": "",
  "illustrationPromptTemplate": "",

  "genre": "",
  "headlineTemplates": [],
  "structureAnalysis": ""
}
```

**字段含义（填值说明）：**

```jsonc
{
  "bookTitle": "书名",
  "theme": "全书主题定位（一段话）",

  "chapters": [
    {
      "index": 1,
      "title": "原书第N章标题",
      "topics": ["该章核心议题1", "议题2"],
      "summary": "该章回答什么问题、最有价值的观点"
    }
  ],

  "collectionNameCandidates": ["5条合集名，每条5~6字"],
  "collectionName": "最终采用的合集名（用户选定后回填）",
  "collectionDesc": "合集简介（不超过100字，给读者看的合集一句话定位）",
  "collectionCoverPrompt": "头条合集封面图提示词（2054x1600，横版）",
  "xhsCollectionCoverPrompt": "小红书合集封面图提示词（3:4 竖版）",
  "cover": "docs/{书名}/cover.png（头条合集封面生图后回填，相对项目根）",
  "xhsCover": "docs/{书名}/xhs-cover.png（小红书合集封面生图后回填，相对项目根）",
  "created": false,  // 合集是否已在头条后台创建，4+0 完成后改为 true
  "xhsCreated": false,  // 合集是否已在小红书后台创建，xhs create-collection 完成后改为 true
  "bilibiliCollectionId": null,  // B 站文集 id（数字）；bilibili create-collection 成功后回填，非 null 即跳过重复创建
  "tags": ["#话题1#", "#话题2#"],  // 7 指令收集后回填（2~3个不同关键词的话题），所有成稿共用此 tags

  "articlePlan": [
    {
      "no": 1,
      "topic": "本篇文章主题",
      "sourceChapters": [1, 2]
    }
  ],

  "coverPromptTemplate": "本篇封面图提示词模板",
  "illustrationPromptTemplate": "插图提示词模板",

  "genre": "题材类型定位（主次）",
  "headlineTemplates": ["实时调查所得标题模板1", "模板2"],
  "structureAnalysis": "爆款结构拆解（开头钩子/正文套路/互动引导）"
}
```

### article.json（单篇成稿）

```jsonc
{
  "no": 1,
  "bookTitle": "书名",
  "collection": "合集名",
  "sourceChapters": [1, 2],

  // 发布状态：成稿阶段 false，4+N 发布成功后改为 true
  "publish": false,
  // 小红书发布状态：成稿阶段 false，xhs publish 发布成功后改为 true；已 true 则脚本跳过
  "xhsPublish": false,
  // B 站发布状态：成稿阶段 false，bilibili publish 发布成功后改为 true；已 true 则脚本跳过
  "bilibiliPublish": false,

  "title": "主标题（H1）",
  "altTitles": ["备选标题1", "备选标题2"],

  // 封面：提示词永久存 coverPrompt；生图后 cover 写成图片路径
  "coverPrompt": "封面图提示词（2054x1600）",
  "cover": "docs/{书名}/第N篇/cover.png（生图后回填路径，相对项目根）",

  // B 站封面（16:9 横版）：提示词永久存 bilibiliCoverPrompt；生图后 bilibiliCover 写成路径。
  // 生图时以本篇默认封面 cover.png 为参考图二次生成。
  "bilibiliCoverPrompt": "B站封面图提示词（16:9 横版）",
  "bilibiliCover": "docs/{书名}/第N篇/bilibili-cover.png（生图后回填）",

  // 正文块数组——与本仓库 `pnpm dev edit` 命令格式一致
  // type: "title"=正文H1小标题, "text"=正文段落, "image"=插图
  // image 块：提示词永久存 prompt；生图后 content 写成图片路径
  "content": [
    { "type": "text",  "content": "开头钩子段落" },
    { "type": "title", "content": "第一小节小标题" },
    { "type": "text",  "content": "案例+概念+方法段落" },
    { "type": "image", "prompt": "插图1提示词（16:9）", "content": "docs/{书名}/第N篇/插图1.png（生图后回填）" },
    { "type": "text",  "content": "下一段" }
  ],

  "goldenQuotes": ["金句1", "金句2"],
  "tags": ["#标签1", "#标签2"],
  "layoutNotes": "排版优化说明"
}
```

**提示词与路径分离（两阶段）**：
- 成稿阶段：写 `coverPrompt`（封面提示词）和每个 image 块的 `prompt`（插图提示词）；`cover` / image 块的 `content` 此时可留空；
- 生图阶段：脚本按**图片文件是否存在**判断待生成，用 `coverPrompt` / `block.prompt` 作为提示词出图，完成后把路径写回 `cover` / `block.content`（**提示词字段保留不删**，便于后续重生成时复用）。路径均相对于项目根（脚本按 `process.cwd()` 解析）。

## 会话入口

- **用户直接给书名**：进入阶段一全书总览。
- **用户输入 `$id`（如 `$2`）**：表示这本书来自电子书库推荐表。执行：
  1. 查推荐书：`pnpm dev library rec-workdir -i 2`（或直接查数据库），确认推荐书存在且 status=pending；
  2. 确认后把状态改为 processing：`pnpm dev library set-status -t recommendation -i 2 -s processing`；
  3. 进入阶段一全书总览，工作目录为 `docs/{书名}/`；
  4. **概览文件创建后**，把工作目录写回推荐表：`pnpm dev library set-workdir -i 2 -d "docs/{书名}"`。

## 工作流

### 阶段零：选书评估（触发："5+书名"）

在投入整本拆解之前，先判断这本书值不值得做。**本阶段不创建任何文件**，只在聊天里输出判断报告。

1. 收到 `5《XXX》` 后，按 `references/selection-sop.md` 执行：
   - Step 1：联网检索书籍信息（作者/简介/目录/核心观点/案例风格/头条竞争度），信息不够就请用户补材料，不许凭书名脑补；
   - Step 2：10 条硬性否决项筛查，命中任意一条直接判 ❌；
   - Step 3：20 分评分卡打分，每维必须附检索到的真实证据，写不出证据给 0 分；
   - Step 4：按固定模板输出判断报告（结论 / 否决项 / 评分明细 / 3 个候选标题 / 风险 / 下一步建议）。
2. 输出后等待用户决策：
   - 用户说"做"/"开始做这本书" → 进入阶段一；
   - 用户说"算了"/"换一本" → 结束，不创建任何 docs/ 目录。

### 阶段一：全书总览

1. 完整读取书籍（逐页读取，不跳过图表与案例），梳理全书主题、章节数量、每章核心议题与一句话概览。
2. 按 `references/article-template.md` 的写作要点，拟定合集规划：
   - 合集名称备选 5 条（5~6字，不出现书籍概念）；
   - 合集简介（`collectionDesc`，**不超过 100 字**，一句话讲清这个合集给读者解决什么问题、提供什么价值）；
   - 合集封面图提示词两份：头条横版（2054x1600，写入 `collectionCoverPrompt`）+ 小红书竖版（3:4，写入 `xhsCollectionCoverPrompt`）；
   - 合集文章规划（总篇数、每篇主题、对应章节，覆盖全书全部章节）；
   - 本篇封面图提示词模板与插图提示词模板（按 `references/image-prompts.md`，统一漫画风格）；
   - 题材类型定位 + 实时调查该题材当下的爆款标题模板（1~3个）与结构拆解。
3. 写入 `docs/{书名}/overview.json`，聊天呈现总览要点，请用户选定合集名。
4. **用户确认合集名后（同轮次完成，不要等到下一篇）**：
   - 把 `collectionName` 字段回填进 overview.json；
   - 检查 `collectionCoverPrompt` 里的大字是否与合集名一致，不一致就改成合集名，下方小字也按合集名语义微调；
   - **主动把本会话重命名为该合集名**：在回复末尾明确写一句"📌 本会话建议重命名为【{合集名}】"，方便用户在会话列表里一眼定位这本书的所有产出（多篇成稿、生图、发布都在这个会话里推进，不改名会跟别的书混淆）。
5. **合集名确认后即停，不要自动开始第一篇成稿**。等待用户发出明确指令（如"1"/"下一篇"/"开始写第一篇"）后再进入阶段二。不要因为合集名刚定好就顺手把第一篇也写了——用户可能想先跑"7"收话题、"2+0"生封面、或先调整成稿规划。

### 阶段二：章节成稿

1. 用户点名章节或按 articlePlan 顺序推进。
2. 按 `references/article-template.md` 写正文：
   - 主标题钩子式；
   - 开头钩子 100~150 字；
   - 每节 = 小标题 + 案例引入 + 概念拆解 + 方法/结论；
   - 插图提示词每 1~2 段一张，写在对应位置的 image 块里，但**每篇总数不超过 5 张**；
   - 结尾总结 + 互动引导；
   - 话题标签：**若 overview.json 已有 `tags` 字段且非空，成稿 tags 直接沿用 overview 的 tags，不再自行创作**；否则自行拟 3~6 个。
3. 写入 `docs/{书名}/第N篇/article.json`，content 数组按上述 schema。
4. **字数自检（必做，循环补写）**：写完 article.json 后，立即调用命令统计字数：
   ```bash
   pnpm dev count-words -f "docs/{书名}/第N篇/article.json"
   ```
   若输出字数 < 3500，必须补写段落（补充案例、展开概念、加方法建议等），补写后再次调用该命令，**循环直至字数 ≥ 3500** 才能进入生图/发布环节。绝不把不足 3500 字的稿件送入下一阶段。

### 阶段三：打磨（可选）

用户要求"打磨/补齐金句标签"时，补全 `altTitles`、`goldenQuotes`、`tags`、`layoutNotes` 字段。

### 阶段四：生图（触发："2+0" / "2+序号"）

**生图统一使用本项目脚本**，不使用内置生图工具。顶层命令 `cover` / `article` 通过 `--engine` 选择生图后端：

| 场景 | 命令 |
|---|---|
| 合集封面 | `pnpm dev cover -f "docs/{书名}/overview.json" --engine <引擎>` |
| 篇章封面 + 插图 | `pnpm dev article -f "docs/{书名}/第N篇/article.json" --engine <引擎>` |

**引擎优先级（硬规则）**：
1. **优先 `--engine jimeng`**（即梦 Seedream 4.7，图片生成模式、智能/2K/1:1）——不传 `--engine` 默认就是 jimeng；
2. 若即梦脚本报"积分不足 / 积分不够 / ✗✗✗ 即梦积分不足"，**立即停止 jimeng 重试**，改用 `--engine yuanbao`（元宝生图 + 文心一言自动去水印）重跑同一条命令；
3. 切到元宝后，后续所有生图步骤一律用 `--engine yuanbao`，不要每轮都先试 jimeng；
4. 元宝若也失败（未登录/出图失败/文心去水印失败），停下来报错，不要换其他生图路径。

**会话复用规则**：脚本自动从 overview.json 读取对应引擎的会话 id（jimeng → `jimengWorkspaceId`；yuanbao → `yuanbaoSessionId`），无需手动传。首次生图后自动回填。

**合集封面（"2+0"）**：
```bash
pnpm dev cover -f "docs/{书名}/overview.json" --engine jimeng
# 积分不足则改：
pnpm dev cover -f "docs/{书名}/overview.json" --engine yuanbao
```
自动读 `collectionCoverPrompt` 生图，保存为 `docs/{书名}/cover.png`，回填 overview.json 的 `cover` 和对应引擎的会话 id。已存在封面则跳过，加 `--overwrite` 强制重新生成。

**单篇生图（"2+序号"）**：
```bash
pnpm dev article -f "docs/{书名}/第N篇/article.json" --engine jimeng
# 积分不足则改：
pnpm dev article -f "docs/{书名}/第N篇/article.json" --engine yuanbao
```
自动提取 article.json 里的 `coverPrompt` 和所有 image 块的 `prompt`，一次性生成。生成后自动把路径写回 article.json 的 `cover` 与各 image 块的 `content`（提示词字段 `coverPrompt` / `prompt` 保留不动）。

**生图后检查（必做）**：生图完成后，AI 必须逐张查看生成的图片（封面、插图），对照提示词检查：
- 构图、风格、色彩是否符合提示词要求；
- 是否有多余文字、水印、乱码（元宝生图经文心一言去水印，仍需复核水印是否清干净）；
- 是否保持合集统一视觉基调（封面与合集封面风格一致）。
不符合要求的图片，记录是哪一张（封面/插图N），使用生图命令重新生成该张，直到全部合格为止。

### 阶段五：本地发布（触发："4+序号"）

要求该篇已完成生图、article.json 中图片字段已替换为本地路径。

**默认命令（自动发布到头条 + 小红书，无特别说明一律用这条）**：
```bash
pnpm dev publish-all -f "docs/{书名}/第N篇/article.json"
```

**例外：只在头条填充不发布**（仅当用户明确说"先别发/我自己检查/先预览"时才用）：
```bash
pnpm dev edit --file "docs/{书名}/第N篇/article.json"
```

发布成功后，脚本自动把该篇 article.json 的顶层 `publish`（头条）和 `xhsPublish`（小红书）字段由 `false` 改为 `true`，便于盘点已发/未发状态。

脚本自动完成：确保登录 → 填主标题 → 填正文（H1 小标题/段落/图片/标签按序）→ 上传封面（自动确认单图模式）→ 设置位置/合集（若 JSON 中有对应顶层字段）。带 `--publish` 时，填充完成后自动点"预览并发布"→"确认发布"。

常用可选参数：
- `--headless`：无头模式（不弹浏览器窗口，完成后截图）；
- `--user-data-dir <dir>`：覆盖登录态持久化目录。

## 快捷指令

以下数字指令全流程生效；中文指令为别名，效果相同。

- **"1"（或"下一篇"）**：按 overview.json 的 articlePlan 顺序推进下一篇成稿。读该篇对应章节原文 → 写 `docs/{书名}/第N篇/article.json`（正文≥3500字、含封面/插图提示词；同步写 `bilibiliCoverPrompt`——16:9 横版 B 站封面提示词，主题与竖版封面一致、构图改横版布局）→ JSON 校验通过 → 聊天速览。无需用户重复输入完整指令。
- **"2+0"**：根据 overview.json 生成合集封面一张。执行 `pnpm dev cover -f "docs/{书名}/overview.json" --engine jimeng`，读取 `collectionCoverPrompt`（2054x1600）走即梦 Seedream 4.7 生图，保存为 `docs/{书名}/cover.png`（与全书统一后缀），回填 overview 的 `cover` 与对应引擎会话 id。**若脚本报积分不足，立即改用 `--engine yuanbao` 重跑同一条命令。**
- **"2+序号（1~N）"（或"生图 N"）**：对第 N 篇执行阶段四生图。执行 `pnpm dev article -f "docs/{书名}/第N篇/article.json" --engine jimeng`，脚本自动读取 `coverPrompt` 与 content 中全部 image 块的 `prompt`，逐张生成、每张只一张，保存为该篇目录下 `cover.png`、`插图1.png`、`插图2.png`……（统一后缀），并把 `cover` / image 块 `content` 写回路径（提示词字段保留），使 JSON 变为可直接 `pnpm dev edit` 消费的发布稿。**若存在 `bilibiliCoverPrompt` 且 `bilibili-cover.png` 尚未生成，脚本自动以本篇 cover.png 为参考图再出一张 16:9 横版 B 站封面，保存为 `bilibili-cover.png` 并回填 `bilibiliCover`。已生成的图片自动跳过，重跑安全。****若脚本报积分不足，立即改用 `--engine yuanbao` 重跑。**
- **"3"**：按"成稿 → 生图"次序依次完成剩余所有篇章。**若 `docs/{书名}/cover.png`（合集封面）尚不存在，先执行 `pnpm dev cover -f "docs/{书名}/overview.json" --engine jimeng` 生成合集封面（积分不足切 `--engine yuanbao`）。** 然后从当前未完成篇章起，逐篇执行：①读对应章节母稿写 article.json（含 `coverPrompt`、`bilibiliCoverPrompt` 和 image 块 `prompt`）→②JSON 校验 →③执行 `pnpm dev article -f "docs/{书名}/第N篇/article.json" --engine jimeng` 生图（积分不足切 `--engine yuanbao`）→④脚本自动把图片路径写回 `cover` / image 块 `content`（提示词字段保留）。一篇完成再推进下一篇，已完成篇章跳过，全程无需用户重复输入指令。
- **"3+6"**：逐篇流水线模式——每篇完成"成稿 → 生图 → 发布"全流程后，再继续下一篇。**若 `docs/{书名}/cover.png`（合集封面）尚不存在，先生成合集封面。** 然后从当前未完成篇章起，逐篇执行：①读对应章节母稿写 article.json（含 `coverPrompt`、`bilibiliCoverPrompt`——16:9 横版 B 站封面提示词，主题与竖版封面一致、构图改横版布局；写完必须检查正文字数≥3500字，不足则补写）→②执行 `pnpm dev article -f "docs/{书名}/第N篇/article.json" --engine jimeng` 生图（积分不足切 `--engine yuanbao`）→③脚本自动把图片路径写回 `cover` / image 块 `content`（提示词字段保留）→④执行 `pnpm dev publish-all -f "docs/{书名}/第N篇/article.json"` 自动发布（头条+小红书）→⑤脚本自动把 `publish` / `xhsPublish` 翻为 `true`。一篇完整走完发布流程后，再推进下一篇，全程无需用户中途插话。
- **"3+m~n"**：与"3"相同，但只处理第 m 到第 n 篇（含两端），而非从当前未完成篇起一路做到尾。范围外的篇章跳过不动。例如"3+2~6"表示只对第2、3、4、5、6篇执行成稿→生图流程。
- **"3+6+m~n"**：与"3+6"相同，但只处理第 m 到第 n 篇（含两端）。例如"3+6+2~6"表示只对第2~6篇执行成稿→生图→发布全流程，范围外的篇章跳过不动。
- **"6"**：批量发布本合集中所有未发布的成稿。**前置步骤：先检测合集是否已在三端后台创建——若 overview.json 的 `created` 或 `xhsCreated` 为 `false`、或 `bilibiliCollectionId` 为空，先执行"4+0"（`pnpm dev create-collection-all -f "docs/{书名}/overview.json"`）一次性建好三端合集，确认合集已存在后再继续。** 然后扫描 `docs/{书名}/` 下所有 `第N篇/article.json`，找出 `publish` 字段为 `false` 的篇，按序号从小到大逐篇执行 `pnpm dev publish-all -f "docs/{书名}/第N篇/article.json"`（头条立即发，小红书+B 站 72h 后自动发）；每篇头条发布成功后脚本自动把该篇 `publish` 翻为 `true`，再推进下一篇。若某篇尚未生图、对应图片文件不存在，先跳过并在结束时报出，不强行发布。
- **"4+0"（或"创建合集"）**：一次性在**头条**、**小红书**、**B 站**三端后台创建合集。前置条件：overview.json 已回填 `collectionName`、`collectionDesc`（≤100字）、`cover`（头条合集封面已生图）、`xhsCover`（小红书 3:4 封面已生图，可由 cover 裁剪/参考图生成），且 `created` / `xhsCreated` 均为 `false`、`bilibiliCollectionId` 为空。执行命令：
  ```bash
  pnpm dev create-collection-all -f "docs/{书名}/overview.json"
  ```
  脚本内部依次执行：
  1. **头条**：`pnpm dev create-collection --file <overview>` —— 查合集列表页 → 已存在且已发布则跳过 / 存在但未发布则等待 / 不存在则打开创建页填名称+封面+点创建 → 跳列表页循环刷新检测"已发布"，成功后自动把 overview.json 的 `created` 改为 `true`；
  2. **小红书**：`pnpm dev xhs create-collection -f <overview>` —— 登录检测 → 打开发布页 → 检测同名合集是否已存在（存在则直接退出）→ 填合集名 + 填合集简介 + 上传封面（自动确认裁剪）→ 点"创建" → 等"创建成功"提示 → reload，成功后自动把 overview.json 的 `xhsCreated` 改为 `true`；
  3. **B 站**：`pnpm dev bilibili create-collection -f <overview>` —— 登录检测 → 打开文集管理页 → 检测同名文集是否已存在（存在则进详情页提取 id）→ 不存在则点"创建文集"填标题+简介+上传封面（复用 `xhsCover`）→ 点"确认创建" → 等跳转到 `/opus/management/collection/{id}`，成功后把 `bilibiliCollectionId` 回填为数字 id。
  任一端失败即停下报错，不继续下一端。
- **"4+序号（1~N）"（或"发布 N"）**：对第 N 篇统一发布：头条立即发，小红书 + B 站都排期 72h 后自动发。要求该篇已完成生图、article.json 中图片字段已替换为本地路径。执行命令：
  ```bash
  pnpm dev publish-all -f "docs/{书名}/第N篇/article.json"
  ```
  脚本内部依次执行：
  1. **头条**：`pnpm dev edit --file <article> --publish` —— 自动填充并点"预览并发布"→"确认发布"，成功后自动把 `publish` 改为 `true`；头条失败即终止；
  2. **小红书 + B 站**：不立即发，在 `scheduled_posts` 表各插一条 72h 后的定时任务（channel=`xhs` / `bilibili`），由 `pnpm dev library publish` worker 到点分别自动执行 `xhs publish` / `bilibili publish`，成功后各自把 `xhsPublish` / `bilibiliPublish` 翻为 `true`。
  已 `publish=true` / `bilibiliPublish=true` / `xhsPublish=true` 的对应端会自动跳过。仅当用户明确说"先别发/我自己检查/先预览"时，才改用 `pnpm dev edit --file <article>`（不发任何端、只做头条填充不发）。
- **"5+书名"（或"评估《XXX》"）**：对指定书名执行阶段零选书评估。**不创建任何文件**，只在聊天里出判断报告。流程：①联网检索书籍信息（作者/简介/目录/核心观点/案例风格/头条竞争度），信息不足就请用户补材料；②过 10 条硬性否决项；③打 20 分评分卡，每维必须附真实证据；④按 `references/selection-sop.md` 固定模板输出结论（推荐等级/分数/候选标题/风险/下一步建议）。用户说"做"之后再进阶段一。
- **"51"（批量快速打分）**：用户一次性给多行书名，格式如下：
  ```
  51
  书名1
  书名2
  书名3
  ```
  对每本书**快速**过一遍否决项+评分卡（不需要像"5"那样深挖 6 项信息、不需要逐条列否决项、不需要候选标题），**并行检索**多本书以提速。最终只输出一张紧凑表格：书名 / 分数 / 判读（✅做 / ⚠️试写 / ❌弃）/ 一句话理由。**不创建任何文件、不出完整评语**。用户看中哪本，再单独发 `5《书名》` 出深度报告。
- **"7"（或"收集话题"）**：从 overview.json 提炼 **2～3 个不同维度的关键词**，分别调用 collect-topics 脚本收集头条推荐话题，每个关键词选讨论热度最高的 1 个，共 2～3 个不同关键词的话题，写入 overview.json 的 `tags` 字段（格式 `#话题名#`，数组形式），并同步覆盖所有已存在的 `第N篇/article.json` 的 `tags` 字段。流程：
  1. 读 overview.json，根据 `theme` / `genre` / 合集主题提炼 **2～3 个不同维度的关键词**（如合集讲摆摊创业 → 关键词分别为"摆摊""副业""创业"，覆盖不同流量池）；
  2. 对每个关键词分别执行 `pnpm dev collect-topics --keyword <关键词>`，各自拿到话题列表（含讨论数）；
  3. 从每个关键词的结果中选讨论数最高的 1 个话题，格式化为 `#话题名#`，共 2～3 个；
  4. 写入 overview.json 顶层 `tags` 字段（数组，2～3 个元素，分别来自不同关键词），同时写入 `tagsCollected: true` 标记话题收集已完成；
  5. 遍历 `docs/{书名}/第N篇/article.json`，把每篇的 `tags` 字段同步覆盖为此值。
  后续新生成的成稿按阶段二规则直接沿用此 tags。
- **"8"（或"清空草稿"）**：执行 `pnpm dev delete-drafts --headless`，循环删除草稿箱里所有草稿。通常在批量发布（"6"）前先跑一次，避免草稿箱堆积测试残留。
- **"9"（或"一条龙"）**：从合集名确认后一路跑到全部发布完成。**前置条件：overview.json 的 `collectionName` 已回填。** 顺序执行：
  1. **"7"**：提炼 2~3 个不同关键词 → 分别 collect-topics → 每个关键词选热度最高的话题（共 2~3 个）→ 写入 overview.tags；
  2. **"2+0"**：生成合集封面并保存，回填 overview.cover 路径；
  3. **"4+0"**：执行 `pnpm dev create-collection-all -f "docs/{书名}/overview.json"` 在头条 + 小红书两端建好合集，等"已发布"，并把 overview.created / xhsCreated 翻为 true；
  4. **逐篇流水线**：从第1篇开始，每篇依次执行「读对应章节 → 写 article.json（写完必须检查正文字数≥3500字，不足则补写）→ `pnpm dev article --engine jimeng` 生图（积分不足切 `--engine yuanbao`）→ 路径自动写回 cover/content（提示词字段保留）→ `pnpm dev publish-all -f <article>` 自动发布头条 + 小红书 → publish / xhsPublish 翻为 true」。一篇完整走完发布流程后，再推进下一篇，已完成篇章跳过。
  5. **"8"**：清空草稿箱。
  全程无需用户中途插话，任一步失败则停下报错。
- **"11"（或"全自动流水线"）**：从推荐表自动取书，一路跑到批量发布。流程：
  1. 执行 `pnpm dev library next-recommendation` 取书：优先 processing（恢复中断），其次 pending；取到后执行 `pnpm dev library download-book -i <id>` 获取书的本地文件路径（本地有则直接返回，没有则从夸克网盘下载到 books/ 目录）；
  2. 如果没取到，执行快捷指令"10"补推荐，再回到步骤 1；若取到的是 processing 状态的书，先 `rec-workdir` 检查：若所有文章都已生成（articles 里每篇 hasArticle=true），且对此书工作目录执行 `pnpm dev library schedule-book -d "docs/书名"` 后显示 0 条新增 → 说明此书已全部跑完，执行 `pnpm dev library set-status -t recommendation -i <id> -s done`，回到步骤 1 重新取书；否则继续。
  3. 取到书后，先 `pnpm dev library rec-workdir -i <id>` 看工作区状态：
     - 若已有 overview.json → 从上次中断处继续；
     - 若无 → 进入阶段一全书总览，写完 overview.json 后执行 `pnpm dev library set-workdir -i <id> -d "docs/书名"`；
  4. 从 overview.json 的 `collectionNameCandidates` 里按爆款标题选择指南选一个最终合集名，更新 overview.json 的 `collectionName` 和 `collectionCoverPrompt`；
  5. **执行"7"收集话题**：提炼 2~3 个不同维度关键词 → 分别 collect-topics → 每个关键词选热度最高的话题（共 2~3 个）→ 写入 overview.tags 并标记 tagsCollected: true；
  6. 执行"2+0"生成合集封面；
  7. 执行"3"完成所有篇章的成稿+生图（不发布）；**⚠️ 硬规则：生图时优先 `--engine jimeng`，若即梦报积分不足，立即改用 `--engine yuanbao` 继续；若元宝也失败（未登录/出图失败），才暂停后续所有流程——停止创建合集、停止定时任务、停止标记 done。报告用户当前进度（已完成几篇成稿、已生成哪些图、剩余待生成数量），等待积分恢复或环境修复后再继续。**
  8. 执行"4+0"（`pnpm dev create-collection-all`）在头条 + 小红书两端创建合集；
  9. 执行定时任务创建：`pnpm dev library schedule-book -d "docs/书名"`，自动从现有任务最远时间接下去，每天5篇、每篇隔1小时，到点由 worker 自动发布（worker 内头条发完后会自动同步发小红书）。
  10. 定时任务设置完成后，执行 `pnpm dev library set-status -t recommendation -i <id> -s done`，标记此书已全部处理完。

- **"111"（或"即时发布模式"）**：在【11】基础上，不走定时任务，而是逐篇流水线：每篇完成"成稿 → 生图 → 立即发布"后，再继续下一篇。流程：
  1. 取书、下载、概览、选标题、收话题、生成合集封面；
  2. **先执行"4+0"创建合集**：执行 `pnpm dev create-collection-all -f "docs/书名/overview.json"`，在头条 + 小红书两端建好合集，等"已发布"，把 overview.created / xhsCreated 翻为 true。**合集创建完成后，才开始逐篇推进篇章。**
  3. 从第1篇开始逐篇流水线：每篇依次执行「读对应章节 → 写 article.json（写完必须检查正文字数≥3500字，不足则补写）→ `pnpm dev article --engine jimeng` 生图（积分不足切 `--engine yuanbao`）→ 路径自动写回 cover/content（提示词字段保留）→ `pnpm dev publish-all -f <article>` 自动发布头条 + 小红书 → publish / xhsPublish 翻为 true」。一篇完整走完发布流程后，再推进下一篇，已完成篇章跳过。
  4. **⚠️ 硬规则：生图时优先 `--engine jimeng`，若即梦报积分不足，立即改用 `--engine yuanbao` 继续；若元宝也失败（未登录/出图失败），才暂停所有后续流程——停止逐篇推进、停止标记 done。报告用户当前进度（已完成几篇成稿、已生成哪些图、剩余待生成数量），等待积分恢复或环境修复后再继续。**
  5. 全部发布完后，执行 `pnpm dev library set-status -t recommendation -i <id> -s done`。
  与【11】的区别：不创建定时任务、不等时间到点、生成一篇发一篇；**合集创建在篇章推进之前完成**。

- **"101"（或"取一本"）**：从推荐表取一本待处理的书。执行 `pnpm dev library next-recommendation`：
  - 如果返回了书，输出书名、分数、理由、文件 URL；
  - 如果没有待处理的书，则执行快捷指令"10"（批量打分选书），直到推荐表中出现 ≥15 分的书并被录入，再回到本指令取书；
  - 如果书库耗尽（"10"也取不到书），则停止并说明。
- **"10"（或"试读5本"）**：从电子书库随机抽 5 本 ≤2MB 的未处理书，批量打分选书。流程：
  1. 执行命令：`pnpm dev library next-book --limit 5 --ext epub --max-size 10MB`，从输出 JSON 的 files 数组拿到 5 个书名；
  2. 把这 5 个书名按"51"格式列出来，走批量打分流程（并行检索、紧凑表格）；
  3. 输出表格：书名 / 分数 / 判读 / 一句话理由；
  4. 对评分 < 15 分的书，执行 `pnpm dev library set-status -t file -i <id> -s done` 标记为已处理；
  5. 对评分 ≥ 15 分的书，先执行 `pnpm dev library add-recommendation -f <id> -s <分数> -r "<理由>"` 录入推荐表，再执行 `pnpm dev library set-status -t file -i <id> -s done` 标记为已处理；
  6. 如果本次 5 本全部 < 15 分（没有值得做的），则重新执行第 1 步再取 5 本继续打分，直到找到 ≥ 15 分的或书库耗尽。用户看中哪本，再单独发 `5《书名》` 出深度报告。
- **"12"（或"查状态"/"工作区状态"/"查工作区"）**：查看当前书籍或指定推荐书的工作区属性。用法：
  - 直接发 `"12"`：查当前正在处理的书的工作区状态（默认取最近一本 processing 或 done 的推荐书；若无则提示用户指定 id）；
  - 发 `"12+id"`：查指定 id 的推荐书工作区状态（如 `"12+1"`）。
  
  执行命令：`pnpm dev library rec-workdir -i <id>`，拿到 JSON 后按以下格式输出：
  1. **整体状态表**：书名 / 工作目录 / 合集名 / 合集封面 / 文章总数 / 合集已创建 / 话题已收集 / 已发布数；
  2. **各篇详情表**：篇号 / 标题 / 成稿 / 配图 / 字数 / 已发布；
  3. **异常提醒**：若有文章字数 < 3500、缺图、未生图等，在表格下方标出，提醒用户补写或补图。

## 硬性约束（全流程）

- 不新增母稿/书籍以外的事实、数据、案例、引语；案例以书中内容为底，转为生活化叙事。
- 成稿不出现"书/章节/目录/这本书"等书籍概念；不编造外部背书。
- 标题不夸大不欺骗，标题承诺必须在正文兑现。
- 主标题对应 article.json 的 `title` 字段（H1）；备选标题放 `altTitles`。
- **【最高优先级硬约束】主标题不超过 30 个字（含标点，数字按 1 字计）；每篇写完必须立即数一遍字数，超限先压缩再交付，绝不带超长篇进入生图/发布环节。**
- **【最高优先级硬约束】成稿正文（不含标题、提示词、标签）不低于 3500 字。每篇写完后必须立即统计正文字数（content 数组中所有 type="text" 的 content 长度之和），不足 3500 字必须补写达标后才能交付，绝不把短稿送入生图或发布环节。**
- **合集简介（overview.collectionDesc）不超过 100 字**；写完数一遍字数，超限先压缩再写入 JSON。
- 自然分段：段落承载完整意思单元，不逐句拆段，也不长段堆砌。
- 引号一律用中文弯引号“”，成对出现，相邻引号对之间用顿号或逗号分隔。
- 画面风格：封面、插图一律漫画/绘本/手绘插画质感，不使用写实或摄影风格。
- 生图优先走即梦脚本（Seedream 4.7，2K、智能模式）；即梦积分不足时自动切元宝（yuanbao + 文心一言去水印）。同一合集内一旦切换引擎就不再回切。
- 句式可以雷同，用词不能千篇一律：标题模板只作参考框架，各篇用词灵活变换。
- 图片文件名一律带后缀（.png/.jpg/.jpeg），同一合集内统一后缀。
- 每篇成稿插图数量不超过 5 张（含封面外的全部插图）；多出来的段落不配图，硬控数量。
- 插图之间至少间隔一个正文段落，正文里不得连续出现两个 image 块（即不允许"插图→插图"相邻）；每张插图前后都要有文字内容承接。

## 参考文件

- `references/article-template.md`：成稿结构与写作要点
- `references/image-prompts.md`：封面/插图提示词规范与模板
- `references/selection-sop.md`：选书评估 SOP
- `references/title-selection-guide.md`：合集爆款标题选择指南（"11"步骤 4 使用）（"5+书名"深度评估 + "51"批量打分的完整评判标准：否决项、20 分评分卡、输出模板、反幻觉约束）
