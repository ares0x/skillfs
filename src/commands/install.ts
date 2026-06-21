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
    display.info(`[DRY RUN] 将复制 ${formatPath(sourceDir)} → ${formatPath(destPath)}`);
    return skillName;
  }

  // Copy
  display.info(`正在复制 ${formatPath(sourceDir)} → ${formatPath(destPath)}...`);
  ensureDirExists(centralRoot);
  copyDirectory(sourceDir, destPath);
  display.success(`复制完成: ${formatPath(destPath)}`);

  // Determine runtimes
  const runtimes = getRuntimeConfigs();
  let targetRuntimes: typeof runtimes;

  if (targetRuntime) {
    const rt = runtimes.find((r) => r.name === targetRuntime);
    if (!rt) {
      display.error(`未知的 runtime: "${targetRuntime}"。已配置: ${runtimes.map((r) => r.name).join(', ')}`);
      try { fs.rmSync(destPath, { recursive: true, force: true }); } catch { /* cleanup */ }
      display.info(`已清理: ${formatPath(destPath)}。安装已取消。`);
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
      display.success(`已链接到 ${display.bold(rt.name)}: ${formatPath(linkPath)}`);
    } catch (err: any) {
      display.warn(`链接到 ${rt.name} 失败: ${err.message}`);
    }
  }

  if (linkedRuntimes.length > 0) {
    display.success(`已安装 ${display.bold(skillName)} → 已链接到 [${linkedRuntimes.join(', ')}]`);
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
    display.error(`路径不存在: ${formatPath(resolvedSource)}`);
    return;
  }

  if (!fs.lstatSync(resolvedSource).isDirectory()) {
    display.error(`路径不是一个目录: ${formatPath(resolvedSource)}。请提供包含 SKILL.md 的目录路径。`);
    return;
  }

  const skillMdPath = path.join(resolvedSource, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    display.error(`目录 ${formatPath(resolvedSource)} 中未找到 SKILL.md 文件。`);
    display.info('请确认目标目录包含有效的 SKILL.md 文件，或者路径是否正确。');
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
        message: `Skill "${skillName}" 已存在于 ${formatPath(destPath)}。是否覆盖？`,
        default: false,
      },
    ]);

    if (!answers.overwrite) {
      display.warn(`已跳过安装 "${skillName}"。`);
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
    display.error(`未知的 runtime: "${sourceRuntime}"。已配置: ${runtimes.map((r) => r.name).join(', ')}`);
    return;
  }

  const runtimeSkillsDir = resolveHomePath(rt.path);
  if (!fs.existsSync(runtimeSkillsDir)) {
    display.error(`runtime 目录不存在: ${formatPath(runtimeSkillsDir)}`);
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
    display.error(`扫描 ${formatPath(runtimeSkillsDir)} 失败: ${err.message}`);
    return;
  }

  const total = newSkills.length + relinkSkills.length;
  if (total === 0) {
    display.success(`${formatPath(runtimeSkillsDir)} 中没有需要处理的 skill（全部已是软链接）。`);
    return;
  }

  display.info(`发现 ${total} 个 skill 需要处理（${formatPath(runtimeSkillsDir)}）${options.dryRun ? ' [DRY RUN]' : ''}`);
  if (newSkills.length > 0) display.info(`  ${newSkills.length} 个新安装（不在 ~/.skills/ 中）`);
  if (relinkSkills.length > 0) display.info(`  ${relinkSkills.length} 个需要替换为软链接（已在 ~/.skills/ 中）`);
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
      display.error(`${c.name} 安装失败: ${err.message}`);
      skipped++;
    }
  }

  // Phase 2: relink skills already in ~/.skills/
  const centralRoot = getCentralSkillsPath();
  for (const name of relinkSkills) {
    const target = path.join(centralRoot, name);
    const linkPath = path.join(runtimeSkillsDir, name);
    if (options.dryRun) {
      display.info(`[DRY RUN] 将替换 ${formatPath(linkPath)} → 软链接到 ${formatPath(target)}`);
      linked++;
      continue;
    }
    try {
      safeCreateSymlink(target, linkPath, centralRoot);
      registerSkillRuntime(name, sourceRuntime);
      display.success(`已链接 ${display.bold(name)} → ${formatPath(linkPath)}`);
      linked++;
    } catch (err: any) {
      display.warn(`链接 ${name} 失败: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n${options.dryRun ? '[DRY RUN] ' : ''}批量安装报告：`);
  if (installed > 0) display.success(`新安装: ${installed} 个`);
  if (linked > 0) display.success(`替换为软链接: ${linked} 个`);
  if (skipped > 0) display.warn(`跳过/失败: ${skipped} 个`);
  console.log('');
}
