import * as fs from 'fs';
import * as path from 'path';
import { scanAll, RuntimeScanStatus, ScanResult } from '../core/scanner.js';
import { Skill } from '../core/skill.js';
import { display, formatPath } from '../utils/display.js';
import { getIncompleteTransactions } from './dedupe.js';

export interface DuplicateGroup {
  name: string;
  identical: boolean;
  skills: Skill[];
}

export interface DoctorAnalysis {
  scanResult: ScanResult;
  duplicates: DuplicateGroup[];
  totalDuplicatesCount: number;
  conflictsCount: number;
  savingsBytes: number;
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

  return {
    scanResult,
    duplicates,
    totalDuplicatesCount,
    conflictsCount,
    savingsBytes
  };
}

/**
 * Serializes the DoctorAnalysis into the JSON report structure,
 * formatting all paths for display.
 */
export function serializeAnalysisToJson(analysis: DoctorAnalysis): object {
  const { scanResult, duplicates, totalDuplicatesCount, conflictsCount, savingsBytes } = analysis;

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

  return {
    runtimes,
    central,
    duplicates: dupesJson,
    totalDuplicatesCount,
    conflictsCount,
    savingsBytes,
    incompleteTransactions,
  };
}

export interface DoctorOptions {
  json?: boolean;
}

/**
 * Executes the sk doctor command and outputs the analysis report.
 */
export function runDoctor(options: DoctorOptions = {}): void {
  if (options.json) {
    const analysis = analyzeRuntimes();
    const json = serializeAnalysisToJson(analysis);
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  display.header('SkillFS Doctor 🔍');
  
  const analysis = analyzeRuntimes();
  const { scanResult, duplicates, totalDuplicatesCount, conflictsCount, savingsBytes } = analysis;

  console.log('扫描目录：');
  for (const runtime of scanResult.runtimes) {
    const formatted = formatPath(runtime.path);
    if (runtime.exists) {
      display.success(`${formatted}${' '.repeat(Math.max(2, 24 - formatted.length))}(${runtime.skills.length} skills)`);
    } else {
      display.warn(`${formatted} (目录未启用)`);
    }
  }

  const centralFormatted = formatPath(scanResult.central.path);
  if (scanResult.central.exists) {
    display.success(`${centralFormatted}${' '.repeat(Math.max(2, 24 - centralFormatted.length))}(${scanResult.central.skills.length} skills)`);
  } else {
    display.warn(`${centralFormatted} (不存在，将在 dedupe 时创建)`);
  }

  console.log('');

  if (duplicates.length === 0) {
    console.log(display.green('  ✓ 未发现重复 Skill，一切正常！'));
    return;
  }

  console.log('发现重复 Skill：\n');

  for (const group of duplicates) {
    const statusLabel = group.identical 
      ? display.green('[内容相同 ✓]') 
      : display.yellow('[内容不同 ⚠]');

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
        const ageLabel = i === 0 ? '较新' : '较旧';
        display.dim(`${formattedSkillPath}   (${ageLabel}，修改于 ${mtimeStr})`);
      }
    }
    console.log('');
  }

  // Check for incomplete transactions from interrupted dedupe runs
  const incompleteTxns = getIncompleteTransactions();
  if (incompleteTxns.length > 0) {
    console.log('');
    display.header('⚠ 检测到不完整的事务 (可能由中断的 dedupe 导致):');
    for (const txn of incompleteTxns) {
      display.warn(`Skill "${txn.skillName}" 的迁移在 ${txn.timestamp} 开始但未完成。`);
      display.dim(`  来源: ${formatPath(txn.source)} → 目标: ${formatPath(txn.dest)}`);
      display.dim(`  涉及运行时: ${txn.runtimes.join(', ')}`);
      display.info(`  建议: 检查 ~/.skills/${txn.skillName} 和原始路径的完整性，然后重新运行 sk dedupe。`);
    }
    console.log('');
  }

  console.log('汇总：');
  console.log(`  重复 Skill：${duplicates.length} 个（共 ${totalDuplicatesCount} 个副本）`);
  console.log(`  内容冲突：${conflictsCount} 个${conflictsCount > 0 ? display.yellow('（需手动确认）') : ''}`);
  console.log(`  可节省空间：约 ${formatBytes(savingsBytes)}`);
  console.log('');
  console.log(`运行 ${display.bold('sk dedupe')} 开始迁移\n`);
}
