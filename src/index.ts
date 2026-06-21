#!/usr/bin/env node

import { Command } from 'commander';
import { runDoctor } from './commands/doctor.js';
import { runDedupe } from './commands/dedupe.js';
import { runLink } from './commands/link.js';
import { runList } from './commands/list.js';
import { runInstall, runInstallAllFromRuntime } from './commands/install.js';
import { runUninstall } from './commands/uninstall.js';
import { runWatch } from './commands/watch.js';
import { display } from './utils/display.js';

const program = new Command();

program
  .name('sk')
  .description('SkillFS - CLI tool to manage and deduplicate agent skills')
  .version('1.0.0');

program
  .command('doctor')
  .description('扫描并发现所有运行时的重复 Skill 和潜在节省空间')
  .option('--json', '以 JSON 格式输出分析结果')
  .option('--snapshot', '输出可重现的快照 (lockfile-style JSON)')
  .action((options) => {
    try {
      runDoctor({ json: options.json === true, snapshot: options.snapshot === true });
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

program
  .command('install')
  .argument('[path]', 'Path to skill directory to install (omit when using --all-from)')
  .option('-r, --runtime <runtime>', 'Target runtime (e.g. claude, cursor)')
  .option('--all-from <runtime>', 'Batch-install all non-symlink skills from a runtime directory')
  .option('--dry-run', 'Preview only — no files are modified')
  .description('Install skill(s) to ~/.skills/ and link to runtimes')
  .action(async (sourcePath, options) => {
    try {
      if (options.allFrom) {
        await runInstallAllFromRuntime(options.allFrom, {
          runtime: options.runtime,
          dryRun: options.dryRun === true,
        });
      } else if (sourcePath) {
        await runInstall(sourcePath, {
          runtime: options.runtime,
          dryRun: options.dryRun === true,
        });
      } else {
        display.error('请提供 skill 目录路径，或使用 --all-from <runtime> 批量安装。');
        display.info('示例: sk install ~/my-skill  或  sk install --all-from claude');
        process.exit(1);
      }
    } catch (err: any) {
      display.error(`install 命令执行失败: ${err.message}`);
      display.info('使用 sk install --help 查看用法。');
      process.exit(1);
    }
  });

program
  .command('uninstall')
  .argument('<name>', 'Skill name to uninstall')
  .option('-r, --runtime <runtime>', 'Only remove from specific runtime')
  .description('Remove a skill from ~/.skills/ and clean up symlinks')
  .action(async (name, options) => {
    try {
      await runUninstall(name, { runtime: options.runtime });
    } catch (err: any) {
      display.error(`uninstall 命令执行失败: ${err.message}`);
      display.info('使用 sk uninstall --help 查看用法。');
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('监听运行时目录，发现新 skill 时通知')
  .option('-r, --runtime <runtime>', '仅监听指定运行时 (例如: claude, cursor)')
  .action(async (options) => {
    try {
      await runWatch({ runtime: options.runtime });
    } catch (err: any) {
      display.error(`watch 命令执行失败: ${err.message}`);
      display.info('使用 sk watch --help 查看帮助信息。');
      process.exit(1);
    }
  });

// If no command is provided, display help
if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}
