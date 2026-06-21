#!/usr/bin/env node

import { Command } from 'commander';
import { runDoctor } from './commands/doctor.js';
import { runDedupe } from './commands/dedupe.js';
import { runLink } from './commands/link.js';
import { runList } from './commands/list.js';
import { display } from './utils/display.js';

const program = new Command();

program
  .name('sk')
  .description('SkillFS - CLI tool to manage and deduplicate agent skills')
  .version('1.0.0');

program
  .command('doctor')
  .description('扫描并发现所有运行时的重复 Skill 和潜在节省空间')
  .action(() => {
    try {
      runDoctor();
    } catch (err: any) {
      display.error(`doctor 命令执行失败: ${err.message}`);
      display.info('运行 sk doctor --help 查看帮助信息。');
      process.exit(1);
    }
  });

program
  .command('dedupe')
  .description('自动或交互式地将重复 Skill 迁移到 ~/.skills/ 并替换为软链接')
  .option('--dry-run', '仅预览将要执行的操作，不实际修改任何文件')
  .action(async (options) => {
    try {
      await runDedupe({ dryRun: options.dryRun === true });
    } catch (err: any) {
      display.error(`dedupe 命令执行失败: ${err.message}`);
      display.info('如需预览操作而不实际修改，请使用 sk dedupe --dry-run。');
      process.exit(1);
    }
  });

program
  .command('link')
  .argument('[name]', 'Skill 名称')
  .option('-r, --runtime <runtime>', '要链接的目标运行时 (例如: claude, agent, clawdbot)')
  .option('-a, --all', '链接到所有配置的运行时')
  .description('创建从中央仓库 ~/.skills/<name> 指向目标运行时目录的软链接')
  .action((name, options) => {
    try {
      runLink(name, options);
    } catch (err: any) {
      display.error(`link 命令执行失败: ${err.message}`);
      display.info('使用 sk link --help 查看用法。');
      process.exit(1);
    }
  });

program
  .command('list')
  .description('列出 ~/.skills 中的所有 Skill 及其在各运行时的软链接连接状态')
  .action(() => {
    try {
      runList();
    } catch (err: any) {
      display.error(`list 命令执行失败: ${err.message}`);
      display.info('运行 sk list --help 查看帮助信息。');
      process.exit(1);
    }
  });

// If no command is provided, display help
if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}
