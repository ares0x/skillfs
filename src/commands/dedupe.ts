import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { analyzeRuntimes, getSkillMtime, formatDate, getDirectorySize, formatBytes } from './doctor.js';
import { getCentralSkillsPath } from '../core/config.js';
import { copyDirectory, removeDirectory, safeCreateSymlink, ensureDirExists, resolveHomePath } from '../utils/fs.js';
import { registerSkillRuntime, syncSkillRuntimes, lockRegistry } from '../core/registry.js';
import { display, formatPath } from '../utils/display.js';
import { Skill } from '../core/skill.js';

/** Maximum lines for LCS diff before falling back to simple comparison */
const MAX_DIFF_LINES = 5000;

/** File size threshold (1MB) above which streaming hash is used */
const STREAMING_HASH_THRESHOLD = 1024 * 1024;

export interface DedupeOptions {
  dryRun: boolean;
}

interface TransactionEntry {
  timestamp: string;
  skillName: string;
  operation: string;
  source: string;
  dest: string;
  status: 'started' | 'completed' | 'rolled_back';
  runtimes: string[];
}

const TXN_LOG_PATH = path.join(resolveHomePath('~/.skills'), '.dedupe-txn.log');

function appendTransaction(entry: TransactionEntry): void {
  ensureDirExists(resolveHomePath('~/.skills'));
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(TXN_LOG_PATH, line, 'utf8');
}

export function getIncompleteTransactions(): TransactionEntry[] {
  try {
    if (!fs.existsSync(TXN_LOG_PATH)) return [];
    const content = fs.readFileSync(TXN_LOG_PATH, 'utf8').trim();
    if (!content) return [];
    const lines = content.split('\n');
    const entries: TransactionEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as TransactionEntry;
        entries.push(entry);
      } catch { /* skip malformed */ }
    }
    // Find transactions that started but never completed or rolled back
    const latestBySkill = new Map<string, TransactionEntry>();
    for (const entry of entries) {
      latestBySkill.set(entry.skillName, entry);
    }
    return [...latestBySkill.values()].filter(e => e.status === 'started');
  } catch {
    return [];
  }
}

/**
 * Hashes a file using streaming (createReadStream) for files > 1MB,
 * and readFileSync for smaller files. Returns a promise.
 */
function hashFileStream(filePath: string, hash: ReturnType<typeof createHash>): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Computes a recursive hash of a directory for copy verification.
 * For files larger than 1MB, uses streaming to avoid loading entire
 * files into memory at once.
 */
async function hashDirectory(dirPath: string): Promise<string> {
  const hash = createHash('md5');
  const resolved = resolveHomePath(dirPath);

  async function walk(d: string): Promise<void> {
    const items = fs.readdirSync(d).sort();
    for (const item of items) {
      const full = path.join(d, item);
      const stat = fs.lstatSync(full);
      hash.update(item);
      if (stat.isFile()) {
        if (stat.size > STREAMING_HASH_THRESHOLD) {
          await hashFileStream(full, hash);
        } else {
          hash.update(fs.readFileSync(full));
        }
      } else if (stat.isDirectory()) {
        await walk(full);
      }
    }
  }

  await walk(resolved);
  return hash.digest('hex');
}

/**
 * Prints a simple side-by-side diff for large files that exceed the LCS limit.
 */
function simpleSideBySideDiff(lines1: string[], lines2: string[], label1: string, label2: string): void {
  const maxLines = Math.max(lines1.length, lines2.length);
  const maxShown = 100; // Show at most 100 lines to avoid flooding the terminal

  console.log(chalk.yellow(`  ⚠ Large files (${lines1.length} vs ${lines2.length} lines), showing first ${Math.min(maxLines, maxShown)} lines side-by-side:`));
  console.log(chalk.gray(`  ${''.padEnd(40)} ${label1.padEnd(40)} | ${label2}`));

  for (let i = 0; i < Math.min(maxLines, maxShown); i++) {
    const l1 = i < lines1.length ? lines1[i].substring(0, 40) : '';
    const l2 = i < lines2.length ? lines2[i].substring(0, 40) : '';
    const marker = l1 !== l2 ? chalk.yellow('≠') : ' ';
    console.log(`  ${marker} ${l1.padEnd(40)} | ${l2}`);
  }

  if (maxLines > maxShown) {
    console.log(chalk.gray(`  ... ${maxLines - maxShown} more lines truncated`));
  }
}

