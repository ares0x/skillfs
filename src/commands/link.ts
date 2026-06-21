import * as fs from 'fs';
import * as path from 'path';
import { getCentralSkillsPath, getRuntimeConfigs } from '../core/config.js';
import { batchRegisterSkillRuntimes } from '../core/registry.js';
import { safeCreateSymlink, resolveHomePath } from '../utils/fs.js';
import { display, formatPath } from '../utils/display.js';

interface LinkOptions {
  runtime?: string;
  all?: boolean;
}

/**
 * Links a single centralized skill to a specific runtime directory.
 * Returns whether the link was created successfully.
 */
function linkSkillToRuntime(skillName: string, runtimeName: string, runtimePath: string): boolean {
  const centralRoot = getCentralSkillsPath();
  const sourcePath = path.join(centralRoot, skillName);
  const targetPath = path.join(resolveHomePath(runtimePath), skillName);

  if (!fs.existsSync(sourcePath)) {
    display.error(`无法链接: 中央仓库中不存在 Skill "${skillName}"。路径: ${formatPath(sourcePath)}`);
    return false;
  }

  display.info(`正在创建软链接: ${formatPath(targetPath)} -> ${formatPath(sourcePath)}`);
  
  try {
    safeCreateSymlink(sourcePath, targetPath, centralRoot);
    display.success(`成功链接 ${display.bold(skillName)} 到 ${display.bold(runtimeName)}`);
    return true;
  } catch (err: any) {
    display.error(`链接 ${skillName} 到 ${runtimeName} 失败: ${err.message}`);
    return false;
  }
}

/**
 * Runs the sk link command.
 */
export function runLink(skillName: string | undefined, options: LinkOptions): void {
  display.header('SkillFS Link 🔗');

  const runtimes = getRuntimeConfigs();
  const centralRoot = getCentralSkillsPath();

  if (!fs.existsSync(centralRoot)) {
    display.error(`中央仓库不存在，请先运行 ${display.bold('sk dedupe')} 初始化。`);
    return;
  }

  // Case 1: link --all (Link all skills in ~/.skills to all runtimes)
  if (!skillName && options.all) {
    const items = fs.readdirSync(centralRoot);
    const skills = items.filter(item => {
      if (item.startsWith('.')) return false;
      const fullPath = path.join(centralRoot, item);
      return fs.lstatSync(fullPath).isDirectory();
    });

    if (skills.length === 0) {
      display.warn('中央仓库中没有任何 Skill，无法链接。');
      return;
    }

    display.info(`正在链接所有 Skill (${skills.length} 个) 到所有 runtime...`);

    // Collect successful links for batch registry update
    const batchEntries: Array<{name: string, runtime: string}> = [];
    for (const skill of skills) {
      for (const rt of runtimes) {
        const ok = linkSkillToRuntime(skill, rt.name, rt.path);
        if (ok) {
          batchEntries.push({ name: skill, runtime: rt.name });
        }
      }
    }

    if (batchEntries.length > 0) {
      batchRegisterSkillRuntimes(batchEntries);
    }
    console.log('');
    return;
  }

  // Check if a specific skillName is provided
  if (!skillName) {
    display.error('请提供 Skill 名称或使用 --all 选项。运行 sk link --help 获知用法。');
    return;
  }

  // Verify the skill exists in central repo
  const sourcePath = path.join(centralRoot, skillName);
  if (!fs.existsSync(sourcePath)) {
    display.error(`中央仓库中不存在 Skill "${skillName}"。`);
    return;
  }

  // Case 2: link <name> --all (Link specific skill to all runtimes)
  if (options.all) {
    display.info(`正在链接 ${skillName} 到所有 runtime...`);
    const batchEntries: Array<{name: string, runtime: string}> = [];
    for (const rt of runtimes) {
      const ok = linkSkillToRuntime(skillName, rt.name, rt.path);
      if (ok) {
        batchEntries.push({ name: skillName, runtime: rt.name });
      }
    }
    if (batchEntries.length > 0) {
      batchRegisterSkillRuntimes(batchEntries);
    }
    console.log('');
    return;
  }

  // Case 3: link <name> --runtime <runtime> (Link specific skill to specific runtime)
  if (options.runtime) {
    const rt = runtimes.find(r => r.name === options.runtime);
    if (!rt) {
      display.error(`未知的 runtime: "${options.runtime}"。已配置的 runtime: ${runtimes.map(r => r.name).join(', ')}`);
      return;
    }
    const ok = linkSkillToRuntime(skillName, rt.name, rt.path);
    if (ok) {
      batchRegisterSkillRuntimes([{ name: skillName, runtime: rt.name }]);
    }
    console.log('');
    return;
  }

  display.error('请指定 --runtime <runtime> 或者 --all 选项以指明链接目标。');
}
