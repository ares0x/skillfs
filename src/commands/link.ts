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
    display.error(`Cannot link: Skill "${skillName}" does not exist in central repository. Path: ${formatPath(sourcePath)}`);
    return false;
  }

  display.info(`Creating symlink: ${formatPath(targetPath)} -> ${formatPath(sourcePath)}`);
  
  try {
    safeCreateSymlink(sourcePath, targetPath, centralRoot);
    display.success(`Linked ${display.bold(skillName)} to ${display.bold(runtimeName)}`);
    return true;
  } catch (err: any) {
    display.error(`Link ${skillName} to ${runtimeName} failed: ${err.message}`);
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
    display.error(`Central repository does not exist. Run ${display.bold('sk dedupe')} first to initialize.`);
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
      display.warn('No skills in central repository, nothing to link.');
      return;
    }

    display.info(`Linking all skills (${skills.length}) to all runtimes...`);

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
    display.error('Please provide a skill name or use --all. Run sk link --help for usage.');
    return;
  }

  // Verify the skill exists in central repo
  const sourcePath = path.join(centralRoot, skillName);
  if (!fs.existsSync(sourcePath)) {
    display.error(`Skill "${skillName}" does not exist in the central repository.`);
    return;
  }

  // Case 2: link <name> --all (Link specific skill to all runtimes)
  if (options.all) {
    display.info(`Linking ${skillName} to all runtimes...`);
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
      display.error(`Unknown runtime: "${options.runtime}". Configured: ${runtimes.map(r => r.name).join(', ')}`);
      return;
    }
    const ok = linkSkillToRuntime(skillName, rt.name, rt.path);
    if (ok) {
      batchRegisterSkillRuntimes([{ name: skillName, runtime: rt.name }]);
    }
    console.log('');
    return;
  }

  display.error('Please specify --runtime <runtime> or --all to indicate the link target.');
}