/**
 * Computes and prints the line-by-line diff between two file contents.
 * Falls back to a simple side-by-side comparison if either file exceeds
 * MAX_DIFF_LINES to avoid allocating a huge LCS DP table.
 */
function printDiff(content1: string, content2: string, label1: string, label2: string): void {
  console.log(chalk.bold.blue(`\n--- Diff: ${label1} (-) vs ${label2} (+) ---`));
  
  const lines1 = content1.split(/\r?\n/);
  const lines2 = content2.split(/\r?\n/);

  // Guard against excessive memory allocation: if either file is too large,
  // fall back to a simple side-by-side comparison
  if (lines1.length > MAX_DIFF_LINES || lines2.length > MAX_DIFF_LINES) {
    simpleSideBySideDiff(lines1, lines2, label1, label2);
    console.log(chalk.bold.blue('--------------------------------------------------\n'));
    return;
  }

  // Dynamic programming LCS table
  const dp: number[][] = Array(lines1.length + 1)
    .fill(0)
    .map(() => Array(lines2.length + 1).fill(0));

  for (let i = 1; i <= lines1.length; i++) {
    for (let j = 1; j <= lines2.length; j++) {
      if (lines1[i - 1] === lines2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build the diff
  const diffLines: string[] = [];
  let i = lines1.length;
  let j = lines2.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
      diffLines.unshift(`  ${lines1[i - 1]}`);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffLines.unshift(chalk.green(`+ ${lines2[j - 1]}`));
      j--;
    } else {
      diffLines.unshift(chalk.red(`- ${lines1[i - 1]}`));
      i--;
    }
  }

  console.log(diffLines.join('\n'));
  console.log(chalk.bold.blue('--------------------------------------------------\n'));
}

/**
 * Transactional migration: copy → verify → remove originals → symlink → registry.
 * On any failure, rolls back partially completed work.
 */
async function migrateSkill(selectedSkill: Skill, allVersions: Skill[], options: DedupeOptions): Promise<void> {
  const centralRoot = getCentralSkillsPath();
  const destPath = path.join(centralRoot, selectedSkill.name);
  const runtimes = allVersions.map(v => v.runtime);

  if (options.dryRun) {
    display.info(`[DRY RUN] Would copy ${formatPath(selectedSkill.path)} → ${formatPath(destPath)}`);
    for (const version of allVersions) {
      display.info(`[DRY RUN] Would remove original ${formatPath(version.path)} and create symlink → ${formatPath(destPath)}`);
    }
    const sizePerCopy = getDirectorySize(selectedSkill.path);
    const savings = sizePerCopy * (allVersions.length - 1);
    display.info(`[DRY RUN] Estimated space savings: ${formatBytes(savings)} (${allVersions.length - 1} copies × ${formatBytes(sizePerCopy)} each)`);
    display.info(`[DRY RUN] Would update registry with runtimes: ${runtimes.join(', ')}`);
    return;
  }

  const txnEntry: TransactionEntry = {
    timestamp: new Date().toISOString(),
    skillName: selectedSkill.name,
    operation: 'migrate',
    source: selectedSkill.path,
    dest: destPath,
    status: 'started',
    runtimes,
  };
  appendTransaction(txnEntry);

  // Phase 1: Copy selected version to ~/.skills/<name>
  display.info(`Copying ${formatPath(selectedSkill.path)} → ${formatPath(destPath)}...`);

  // If destination already exists, back it up before overwriting
  let destExisted = false;
  let destBackup: string | null = null;
  if (fs.existsSync(destPath) || (() => { try { return fs.lstatSync(destPath).isSymbolicLink(); } catch { return false; } })()) {
    destExisted = true;
    destBackup = destPath + '.backup-' + Date.now();
    try {
      fs.renameSync(destPath, destBackup);
      display.warn(`Existing destination backed up to ${formatPath(destBackup)}`);
    } catch (err: any) {
      throw new Error(`Failed to backup existing destination ${formatPath(destPath)}: ${err.message}`);
    }
  }

  try {
    // Step 1: Copy
    ensureDirExists(centralRoot);
    copyDirectory(selectedSkill.path, destPath);
    display.success(`Copy complete: ${formatPath(destPath)}`);

    // Step 2: Verify the copy
    display.info(`Verifying copy integrity...`);
    const srcHash = await hashDirectory(selectedSkill.path);
    const destHash = await hashDirectory(destPath);
    if (srcHash !== destHash) {
      throw new Error(`Copy verification failed: hash mismatch (src=${srcHash.slice(0, 8)}..., dest=${destHash.slice(0, 8)}...)`);
    }
    display.success(`Copy verified (hash: ${srcHash.slice(0, 8)}...)`);

    // Step 3: Remove all originals and create symlinks
    for (const version of allVersions) {
      const versionPath = version.path;
      // Skip if the selected skill IS this version and we already copied it
      // (the selected skill's original is replaced with a symlink too)
      display.info(`Processing ${formatPath(versionPath)}: removing original and creating symlink...`);
      removeDirectory(versionPath);
      safeCreateSymlink(destPath, versionPath, centralRoot);
      display.success(`  ${formatPath(versionPath)} → ${formatPath(destPath)}`);
    }

    // Step 4: Update registry
    syncSkillRuntimes(selectedSkill.name, runtimes);
    display.success(`Registry updated: ${selectedSkill.name} → [${runtimes.join(', ')}]`);

    // Clean up backup if everything succeeded
    if (destBackup && fs.existsSync(destBackup)) {
      removeDirectory(destBackup);
    }

    // Mark transaction as completed
    txnEntry.status = 'completed';
    appendTransaction(txnEntry);
    display.success(`Skill ${display.bold(selectedSkill.name)} deduplicated and migrated successfully!`);
  } catch (err: any) {
    display.error(`Migration failed: ${err.message}`);
    display.info('Rolling back...');

    // Rollback: remove partial copy at dest
    if (fs.existsSync(destPath)) {
      try {
        removeDirectory(destPath);
        display.info(`Removed incomplete copy: ${formatPath(destPath)}`);
      } catch (cleanErr: any) {
        display.warn(`Cleanup failed: ${cleanErr.message}`);
      }
    }

    // Restore backup if we had one
    if (destBackup && fs.existsSync(destBackup)) {
      try {
        fs.renameSync(destBackup, destPath);
        display.info(`Restored backup: ${formatPath(destPath)}`);
      } catch (restoreErr: any) {
        display.warn(`Restore backup failed: ${restoreErr.message}, backup at ${formatPath(destBackup)}`);
      }
    }

    // Mark transaction as rolled back
    txnEntry.status = 'rolled_back';
    appendTransaction(txnEntry);

    throw new Error(`Migration of ${selectedSkill.name} failed, all changes rolled back. Reason: ${err.message}`);
  }
}

/**
 * Handles the interactive resolution of a conflicting duplicate skill group.
 */
async function resolveConflict(groupName: string, skills: Skill[], options: DedupeOptions): Promise<boolean> {
  const sorted = [...skills].sort((a, b) => getSkillMtime(b.path).getTime() - getSkillMtime(a.path).getTime());

  let resolved = false;
  let skipped = false;

  while (!resolved) {
    console.log(chalk.bold.yellow(`\n⚠ ${groupName} has version conflicts. Choose which version to keep:\n`));

    for (let index = 0; index < sorted.length; index++) {
      const skill = sorted[index];
      const mtime = getSkillMtime(skill.path);
      const size = getDirectorySize(skill.path);
      console.log(`  [${index + 1}] ${formatPath(skill.path)}`);
      console.log(`      Modified ${formatDate(mtime)}, size ${formatBytes(size)}`);
      console.log(`      Preview: ${skill.description || '(no description)'}\n`);
    }

    console.log(`  [s] Skip for now`);
    console.log(`  [d] Show diff\n`);

    if (options.dryRun) {
      display.info(`[DRY RUN] Skipping interactive conflict resolution. Selecting version 1 (newest) for simulation.`);
      const selectedSkill = sorted[0];
      await migrateSkill(selectedSkill, skills, options);
      resolved = true;
      break;
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'choice',
        message: 'Choice (number/s/d):',
        validate: (input: string) => {
          const val = input.trim().toLowerCase();
          if (val === 's' || val === 'd') return true;
          const num = parseInt(val, 10);
          if (!isNaN(num) && num >= 1 && num <= sorted.length) return true;
          return `Please enter 1-${sorted.length}, or s/d`;
        }
      }
    ]);

    const choice = answers.choice.trim().toLowerCase();

    if (choice === 's') {
      display.warn(`Skipped deduplication of ${groupName}`);
      resolved = true;
      skipped = true;
    } else if (choice === 'd') {
      // Diff first and second version
      if (sorted.length >= 2) {
        const skill1 = sorted[0];
        const skill2 = sorted[1];
        const file1 = path.join(skill1.path, 'SKILL.md');
        const file2 = path.join(skill2.path, 'SKILL.md');
        
        let content1 = '';
        let content2 = '';
        
        if (fs.existsSync(file1)) content1 = fs.readFileSync(file1, 'utf8');
        if (fs.existsSync(file2)) content2 = fs.readFileSync(file2, 'utf8');

        printDiff(content1, content2, formatPath(skill1.path), formatPath(skill2.path));
      } else {
        console.log(chalk.red('Need at least two versions to diff.'));
      }
    } else {
      const idx = parseInt(choice, 10) - 1;
      const selectedSkill = sorted[idx];
      await migrateSkill(selectedSkill, skills, options);
      resolved = true;
    }
  }

  return skipped;
}

