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
  .description('Scan all runtimes for duplicate skills and potential space savings')
  .option('--json', 'Output analysis results as JSON')
  .option('--snapshot', 'Output a reproducible snapshot (lockfile-style JSON)')
  .action((options) => {
    try {
      runDoctor({ json: options.json === true, snapshot: options.snapshot === true });
    } catch (err: any) {
      display.error(`doctor command failed: ${err.message}`);
      display.info('Run sk doctor --help for usage information.');
      process.exit(1);
    }
  });

program
  .command('dedupe')
  .description('Automatically or interactively migrate duplicate skills to ~/.skills/ and replace with symlinks')
  .option('--dry-run', 'Preview operations without modifying any files')
  .action(async (options) => {
    try {
      await runDedupe({ dryRun: options.dryRun === true });
    } catch (err: any) {
      display.error(`dedupe command failed: ${err.message}`);
      display.info('To preview without making changes, use sk dedupe --dry-run.');
      process.exit(1);
    }
  });

program
  .command('link')
    .argument('[name]', 'Skill name')
    .option('-r, --runtime <runtime>', 'Target runtime to link to (e.g. claude, cursor, codex)')
    .option('-a, --all', 'Link to all configured runtimes')
    .description('Create symlinks from ~/.skills/<name> to target runtime directories')
  .action((name, options) => {
    try {
      runLink(name, options);
    } catch (err: any) {
      display.error(`link command failed: ${err.message}`);
      display.info('Use sk link --help for usage.');
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all skills in ~/.skills/ and their symlink status across runtimes')
  .action(() => {
    try {
      runList();
    } catch (err: any) {
      display.error(`list command failed: ${err.message}`);
      display.info('Run sk list --help for usage.');
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
        display.error('Please provide a skill directory path, or use --all-from <runtime> for batch install.');
        display.info('Example: sk install ~/my-skill  or  sk install --all-from claude');
        process.exit(1);
      }
    } catch (err: any) {
      display.error(`install command failed: ${err.message}`);
      display.info('Use sk install --help for usage.');
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
      display.error(`uninstall command failed: ${err.message}`);
      display.info('Use sk uninstall --help for usage.');
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Watch runtime directories for new skills')
  .option('-r, --runtime <runtime>', 'Only watch specific runtime (e.g. claude, cursor)')
  .action(async (options) => {
    try {
      await runWatch({ runtime: options.runtime });
    } catch (err: any) {
      display.error(`watch command failed: ${err.message}`);
      display.info('Use sk watch --help for usage.');
      process.exit(1);
    }
  });

// If no command is provided, display help
if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}
