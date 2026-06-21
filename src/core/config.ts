import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveHomePath, resolveHomePathSafe } from '../utils/fs.js';

export interface RuntimeConfig {
  name: string;
  path: string;
}

/**
 * Well-known agent runtime directories. These serve as a safety net —
 * auto-discovery (see discoverRuntimes()) picks up any additional agents
 * that follow the ~/.{name}/skills/SKILL.md convention.
 *
 * Paths that don't exist are simply flagged as inactive by `sk doctor` —
 * no error, no side effects.
 */
export const DEFAULT_RUNTIMES: RuntimeConfig[] = [
  { name: 'claude',    path: '~/.claude/skills' },
  { name: 'agents',    path: '~/.agents/skills' },       // VS Code / GitHub Copilot
  { name: 'clawdbot',  path: '~/.clawdbot/skills' },
  { name: 'cursor',    path: '~/.cursor/skills' },
  { name: 'codex',     path: '~/.codex/skills' },        // OpenAI Codex
  { name: 'gemini',    path: '~/.gemini/skills' },       // Google Gemini CLI
  { name: 'windsurf',  path: '~/.windsurf/skills' },
  { name: 'cline',     path: '~/.cline/skills' },
  { name: 'continue',  path: '~/.continue/skills' },
  { name: 'aider',     path: '~/.aider/skills' },
  { name: 'augment',   path: '~/.augment/skills' },      // Augment Code
  { name: 'roo',       path: '~/.roo/skills' },          // Roo Code
  { name: 'opencode',  path: '~/.opencode/skills' },
  { name: 'trae',      path: '~/.trae/skills' },         // TRAE IDE
];

export const CENTRAL_SKILLS_DIR = '~/.skills';

/**
 * Returns the home directory scope for path validation.
 */
function getHomeScope(): string {
  return process.env.SKILLFS_HOME_OVERRIDE || os.homedir();
}

/**
 * Auto-discovers AI agent skill directories by scanning ~/ for hidden
 * directories that contain a skills/ subdirectory with valid SKILL.md files.
 *
 * This eliminates the need to manually maintain a list of every agent —
 * any agent that follows the ~/.{name}/skills/SKILL.md convention is
 * automatically picked up.
 *
 * Excludes ~/.skills/ itself (the central SkillFS repo) and any directory
 * whose skills/ subdirectory contains zero valid SKILL.md files.
 */
function discoverRuntimes(): RuntimeConfig[] {
  const homeScope = getHomeScope();
  const centralPath = resolveHomePath(CENTRAL_SKILLS_DIR);
  const discovered: RuntimeConfig[] = [];

  try {
    const entries = fs.readdirSync(homeScope);
    for (const entry of entries) {
      if (!entry.startsWith('.')) continue;
      if (entry === '.') continue;

      const skillsDir = path.join(homeScope, entry, 'skills');
      if (skillsDir === centralPath) continue; // skip central repo

      let skillsStat: fs.Stats;
      try {
        skillsStat = fs.lstatSync(skillsDir);
      } catch {
        continue;
      }
      if (!skillsStat.isDirectory()) continue;

      // Validate: at least one subdirectory with SKILL.md
      let valid = false;
      try {
        const items = fs.readdirSync(skillsDir);
        for (const item of items) {
          if (item.startsWith('.')) continue;
          const itemPath = path.join(skillsDir, item);
          try {
            if (!fs.lstatSync(itemPath).isDirectory()) continue;
          } catch { continue; }
          if (fs.existsSync(path.join(itemPath, 'SKILL.md'))) {
            valid = true;
            break;
          }
        }
      } catch { continue; }

      if (valid) {
        const name = entry.slice(1); // strip leading dot
        discovered.push({ name, path: `~/${entry}/skills` });
      }
    }
  } catch {
    // Home directory unreadable — return empty
  }

  return discovered;
}

/**
 * Loads configuration, including custom runtime directories from ~/.skills/config.json.
 * Validates user-provided paths against path traversal to prevent escaping
 * the home directory scope.
 *
 * Merges three sources:
 * 1. DEFAULT_RUNTIMES — well-known agents as a safety net
 * 2. ~/.skills/config.json — user-defined custom runtimes
 * 3. Auto-discovery — any ~/.{name}/skills/ with valid SKILL.md files
 */
export function getRuntimeConfigs(): RuntimeConfig[] {
  const configs: RuntimeConfig[] = [];
  const seenPaths = new Set<string>();
  const seenNames = new Set<string>();

  const add = (rt: RuntimeConfig) => {
    const resolved = resolveHomePath(rt.path);
    if (seenPaths.has(resolved) || seenNames.has(rt.name)) return;
    seenPaths.add(resolved);
    seenNames.add(rt.name);
    configs.push(rt);
  };

  // 1. Defaults — well-known agents
  for (const rt of DEFAULT_RUNTIMES) add(rt);

  // 2. Load config.json early to get the exclude list
  const configPath = resolveHomePath(path.join(CENTRAL_SKILLS_DIR, 'config.json'));
  const homeScope = getHomeScope();
  const excludeNames = new Set<string>();

  let userConfig: { runtimes?: RuntimeConfig[]; exclude?: string[] } | null = null;
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      userConfig = JSON.parse(content);
    }
  } catch {
    // Corrupted config — ignore
  }

  // Build exclude set
  if (userConfig && Array.isArray(userConfig.exclude)) {
    for (const name of userConfig.exclude) {
      if (typeof name === 'string') excludeNames.add(name);
    }
  }

  // 3. Auto-discovery — picks up any agent following the convention
  for (const rt of discoverRuntimes()) {
    if (excludeNames.has(rt.name)) continue;
    add(rt);
  }

  // 4. User config — explicit overrides and custom paths
  if (userConfig && Array.isArray(userConfig.runtimes)) {
    for (const item of userConfig.runtimes) {
      if (item && typeof item.name === 'string' && typeof item.path === 'string') {
        try {
          resolveHomePathSafe(item.path, homeScope);
        } catch (pathErr: unknown) {
          console.warn(
            `⚠ Skipping runtime "${item.name}": ` +
            (pathErr instanceof Error ? pathErr.message : 'path traversal detected')
          );
          continue;
        }

        // User config overrides — remove existing with same name/path
        const resolvedCustom = resolveHomePath(item.path);
        const nameIdx = configs.findIndex(r => r.name === item.name);
        const pathIdx = configs.findIndex(r => resolveHomePath(r.path) === resolvedCustom);

        if (nameIdx !== -1) configs.splice(nameIdx, 1);
        if (pathIdx !== -1 && pathIdx !== nameIdx) configs.splice(pathIdx > nameIdx ? pathIdx - 1 : pathIdx, 1);

        seenNames.delete(item.name);
        seenPaths.delete(resolvedCustom);
        add(item);
      }
    }
  }

  return configs;
}

/**
 * Returns the absolute path of the central skills repository.
 */
export function getCentralSkillsPath(): string {
  return resolveHomePath(CENTRAL_SKILLS_DIR);
}
