import * as fs from 'fs';
import * as path from 'path';
import { getCentralSkillsPath } from './config.js';
import { ensureDirExists, resolveHomePath } from '../utils/fs.js';
import { acquireLock } from '../utils/lock.js';
import { hashFile } from './skill.js';

export interface RegistrySkillEntry {
  installedAt: string;
  source: string;
  runtimes: string[];
  /** MD5 hash of SKILL.md at registration time. Used for drift detection. */
  contentHash?: string;
}

export interface RegistrySchema {
  version: string;
  skills: {
    [skillName: string]: RegistrySkillEntry;
  };
}

/**
 * Returns the resolved path of the registry file ~/.skills/registry.json.
 */
export function getRegistryPath(): string {
  return path.join(getCentralSkillsPath(), 'registry.json');
}

/**
 * Returns the path of the registry lock file.
 */
export function getRegistryLockPath(): string {
  return path.join(getCentralSkillsPath(), '.registry.lock');
}

/**
 * Acquires the registry lock. Returns a release function.
 * Throws if another process holds the lock.
 */
export function lockRegistry(): () => void {
  const lockPath = getRegistryLockPath();
  ensureDirExists(path.dirname(lockPath));
  return acquireLock(lockPath);
}

/**
 * Loads the registry file. Returns a default schema if the file doesn't exist or is invalid.
 * Read-only operation — does not acquire a lock.
 */
export function loadRegistry(): RegistrySchema {
  const registryPath = getRegistryPath();
  const defaultRegistry: RegistrySchema = {
    version: '1',
    skills: {}
  };

  try {
    if (fs.existsSync(registryPath)) {
      const content = fs.readFileSync(registryPath, 'utf8');
      const data = JSON.parse(content);
      if (data && typeof data === 'object' && data.version === '1') {
        return {
          version: '1',
          skills: data.skills || {}
        };
      }
    }
  } catch (err) {
    // Return default on any errors
  }

  return defaultRegistry;
}

/**
 * Saves the registry schema to ~/.skills/registry.json.
 * Caller must hold the registry lock before calling this.
 */
export function saveRegistry(registry: RegistrySchema): void {
  const registryPath = getRegistryPath();
  
  // Ensure the directory (~/.skills) exists
  ensureDirExists(path.dirname(registryPath));
  
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
}

/**
 * Registers a skill runtime mapping in the registry.
 * Acquires and releases the lock internally.
 */
export function registerSkillRuntime(name: string, runtime: string): void {
  const release = lockRegistry();
  try {
    const registry = loadRegistry();

    if (!registry.skills[name]) {
      // Compute the content hash of the central SKILL.md
      const skillMdPath = path.join(getCentralSkillsPath(), name, 'SKILL.md');
      const hash = hashFile(skillMdPath);

      registry.skills[name] = {
        installedAt: new Date().toISOString(),
        source: 'local',
        runtimes: [],
        contentHash: hash || undefined
      };
    } else {
      // Refresh contentHash for existing entries when SKILL.md is available
      const skillMdPath = path.join(getCentralSkillsPath(), name, 'SKILL.md');
      const hash = hashFile(skillMdPath);
      if (hash) {
        registry.skills[name].contentHash = hash;
      }
    }

    const entry = registry.skills[name];
    if (!entry.runtimes.includes(runtime)) {
      entry.runtimes.push(runtime);
    }

    saveRegistry(registry);
  } finally {
    release();
  }
}

/**
 * Deregisters a skill runtime mapping from the registry.
 * Acquires and releases the lock internally.
 */
export function deregisterSkillRuntime(name: string, runtime: string): void {
  const release = lockRegistry();
  try {
    const registry = loadRegistry();
    
    const entry = registry.skills[name];
    if (entry) {
      entry.runtimes = entry.runtimes.filter(r => r !== runtime);
      if (entry.runtimes.length === 0) {
        delete registry.skills[name];
      }
      saveRegistry(registry);
    }
  } finally {
    release();
  }
}

/**
 * Synchronizes the registry runtimes list for a skill to match the given list.
 * Acquires and releases the lock internally.
 */
export function syncSkillRuntimes(name: string, runtimes: string[]): void {
  const release = lockRegistry();
  try {
    const registry = loadRegistry();

    if (!registry.skills[name]) {
      // Compute the content hash of the central SKILL.md
      const skillMdPath = path.join(getCentralSkillsPath(), name, 'SKILL.md');
      const hash = hashFile(skillMdPath);

      registry.skills[name] = {
        installedAt: new Date().toISOString(),
        source: 'local',
        runtimes: [],
        contentHash: hash || undefined
      };
    } else {
      // Refresh contentHash for existing entries when SKILL.md is available
      const skillMdPath = path.join(getCentralSkillsPath(), name, 'SKILL.md');
      const hash = hashFile(skillMdPath);
      if (hash) {
        registry.skills[name].contentHash = hash;
      }
    }

    registry.skills[name].runtimes = [...new Set(runtimes)];
    saveRegistry(registry);
  } finally {
    release();
  }
}

/**
 * Registers multiple skill-runtime mappings in a single batch operation.
 * Acquires the lock once, loads registry once, applies all changes, saves once.
 * This is significantly more efficient than calling registerSkillRuntime() in a loop.
 */
export function batchRegisterSkillRuntimes(entries: Array<{name: string, runtime: string}>): void {
  const release = lockRegistry();
  try {
    const registry = loadRegistry();
    const centralPath = getCentralSkillsPath();

    for (const {name, runtime} of entries) {
      if (!registry.skills[name]) {
        // Compute the content hash of the central SKILL.md
        const skillMdPath = path.join(centralPath, name, 'SKILL.md');
        const hash = hashFile(skillMdPath);

        registry.skills[name] = {
          installedAt: new Date().toISOString(),
          source: 'local',
          runtimes: [],
          contentHash: hash || undefined
        };
      } else {
        // Refresh contentHash for existing entries when SKILL.md is available
        const skillMdPath = path.join(centralPath, name, 'SKILL.md');
        const hash = hashFile(skillMdPath);
        if (hash) {
          registry.skills[name].contentHash = hash;
        }
      }

      const entry = registry.skills[name];
      if (!entry.runtimes.includes(runtime)) {
        entry.runtimes.push(runtime);
      }
    }

    saveRegistry(registry);
  } finally {
    release();
  }
}
