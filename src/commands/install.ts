import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { getCentralSkillsPath, getRuntimeConfigs } from '../core/config.js';
import { registerSkillRuntime } from '../core/registry.js';
import { resolveHomePath, copyDirectory, safeCreateSymlink, ensureDirExists } from '../utils/fs.js';
import { display, formatPath } from '../utils/display.js';

export interface InstallOptions {
  runtime?: string;
  dryRun?: boolean;
}

/**
 * Installs one skill: copy to ~/.skills/ and symlink to target runtimes.
 * Returns the skill name if installed, null if skipped/failed.
 */
async function installOneSkill(
  sourceDir: string,
  skillName: string,
  targetRuntime: string | undefined,
  dryRun: boolean
): Promise<string | null> {
  const centralRoot = getCentralSkillsPath();
  const destPath = path.join(centralRoot, skillName);

  if (dryRun) {
    display.info(`[DRY RUN] Would copy ${formatPath(sourceDir)} → ${formatPath(destPath)}`);
    return skillName;
  }

  // Copy
  display.info(`Copying ${formatPath(sourceDir)} → ${formatPath(destPath)}...`);
  ensureDirExists(centralRoot);
  copyDirectory(sourceDir, destPath);
  display.success(`Copy complete: ${formatPath(destPath)}`);

  // Determine runtimes
  const runtimes = getRuntimeConfigs();
  let targetRuntimes: typeof runtimes;

  if (targetRuntime) {
    const rt = runtimes.find((r) => r.name === targetRuntime);
    if (!rt) {
      display.error(`Unknown runtime: "${targetRuntime}". Configured: ${runtimes.map((r) => r.name).join(', ')}`);
      try { fs.rmSync(destPath, { recursive: true, force: true }); } catch { /* cleanup */ }
      display.info(`Cleaned up: ${formatPath(destPath)}. Installation cancelled.`);
      return null;
    }
    targetRuntimes = [rt];
  } else {
    targetRuntimes = runtimes;
  }

  // Symlink
  const linkedRuntimes: string[] = [];
  for (const rt of targetRuntimes) {
    const runtimeSkillsDir = resolveHomePath(rt.path);
    const linkPath = path.join(runtimeSkillsDir, skillName);
    ensureDirExists(runtimeSkillsDir);

    try {
      safeCreateSymlink(destPath, linkPath, centralRoot);
      registerSkillRuntime(skillName, rt.name);
      linkedRuntimes.push(rt.name);
      display.success(`Linked to ${display.bold(rt.name)}: ${formatPath(linkPath)}`);
    } catch (err: any) {
      display.warn(`Link to ${rt.name} failed: ${err.message}`);
    }
  }

  if (linkedRuntimes.length > 0) {
    display.success(`Installed ${display.bold(skillName)} → linked to [${linkedRuntimes.join(', ')}]`);
  }
  return skillName;
}

/**
 * Runs the sk install command (single skill).
 */
