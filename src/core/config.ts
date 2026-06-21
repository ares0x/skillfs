import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveHomePath, resolveHomePathSafe } from '../utils/fs.js';

export interface RuntimeConfig {
  name: string;
  path: string;
}

/**
 * Default runtime directories for AI coding agents that support the Agent Skills
 * standard (SKILL.md). Covers all major agents as of mid-2026.
 *
 * Paths that don't exist are simply flagged as inactive by `sk doctor` —
 * no error, no side effects. Adding an agent here is a safe no-op if the user
 * doesn't have it installed.
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
 * Loads configuration, including custom runtime directories from ~/.skills/config.json.
 * Validates user-provided paths against path traversal to prevent escaping
 * the home directory scope.
 */
export function getRuntimeConfigs(): RuntimeConfig[] {
  const configs = [...DEFAULT_RUNTIMES];
  const configPath = resolveHomePath(path.join(CENTRAL_SKILLS_DIR, 'config.json'));
  const homeScope = getHomeScope();

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const data = JSON.parse(content);
      if (data && Array.isArray(data.runtimes)) {
        for (const item of data.runtimes) {
          if (item && typeof item.name === 'string' && typeof item.path === 'string') {
            // Validate that the path resolves within home scope (blocks path traversal)
            try {
              resolveHomePathSafe(item.path, homeScope);
            } catch (pathErr: unknown) {
              console.warn(
                `⚠ Skipping runtime "${item.name}": ` +
                (pathErr instanceof Error ? pathErr.message : 'path traversal detected')
              );
              continue;
            }

            // Avoid duplicate runtime names or paths, overriding defaults if names match
            const existingIndex = configs.findIndex(r => r.name === item.name);
            if (existingIndex !== -1) {
              configs[existingIndex] = item;
            } else {
              configs.push(item);
            }
          }
        }
      }
    }
  } catch (err) {
    // If the config file is corrupted or unreadable, we ignore it and return defaults
  }

  return configs;
}

/**
 * Returns the absolute path of the central skills repository.
 */
export function getCentralSkillsPath(): string {
  return resolveHomePath(CENTRAL_SKILLS_DIR);
}
