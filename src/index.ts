#!/usr/bin/env node
import { Command } from "commander";
import { registerOpenCommand } from "./commands/open.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerEditCommand } from "./commands/edit.js";
import { registerCreateCollectionCommand } from "./commands/create-collection.js";
import { registerCollectTopicsCommand } from "./commands/collect-topics.js";
import { registerDeleteDraftsCommand } from "./commands/delete-drafts.js";
import { registerQuarkLoginCommand } from "./commands/quark-login.js";
import { registerCollectQuarkBooksCommand } from "./commands/collect-quark-books.js";
import { registerLibraryCommand } from "./commands/library/index.js";
import { registerCountWordsCommand } from "./commands/count-words.js";
import { registerLaunchdCommands } from "./commands/launchd.js";
import { registerDoubaoCommand } from "./commands/doubao/index.js";
import { registerJimengCommand } from "./commands/jimeng/index.js";
import { registerYuanbaoCommand } from "./commands/yuanbao/index.js";
import { registerXhsCommand } from "./commands/xhs/index.js";
import { registerBilibiliCommand } from "./commands/bilibili/index.js";
import { registerCoverCommand } from "./commands/cover.js";
import { registerArticleCommand } from "./commands/article.js";
import { registerCompressCommand } from "./commands/compress.js";
import { registerCreateCollectionAllCommand } from "./commands/create-collection-all.js";
import { registerPublishAllCommand } from "./commands/publish-all.js";

const program = new Command();

program
  .name("toutiao")
  .description("基于 Playwright 的浏览器自动化脚本，登录态持久化")
  .version("0.1.0");

registerOpenCommand(program);
registerLoginCommand(program);
registerEditCommand(program);
registerCreateCollectionCommand(program);
registerCollectTopicsCommand(program);
registerDeleteDraftsCommand(program);
registerQuarkLoginCommand(program);
registerCollectQuarkBooksCommand(program);
registerLibraryCommand(program);
registerCountWordsCommand(program);
registerLaunchdCommands(program);
registerDoubaoCommand(program);
registerJimengCommand(program);
registerYuanbaoCommand(program);
registerXhsCommand(program);
registerBilibiliCommand(program);
registerCoverCommand(program);
registerArticleCommand(program);
registerCompressCommand(program);
registerCreateCollectionAllCommand(program);
registerPublishAllCommand(program);

program.parseAsync(process.argv);
