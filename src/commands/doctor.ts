import * as fs from 'fs';
import * as path from 'path';
import { scanAll, ScanResult } from '../core/scanner.js';
import { Skill } from '../core/skill.js';
import { display, formatPath } from '../utils/display.js';
import { getIncompleteTransactions } from './dedupe.js';
import { loadRegistry } from '../core/registry.js';

export interface DuplicateGroup {
  name: string;
  identical: boolean;
  skills: Skill[];
}

export interface DriftedSkill {
  name: string;
  registeredHash: string;
  currentHash: string;
}

export interface DoctorAnalysis {
  scanResult: ScanResult;
  duplicates: DuplicateGroup[];
  totalDuplicatesCount: number;
  conflictsCount: number;
  savingsBytes: number;
  /** Skills whose current SKILL.md hash differs from the registry contentHash */
  driftedSkills: DriftedSkill[];
}

/**
 * Gets the modification time of a skill directory (checks SKILL.md first).
 */
export function getSkillMtime(skillPath: string): Date {
  const skillMd = path.join(skillPath, 'SKILL.md');
  try {
    if (fs.existsSync(skillMd)) {
      return fs.statSync(skillMd).mtime;
    }
    return fs.statSync(skillPath).mtime;
  } catch {
    return new Date(0);
  }
}

/**
 * Formats a Date object to YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Recursively calculates the size of a directory.
 */
export function getDirectorySize(dirPath: string): number {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.lstatSync(fullPath);
      if (stat.isFile()) {
        size += stat.size;
      } else if (stat.isDirectory()) {
        size += getDirectorySize(fullPath);
      }
    }
  } catch {
    // Ignore error
  }
  return size;
}

/**
 * Formats bytes to human-readable size.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

/**
 * Analyzes the runtimes to identify identical and conflicting duplicates.
 */
export function analyzeRuntimes(): DoctorAnalysis {
  const scanResult = scanAll();
  
  // Group skills from individual runtimes by name (exclude already centralized 'skills' runtime)
  const runtimeSkills = scanResult.allSkills.filter(s => s.runtime !== 'skills' && !s.isSymlink);
  
  const grouped: { [name: string]: Skill[] } = {};
  for (const skill of runtimeSkills) {
    if (!grouped[skill.name]) {
      grouped[skill.name] = [];
    }
    grouped[skill.name].push(skill);
  }

  const duplicates: DuplicateGroup[] = [];
  let totalDuplicatesCount = 0;
  let conflictsCount = 0;
  let savingsBytes = 0;

  for (const name of Object.keys(grouped)) {
    const groupSkills = grouped[name];
    if (groupSkills.length > 1) {
      // Check if all copies are identical
      const firstHash = groupSkills[0].hash;
      const identical = groupSkills.every(s => s.hash === firstHash);

      duplicates.push({
        name,
        identical,
        skills: groupSkills
      });

      totalDuplicatesCount += groupSkills.length;
      if (!identical) {
        conflictsCount++;
      }

      // Calculate space savings (size of first copy * (copies - 1))
      const firstCopySize = getDirectorySize(groupSkills[0].path);
      savingsBytes += firstCopySize * (groupSkills.length - 1);
    }
  }

  // Drift detection: compare current SKILL.md hashes with registry contentHash
  const registry = loadRegistry();
  const driftedSkills: DriftedSkill[] = [];

  for (const centralSkill of scanResult.central.skills) {
    const regEntry = registry.skills[centralSkill.name];
    if (regEntry && regEntry.contentHash && centralSkill.hash) {
      if (regEntry.contentHash !== centralSkill.hash) {
        driftedSkills.push({
          name: centralSkill.name,
          registeredHash: regEntry.contentHash,
          currentHash: centralSkill.hash
        });
      }
    }
  }

  return {
    scanResult,
    duplicates,
    totalDuplicatesCount,
    conflictsCount,
    savingsBytes,
    driftedSkills
  };
}

/**
 * Serializes the DoctorAnalysis into the JSON report structure,
 * formatting all paths for display.
 */
export function serializeAnalysisToJson(analysis: DoctorAnalysis): object {
  const { scanResult, duplicates, totalDuplicatesCount, conflictsCount, savingsBytes, driftedSkills } = analysis;

  const runtimes = scanResult.runtimes.map(r => ({
    name: r.name,
    path: formatPath(r.path),
    exists: r.exists,
    skillCount: r.skills.length,
  }));

  const central = {
    exists: scanResult.central.exists,
    skillCount: scanResult.central.skills.length,
    path: formatPath(scanResult.central.path),
  };

  const dupesJson = duplicates.map(d => ({
    name: d.name,
    identical: d.identical,
    copies: d.skills.length,
    savingsBytes: getDirectorySize(d.skills[0].path) * (d.skills.length - 1),
    paths: d.skills.map(s => formatPath(s.path)),
  }));

  const incompleteTransactions = getIncompleteTransactions().map(t => ({
    skillName: t.skillName,
    timestamp: t.timestamp,
    source: formatPath(t.source),
    dest: formatPath(t.dest),
  }));

  const driftedJson = driftedSkills.map(d => ({
    name: d.name,
    registeredHash: d.registeredHash,
    currentHash: d.currentHash,
  }));

  return {
    runtimes,
    central,
    duplicates: dupesJson,
    totalDuplicatesCount,
    conflictsCount,
    savingsBytes,
    incompleteTransactions,
    driftedSkills: driftedJson,
  };
}

