import * as fs from 'fs';
import * as path from 'path';
import { getCentralSkillsPath, getRuntimeConfigs } from '../core/config.js';
import { loadRegistry, deregisterSkillRuntime, lockRegistry, saveRegistry } from '../core/registry.js';
import { resolveHomePath, removeDirectory, isSymlink, getSymlinkTarget } from '../utils/fs.js';
import { display, formatPath } from '../utils/display.js';

export interface UninstallOptions {
  runtime?: string;
}

/**
 * Runs the sk uninstall command.
 */
export async function runUninstall(skillName: string, options: UninstallOptions): Promise<void> {
  display.header('SkillFS Uninstall 🗑');

  const centralRoot = getCentralSkillsPath();
  const skillPath = path.join(centralRoot, skillName);
  const registry = loadRegistry();
  const entry = registry.skills[skillName];

  // 1. Validate that the skill exists
  const skillExistsInCentral = fs.existsSync(skillPath);
  const skillInRegistry = entry !== undefined;

  if (!skillExistsInCentral && !skillInRegistry) {
    display.error(`Skill "${skillName}" not found.`);
    display.info(`Check the skill name. Use sk list to see installed skills.`);
    return;
  }

  if (options.runtime) {
    // Case 1: Remove from one runtime only
    const runtimeName = options.runtime;
    const symlinkPath = path.join(resolveHomePath(`~/.${runtimeName}/skills`), skillName);

    // Verify it's a symlink pointing to ~/.skills/<name>
    if (!isSymlink(symlinkPath)) {
      display.error(`No symlink found at ${formatPath(symlinkPath)} pointing to ${formatPath(skillPath)}.`);
      return;
    }

    const linkTarget = getSymlinkTarget(symlinkPath);
    if (!linkTarget || resolveHomePath(linkTarget) !== skillPath) {
      display.error(`Symlink at ${formatPath(symlinkPath)} does not point to ${formatPath(skillPath)}, skipping.`);
      return;
    }

    // Remove the symlink
    try {
      removeDirectory(symlinkPath);
      display.success(`Removed symlink: ${formatPath(symlinkPath)}`);
    } catch (err: any) {
      display.error(`Failed to remove symlink: ${err.message}`);
      return;
    }

    // Deregister from registry for this runtime
    deregisterSkillRuntime(skillName, runtimeName);
    display.success(`Deregistered "${skillName}" from runtime ${display.bold(runtimeName)}.`);

  } else {
    // Case 2: Remove from ALL runtimes and ~/.skills/
    const removedRuntimes: string[] = [];

    // Remove symlinks for each runtime in registry
    if (entry) {
      for (const runtimeName of entry.runtimes) {
        const symlinkPath = path.join(resolveHomePath(`~/.${runtimeName}/skills`), skillName);

        if (isSymlink(symlinkPath)) {
          const linkTarget = getSymlinkTarget(symlinkPath);
          if (linkTarget && resolveHomePath(linkTarget) === skillPath) {
            try {
              removeDirectory(symlinkPath);
              removedRuntimes.push(runtimeName);
            } catch (err: any) {
              display.warn(`Failed to remove symlink ${formatPath(symlinkPath)}: ${err.message}`);
            }
          }
        }
      }
    }

    // Also check all configured runtimes (even if not in registry)
    // This handles the case where the skill was installed but registry was corrupted
    const runtimes = getRuntimeConfigs();
    for (const rt of runtimes) {
      if (!removedRuntimes.includes(rt.name)) {
        const symlinkPath = path.join(resolveHomePath(rt.path), skillName);
        if (isSymlink(symlinkPath)) {
          const linkTarget = getSymlinkTarget(symlinkPath);
          if (linkTarget && resolveHomePath(linkTarget) === skillPath) {
            try {
              removeDirectory(symlinkPath);
              removedRuntimes.push(rt.name);
            } catch (err: any) {
              display.warn(`Failed to remove symlink ${formatPath(symlinkPath)}: ${err.message}`);
            }
          }
        }
      }
    }

    // Remove ~/.skills/<name> directory
    if (skillExistsInCentral) {
      try {
        removeDirectory(skillPath);
        display.success(`Removed directory: ${formatPath(skillPath)}`);
      } catch (err: any) {
        display.error(`Failed to remove directory ${formatPath(skillPath)}: ${err.message}`);
      }
    }

    // Remove from registry entirely
    if (skillInRegistry) {
      const release = lockRegistry();
      try {
        const reg = loadRegistry();
        delete reg.skills[skillName];
        saveRegistry(reg);
      } finally {
        release();
      }
    }

    // Report
    if (removedRuntimes.length > 0) {
      display.success(`Removed symlinks from: [${removedRuntimes.join(', ')}]`);
    }
    display.success(`Uninstalled ${display.bold(skillName)}.`);
  }

  console.log('');
}