export async function runInstall(sourcePath: string, options: InstallOptions): Promise<void> {
  display.header(`SkillFS Install 📦${options.dryRun ? ' (DRY RUN)' : ''}`);

  const resolvedSource = resolveHomePath(sourcePath);

  if (!fs.existsSync(resolvedSource)) {
    display.error(`Path does not exist: ${formatPath(resolvedSource)}`);
    return;
  }

  if (!fs.lstatSync(resolvedSource).isDirectory()) {
    display.error(`Path is not a directory: ${formatPath(resolvedSource)}. Please provide a directory containing SKILL.md.`);
    return;
  }

  const skillMdPath = path.join(resolvedSource, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    display.error(`No SKILL.md found in ${formatPath(resolvedSource)}.`);
    display.info('Make sure the directory contains a valid SKILL.md file and the path is correct.');
    return;
  }

  const skillName = path.basename(resolvedSource);
  const destPath = path.join(getCentralSkillsPath(), skillName);

  // Check overwrite
  if (fs.existsSync(destPath) && !options.dryRun) {
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Skill "${skillName}" already exists at ${formatPath(destPath)}. Overwrite?`,
        default: false,
      },
    ]);

    if (!answers.overwrite) {
      display.warn(`Skipped install of "${skillName}".`);
      return;
    }
  }

  await installOneSkill(resolvedSource, skillName, options.runtime, options.dryRun ?? false);
  console.log('');
}

/**
 * Batch-install all unique (non-symlink, not-yet-centralized) skills
 * from a runtime's skills directory.
 */
export async function runInstallAllFromRuntime(
  sourceRuntime: string,
  options: InstallOptions
): Promise<void> {
  display.header(`SkillFS Install (批量) 📦${options.dryRun ? ' (DRY RUN)' : ''}`);

  const runtimes = getRuntimeConfigs();
  const rt = runtimes.find((r) => r.name === sourceRuntime);
  if (!rt) {
    display.error(`Unknown runtime: "${sourceRuntime}". Configured: ${runtimes.map((r) => r.name).join(', ')}`);
    return;
  }

  const runtimeSkillsDir = resolveHomePath(rt.path);
  if (!fs.existsSync(runtimeSkillsDir)) {
    display.error(`Runtime directory does not exist: ${formatPath(runtimeSkillsDir)}`);
    return;
  }

  // Gather candidate skills
  const centralSkills = new Set(
    fs.existsSync(getCentralSkillsPath())
      ? fs.readdirSync(getCentralSkillsPath()).filter((i) => !i.startsWith('.'))
      : []
  );

  const newSkills: { name: string; dir: string }[] = [];
  const relinkSkills: string[] = []; // physical dirs that already exist in ~/.skills/
  try {
    const items = fs.readdirSync(runtimeSkillsDir);
    for (const item of items) {
      if (item.startsWith('.')) continue;
      const fullPath = path.join(runtimeSkillsDir, item);
      try {
        if (fs.lstatSync(fullPath).isSymbolicLink()) continue;
        if (!fs.lstatSync(fullPath).isDirectory()) continue;
      } catch { continue; }

      const skillMd = path.join(fullPath, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;

      if (centralSkills.has(item)) {
        relinkSkills.push(item);
      } else {
        newSkills.push({ name: item, dir: fullPath });
      }
    }
  } catch (err: any) {
    display.error(`Scan of ${formatPath(runtimeSkillsDir)} failed: ${err.message}`);
    return;
  }

  const total = newSkills.length + relinkSkills.length;
  if (total === 0) {
    display.success(`${formatPath(runtimeSkillsDir)} has no skills to process (all are already symlinks).`);
    return;
  }

  display.info(`Found ${total} skill(s) to process (${formatPath(runtimeSkillsDir)})${options.dryRun ? ' [DRY RUN]' : ''}`);
  if (newSkills.length > 0) display.info(`  ${newSkills.length} new install(s) (not in ~/.skills/)`);
  if (relinkSkills.length > 0) display.info(`  ${relinkSkills.length} to replace with symlinks (already in ~/.skills/)`);
  console.log('');

  let installed = 0;
  let linked = 0;
  let skipped = 0;

  // Phase 1: install new skills
  for (const c of newSkills) {
    try {
      const result = await installOneSkill(c.dir, c.name, options.runtime, options.dryRun ?? false);
      if (result) installed++;
      else skipped++;
    } catch (err: any) {
      display.error(`${c.name} install failed: ${err.message}`);
      skipped++;
    }
  }

  // Phase 2: relink skills already in ~/.skills/
  const centralRoot = getCentralSkillsPath();
  for (const name of relinkSkills) {
    const target = path.join(centralRoot, name);
    const linkPath = path.join(runtimeSkillsDir, name);
    if (options.dryRun) {
      display.info(`[DRY RUN] Would replace ${formatPath(linkPath)} → symlink to ${formatPath(target)}`);
      linked++;
      continue;
    }
    try {
      safeCreateSymlink(target, linkPath, centralRoot);
      registerSkillRuntime(name, sourceRuntime);
      display.success(`Linked ${display.bold(name)} → ${formatPath(linkPath)}`);
      linked++;
    } catch (err: any) {
      display.warn(`Link ${name} failed: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n${options.dryRun ? '[DRY RUN] ' : ''}Batch install report:`);
  if (installed > 0) display.success(`New installs: ${installed}`);
  if (linked > 0) display.success(`Relinked: ${linked}`);
  if (skipped > 0) display.warn(`Skipped/failed: ${skipped}`);
  console.log('');
}