export interface DoctorOptions {
  json?: boolean;
  snapshot?: boolean;
}

/**
 * Outputs a reproducible snapshot (lockfile-style JSON) of all central skills.
 */
function outputSnapshot(): void {
  const scanResult = scanAll();
  const registry = loadRegistry();

  const skills: Record<string, { hash: string; runtimes: string[] }> = {};

  for (const skill of scanResult.central.skills) {
    const regEntry = registry.skills[skill.name];
    skills[skill.name] = {
      hash: skill.hash,
      runtimes: regEntry ? [...regEntry.runtimes] : []
    };
  }

  console.log(JSON.stringify({ skills }, null, 2));
}

/**
 * Executes the sk doctor command and outputs the analysis report.
 */
export function runDoctor(options: DoctorOptions = {}): void {
  if (options.snapshot) {
    outputSnapshot();
    return;
  }

  if (options.json) {
    const analysis = analyzeRuntimes();
    const json = serializeAnalysisToJson(analysis);
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  display.header('SkillFS Doctor 🔍');
  
  const analysis = analyzeRuntimes();
  const { scanResult, duplicates, totalDuplicatesCount, conflictsCount, savingsBytes, driftedSkills } = analysis;

  console.log('Scanned directories:');
  for (const runtime of scanResult.runtimes) {
    const formatted = formatPath(runtime.path);
    if (runtime.exists) {
      display.success(`${formatted}${' '.repeat(Math.max(2, 24 - formatted.length))}(${runtime.skills.length} skills)`);
    } else {
      display.warn(`${formatted} (directory not enabled)`);
    }
  }

  const centralFormatted = formatPath(scanResult.central.path);
  if (scanResult.central.exists) {
    display.success(`${centralFormatted}${' '.repeat(Math.max(2, 24 - centralFormatted.length))}(${scanResult.central.skills.length} skills)`);
  } else {
    display.warn(`${centralFormatted} (does not exist, will be created on dedupe)`);
  }

  console.log('');

  if (duplicates.length > 0) {
    console.log('Duplicates found:\n');

    for (const group of duplicates) {
      const statusLabel = group.identical 
        ? display.green('[identical ✓]') 
        : display.yellow('[content differs ⚠]');

      console.log(`  ${display.bold(group.name)}${' '.repeat(Math.max(1, 14 - group.name.length))}× ${group.skills.length}  ${statusLabel}`);
      
      // Sort skills so newer ones are presented first or consistently
      const sortedSkills = [...group.skills].sort((a, b) => {
        return getSkillMtime(b.path).getTime() - getSkillMtime(a.path).getTime();
      });

      for (let i = 0; i < sortedSkills.length; i++) {
        const skill = sortedSkills[i];
        const formattedSkillPath = formatPath(skill.path);
        const mtime = getSkillMtime(skill.path);
        const mtimeStr = formatDate(mtime);

        if (group.identical) {
          display.dim(`${formattedSkillPath}`);
        } else {
          const ageLabel = i === 0 ? 'newer' : 'older';
          display.dim(`${formattedSkillPath}   (${ageLabel}, modified ${mtimeStr})`);
        }
      }
      console.log('');
    }
  } else {
    console.log(display.green('  ✓ No duplicates found!'));
  }

  // Check for incomplete transactions from interrupted dedupe runs
  const incompleteTxns = getIncompleteTransactions();
  if (incompleteTxns.length > 0) {
    console.log('');
    display.header('⚠ Incomplete transactions detected (possibly from an interrupted dedupe):');
    for (const txn of incompleteTxns) {
      display.warn(`Skill "${txn.skillName}" migration started at ${txn.timestamp} but was not completed.`);
      display.dim(`  Source: ${formatPath(txn.source)} → Dest: ${formatPath(txn.dest)}`);
      display.dim(`  Involved runtimes: ${txn.runtimes.join(', ')}`);
      display.info(`  Tip: Check integrity of ~/.skills/${txn.skillName} and original paths, then re-run sk dedupe.`);
    }
    console.log('');
  }

  // Drift detection: report skills whose content differs from registry
  if (driftedSkills.length > 0) {
    console.log('');
    display.header('⚠ Content drift detected (SKILL.md differs from registry hash):');
    for (const d of driftedSkills) {
      display.warn(`${d.name}: content has diverged from the registry (may have been manually edited)`);
      display.dim(`  Registry hash: ${d.registeredHash.slice(0, 8)}...`);
      display.dim(`  Current hash:  ${d.currentHash.slice(0, 8)}...`);
    }
    console.log('');
  }

  console.log('Summary:');
  console.log(`  Duplicate groups: ${duplicates.length} (total ${totalDuplicatesCount} copies)`);
  console.log(`  Content conflicts: ${conflictsCount}${conflictsCount > 0 ? display.yellow(' (manual confirmation needed)') : ''}`);
  console.log(`  Potential savings: ~${formatBytes(savingsBytes)}`);
  if (driftedSkills.length > 0) {
    console.log(`  Content drift: ${driftedSkills.length}`);
  }
  console.log('');
  console.log(`Run ${display.bold('sk dedupe')} to migrate\n`);
}
