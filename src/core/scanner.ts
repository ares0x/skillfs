import * as fs from 'fs';
import * as path from 'path';
import { getRuntimeConfigs, getCentralSkillsPath } from './config.js';
import { parseSkill, Skill } from './skill.js';
import { resolveHomePath } from '../utils/fs.js';

export interface RuntimeScanStatus {
  name: string;
  path: string;
  exists: boolean;
  skills: Skill[];
  /** If scanning failed, this contains the error message. */
  error?: string;
}

export interface ScanResult {
  runtimes: RuntimeScanStatus[];
  central: RuntimeScanStatus;
  allSkills: Skill[];
}

/**
 * Scans a specific directory for skills.
 */
function scanDirectory(dirPath: string, runtimeName: string): RuntimeScanStatus {
  const resolvedPath = resolveHomePath(dirPath);
  const status: RuntimeScanStatus = {
    name: runtimeName,
    path: resolvedPath,
    exists: false,
    skills: []
  };

  try {
    if (fs.existsSync(resolvedPath)) {
      const stats = fs.lstatSync(resolvedPath);
      if (stats.isDirectory()) {
        status.exists = true;
        const items = fs.readdirSync(resolvedPath);
        for (const item of items) {
          if (item.startsWith('.')) continue; // skip hidden files/folders
          
          const fullPath = path.join(resolvedPath, item);
          const skill = parseSkill(fullPath, runtimeName);
          if (skill) {
            status.skills.push(skill);
          }
        }
      }
    }
  } catch (err: unknown) {
    status.exists = false;
    status.error = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: Failed to scan ${resolvedPath}: ${status.error}`);
  }

  return status;
}

/**
 * Scans all configured runtimes and the central skills directory.
 */
export function scanAll(): ScanResult {
  const runtimesConfig = getRuntimeConfigs();
  const centralPath = getCentralSkillsPath();

  const runtimes: RuntimeScanStatus[] = runtimesConfig.map(r => 
    scanDirectory(r.path, r.name)
  );

  const central = scanDirectory(centralPath, 'skills');

  const allSkills: Skill[] = [];
  for (const r of runtimes) {
    allSkills.push(...r.skills);
  }
  allSkills.push(...central.skills);

  return {
    runtimes,
    central,
    allSkills
  };
}
