import * as fs from 'fs';
import * as path from 'path';
import { getRuntimeConfigs } from '../core/config.js';
import { resolveHomePath } from '../utils/fs.js';
import { display, formatPath } from '../utils/display.js';

export interface WatchOptions {
  runtime?: string;
}

/**
 * Watches agent runtime skills directories for newly created skills.
 * Uses polling (fs.readdirSync comparison every 2 seconds) for reliability
 * across all platforms, including macOS where fs.watch can be unreliable.
 */
export function runWatch(options: WatchOptions = {}): Promise<never> {
  return new Promise((_resolve, _reject) => {
    const runtimes = getRuntimeConfigs();
    let targets: Array<{ name: string; dirPath: string }>;

    if (options.runtime) {
      const rt = runtimes.find(r => r.name === options.runtime);
      if (!rt) {
        display.error(`未知的 runtime: "${options.runtime}"。已配置的 runtime: ${runtimes.map(r => r.name).join(', ')}`);
        process.exit(1);
      }
      targets = [{ name: rt.name, dirPath: resolveHomePath(rt.path) }];
    } else {
      targets = runtimes.map(r => ({ name: r.name, dirPath: resolveHomePath(r.path) }));
    }

    display.header('SkillFS Watch 👀');
    console.log('正在监听以下目录的新 skill：');
    for (const t of targets) {
      display.info(`${t.name.padEnd(12)} ${formatPath(t.dirPath)}`);
    }
    console.log('\n按 Ctrl+C 退出。\n');

    // Track known skill names per directory
    const knownSkills = new Map<string, Set<string>>();

    // Initial scan: discover existing skills
    for (const t of targets) {
      const existing = getSkillDirs(t.dirPath);
      knownSkills.set(t.dirPath, new Set(existing));
    }

    const interval = setInterval(() => {
      for (const t of targets) {
        const current = getSkillDirs(t.dirPath);
        const known = knownSkills.get(t.dirPath)!;

        // Look for new skills that weren't there before
        for (const skillName of current) {
          if (!known.has(skillName)) {
            known.add(skillName);
            const skillPath = path.join(t.dirPath, skillName);
            console.log(
              `✨ 发现新 skill: ${display.bold(skillName)} — ` +
              `使用 sk install ${formatPath(skillPath)} 安装`
            );
          }
        }
      }
    }, 2000);

    // Graceful shutdown on SIGINT
    const cleanup = () => {
      clearInterval(interval);
      console.log('\n👋 已停止监听。');
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });
}

/**
 * Returns the set of subdirectory names in the given directory
 * that contain a SKILL.md file (i.e., valid skill directories).
 * Returns empty set if directory doesn't exist.
 */
function getSkillDirs(dirPath: string): string[] {
  try {
    if (!fs.existsSync(dirPath)) return [];
    const items = fs.readdirSync(dirPath);
    return items
      .filter(item => !item.startsWith('.'))
      .filter(item => {
        const fullPath = path.join(dirPath, item);
        try {
          const stat = fs.lstatSync(fullPath);
          if (!stat.isDirectory()) return false;
          return fs.existsSync(path.join(fullPath, 'SKILL.md'));
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}
