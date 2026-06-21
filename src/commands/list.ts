import * as fs from 'fs';
import * as path from 'path';
import { scanAll } from '../core/scanner.js';
import { getRuntimeConfigs, getCentralSkillsPath } from '../core/config.js';
import { isSymlink, getSymlinkTarget, resolveHomePath } from '../utils/fs.js';
import { display, formatPath } from '../utils/display.js';

/**
 * Checks the symlink connection status of a skill in a specific runtime.
 * Returns:
 * - '✓' if it is a correct symlink to the central skill directory.
 * - '⚠' if it is a broken symlink or points elsewhere.
 * - '-' if it does not exist or is not a symlink.
 */
function getLinkStatus(skillName: string, runtimePath: string, expectedTarget: string): '✓' | '⚠' | '-' {
  const targetPathInRuntime = path.join(resolveHomePath(runtimePath), skillName);
  
  if (!fs.existsSync(targetPathInRuntime) && !isSymlink(targetPathInRuntime)) {
    return '-';
  }

  if (isSymlink(targetPathInRuntime)) {
    const linkTarget = getSymlinkTarget(targetPathInRuntime);
    if (linkTarget) {
      const resolvedLinkTarget = resolveHomePath(linkTarget);
      const resolvedExpectedTarget = resolveHomePath(expectedTarget);
      
      if (resolvedLinkTarget === resolvedExpectedTarget) {
        // Double check if target exists
        if (fs.existsSync(resolvedLinkTarget)) {
          return '✓';
        } else {
          return '⚠'; // points to central but central folder is deleted
        }
      }
    }
    return '⚠'; // broken or pointing somewhere else
  }

  return '-'; // exists but is a physical folder (not linked)
}

/**
 * Runs the sk list command.
 */
export function runList(): void {
  display.header('SkillFS List 📋');

  const scanResult = scanAll();
  const runtimes = getRuntimeConfigs();
  const centralPath = getCentralSkillsPath();

  // 1. Display Central Skills (Source of Truth)
  console.log(`${formatPath(centralPath)} (Source of Truth)`);
  
  const centralSkills = scanResult.central.skills;
  if (centralSkills.length === 0) {
    console.log('  (无 Skill)\n');
  } else {
    for (let index = 0; index < centralSkills.length; index++) {
      const skill = centralSkills[index];
      const prefix = index === centralSkills.length - 1 ? '└──' : '├──';
      const expectedCentralPath = path.join(centralPath, skill.name);
      
      // Get statuses in all runtimes
      const statusLabels = runtimes.map(rt => {
        const stat = getLinkStatus(skill.name, rt.path, expectedCentralPath);
        let coloredStat: string = stat;
        if (stat === '✓') coloredStat = display.green(stat);
        else if (stat === '⚠') coloredStat = display.red(stat);
        else coloredStat = display.gray(stat);
        
        return `[${rt.name} ${coloredStat}]`;
      });

      console.log(`  ${prefix} ${display.bold(skill.name.padEnd(16))}    ${statusLabels.join(' ')}`);
    }
    console.log('');
  }

  // 2. Display Un-migrated Skills in Individual Runtimes
  let hasUnmigrated = false;

  for (const rt of scanResult.runtimes) {
    // Skills that are physical directories, not symlinks, and not already in central repo under the same name
    const unmigrated = rt.skills.filter(s => !s.isSymlink);

    if (unmigrated.length > 0) {
      hasUnmigrated = true;
      console.log(`${formatPath(rt.path)} (额外，未迁移)`);
      for (let index = 0; index < unmigrated.length; index++) {
        const skill = unmigrated[index];
        const prefix = index === unmigrated.length - 1 ? '└──' : '├──';
        console.log(`  ${prefix} ${display.yellow(skill.name.padEnd(16))} (未在 ~/.skills 中)`);
      }
      console.log('');
    }
  }

  if (!hasUnmigrated) {
    display.success('所有运行时的 Skill 均已同步，无额外未迁移的 Skill。\n');
  } else {
    console.log(`提示: 对已在 ~/.skills/ 中的 skill，使用 ${display.bold('sk link <name> --runtime <name>')} 将其链接到指定 agent。\n`);
    console.log(`      对未在 ~/.skills/ 中的独立 skill，使用 ${display.bold('sk install --all-from claude')} 批量安装。\n`);
  }

  // 3. Legend
  console.log('图例: ' + display.green('✓') + ' 已链接  ' + display.gray('-') + ' 未链接  ' + display.red('⚠') + ' 链接断裂\n');
}