/**
 * Runs the sk dedupe command.
 */
export async function runDedupe(options: DedupeOptions = { dryRun: false }): Promise<void> {
  display.header(`SkillFS Dedupe 🔨${options.dryRun ? ' (DRY RUN)' : ''}`);

  const analysis = analyzeRuntimes();
  const { duplicates, savingsBytes } = analysis;

  if (duplicates.length === 0) {
    console.log(display.green('  ✓ No duplicates found, nothing to dedupe!\n'));
    return;
  }

  if (options.dryRun) {
    display.info(`Found ${duplicates.length} duplicate groups, estimated ${formatBytes(savingsBytes)} savings.`);
    console.log('');
  }

  let migratedCount = 0;
  let skippedCount = 0;

  for (const group of duplicates) {
    if (group.identical) {
      console.log(`\nFound identical skill ${display.bold(group.name)}, ${options.dryRun ? 'simulating' : 'auto-'}deduplicating...`);
      try {
        await migrateSkill(group.skills[0], group.skills, options);
        migratedCount++;
      } catch (err: any) {
        display.error(`Deduplication of ${group.name} failed: ${err.message}`);
        skippedCount++;
      }
    } else {
      // Conflicting skill, require interactive resolution
      try {
        const skipped = await resolveConflict(group.name, group.skills, options);
        if (skipped) {
          skippedCount++;
        } else {
          migratedCount++;
        }
      } catch (err: any) {
        display.error(`Conflict resolution for ${group.name} failed: ${err.message}`);
        skippedCount++;
      }
    }
  }

  console.log(`\n${options.dryRun ? '[DRY RUN] ' : ''}Deduplication report:`);
  display.success(`Migrated: ${migratedCount} skill(s)${options.dryRun ? ' (simulated)' : ''}`);
  if (skippedCount > 0) {
    display.warn(`Skipped: ${skippedCount} skill(s)`);
  }
  if (options.dryRun) {
    display.info(`Estimated space savings: ${formatBytes(savingsBytes)}`);
    display.info('Run sk dedupe (without --dry-run) to execute the migration.');
  }
  console.log('');
}
