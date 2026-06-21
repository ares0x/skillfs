import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  runDoctor,
  analyzeRuntimes,
  serializeAnalysisToJson,
  getSkillMtime,
  formatDate,
  getDirectorySize,
  formatBytes,
  DoctorAnalysis,
} from '../../src/commands/doctor.js';

/**
 * Helper: create a skill directory with a SKILL.md file.
 */
function createSkill(dirPath: string, name: string, description: string): string {
  const skillDir = path.join(dirPath, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\ndescription: ${description}\n---\n\n# ${name}\n\nA sample skill.\n`,
  );
  return skillDir;
}

describe('runDoctor', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-doctor-'));
    originalEnv = process.env.SKILLFS_HOME_OVERRIDE;
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.SKILLFS_HOME_OVERRIDE = originalEnv;
    } else {
      delete process.env.SKILLFS_HOME_OVERRIDE;
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should output normal text when no duplicates', () => {
    // Create central dir but no runtime skills => no duplicates
    const centralPath = path.join(tmpDir, '.skills');
    createSkill(centralPath, 'unique-skill', 'A unique skill');

    runDoctor();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('SkillFS Doctor');
    expect(output).toContain('No duplicates found');
  });

  it('should detect identical duplicates', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');

    createSkill(claudePath, 'pdf', 'PDF Skill');
    createSkill(agentsPath, 'pdf', 'PDF Skill');

    runDoctor();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('pdf');
    expect(output).toContain('[identical ✓]');
    expect(output).toContain('Duplicate groups: 1');
  });

  it('should detect conflicting duplicates (different content)', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');

    createSkill(claudePath, 'pdf', 'PDF for Claude');
    createSkill(agentsPath, 'pdf', 'PDF for Agent');

    runDoctor();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('pdf');
    expect(output).toContain('[content differs ⚠]');
    expect(output).toContain('Content conflicts: 1');
  });

  it('should output valid JSON with correct fields', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');
    createSkill(claudePath, 'pdf', 'PDF Skill');
    createSkill(agentsPath, 'pdf', 'PDF Skill');

    runDoctor({ json: true });

    const args = consoleLogSpy.mock.calls.find(c => {
      try { JSON.parse(c[0]); return true; } catch { return false; }
    });
    expect(args).toBeDefined();
    const json = JSON.parse(args![0]);

    expect(json).toHaveProperty('runtimes');
    expect(json).toHaveProperty('central');
    expect(json).toHaveProperty('duplicates');
    expect(json).toHaveProperty('totalDuplicatesCount');
    expect(json).toHaveProperty('conflictsCount');
    expect(json).toHaveProperty('savingsBytes');
    expect(json).toHaveProperty('incompleteTransactions');
    expect(json).toHaveProperty('driftedSkills');

    expect(json.totalDuplicatesCount).toBe(2);
    expect(json.conflictsCount).toBe(0);
    expect(Array.isArray(json.duplicates)).toBe(true);
    expect(json.duplicates.length).toBe(1);
    expect(json.duplicates[0].name).toBe('pdf');
    expect(json.duplicates[0].identical).toBe(true);
    expect(json.duplicates[0].copies).toBe(2);
    expect(json.duplicates[0].paths).toHaveLength(2);

    // runtimes should be present
    expect(Array.isArray(json.runtimes)).toBe(true);
    expect(json.runtimes.length).toBeGreaterThan(0);
    for (const rt of json.runtimes) {
      expect(rt).toHaveProperty('name');
      expect(rt).toHaveProperty('path');
      expect(rt).toHaveProperty('exists');
      expect(rt).toHaveProperty('skillCount');
    }
  });

  it('should output snapshot format', () => {
    const centralPath = path.join(tmpDir, '.skills');
    createSkill(centralPath, 'my-skill', 'My Skill');

    runDoctor({ snapshot: true });

    const args = consoleLogSpy.mock.calls.find(c => {
      try { JSON.parse(c[0]); return true; } catch { return false; }
    });
    expect(args).toBeDefined();
    const json = JSON.parse(args![0]);

    expect(json).toHaveProperty('skills');
    expect(json.skills).toHaveProperty('my-skill');
    expect(json.skills['my-skill']).toHaveProperty('hash');
    expect(json.skills['my-skill']).toHaveProperty('runtimes');
    expect(typeof json.skills['my-skill'].hash).toBe('string');
    expect(json.skills['my-skill'].hash.length).toBe(32);
  });

  it('should detect drift when central SKILL.md differs from registry', () => {
    const centralPath = path.join(tmpDir, '.skills');
    createSkill(centralPath, 'drifted-skill', 'Original description');

    // Write a registry with a different hash
    const registryDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, 'registry.json'),
      JSON.stringify({
        version: '1',
        skills: {
          'drifted-skill': {
            installedAt: new Date().toISOString(),
            source: 'local',
            runtimes: ['claude'],
            contentHash: '00000000000000000000000000000000',
          },
        },
      }, null, 2),
    );

    runDoctor();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Content drift detected');
    expect(output).toContain('drifted-skill');
  });

  it('should detect incomplete transactions', async () => {
    // TXN_LOG_PATH is a module-level constant computed at import time.
    // We need to reset modules and dynamically import after setting the env var.
    vi.resetModules();

    const centralPath = path.join(tmpDir, '.skills');
    fs.mkdirSync(centralPath, { recursive: true });

    // Write an incomplete transaction log
    const txnLog = JSON.stringify({
      timestamp: new Date().toISOString(),
      skillName: 'half-done',
      operation: 'migrate',
      source: '/tmp/source',
      dest: path.join(tmpDir, '.skills', 'half-done'),
      status: 'started',
      runtimes: ['claude'],
    }) + '\n';
    fs.writeFileSync(path.join(centralPath, '.dedupe-txn.log'), txnLog);

    const consoleLogSpyLocal = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Dynamic import with fresh module cache
    const { runDoctor: freshRunDoctor } = await import('../../src/commands/doctor.js');
    freshRunDoctor();

    const output = consoleLogSpyLocal.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Incomplete transactions');
    expect(output).toContain('half-done');

    consoleLogSpyLocal.mockRestore();
  });
});

describe('getSkillMtime', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-mtime-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return mtime of SKILL.md if it exists', () => {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'content');
    const mtime = getSkillMtime(skillDir);
    expect(mtime.getTime()).toBeGreaterThan(0);
  });

  it('should fall back to directory mtime if no SKILL.md', () => {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir);
    const mtime = getSkillMtime(skillDir);
    expect(mtime.getTime()).toBeGreaterThan(0);
  });

  it('should return epoch for non-existent path', () => {
    const mtime = getSkillMtime('/nonexistent/path');
    expect(mtime.getTime()).toBe(0);
  });
});

describe('formatDate', () => {
  it('should format date as YYYY-MM-DD', () => {
    const d = new Date('2024-03-15T12:00:00Z');
    expect(formatDate(d)).toBe('2024-03-15');
  });

  it('should pad single-digit months and days', () => {
    const d = new Date('2024-01-05T00:00:00Z');
    expect(formatDate(d)).toBe('2024-01-05');
  });
});

describe('getDirectorySize', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-size-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should calculate total size of files in directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world!');
    const size = getDirectorySize(tmpDir);
    expect(size).toBeGreaterThan(0);
    expect(size).toBe(11); // 'hello' (5) + 'world!' (6)
  });

  it('should include nested directories', () => {
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(tmpDir, 'root.txt'), 'x');
    fs.writeFileSync(path.join(subDir, 'sub.txt'), 'yy');
    const size = getDirectorySize(tmpDir);
    expect(size).toBe(3); // 'x' (1) + 'yy' (2)
  });

  it('should return 0 for empty directory', () => {
    const size = getDirectorySize(tmpDir);
    expect(size).toBe(0);
  });

  it('should return 0 for non-existent path', () => {
    const size = getDirectorySize('/nonexistent/path');
    expect(size).toBe(0);
  });
});

describe('formatBytes', () => {
  it('should format bytes under 1KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(500)).toBe('500 B');
  });

  it('should format KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('should format MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});

describe('analyzeRuntimes', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-analyze-'));
    originalEnv = process.env.SKILLFS_HOME_OVERRIDE;
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.SKILLFS_HOME_OVERRIDE = originalEnv;
    } else {
      delete process.env.SKILLFS_HOME_OVERRIDE;
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should find no duplicates when no runtimes have skills', () => {
    const analysis = analyzeRuntimes();
    expect(analysis.duplicates).toHaveLength(0);
    expect(analysis.totalDuplicatesCount).toBe(0);
    expect(analysis.conflictsCount).toBe(0);
    expect(analysis.savingsBytes).toBe(0);
  });

  it('should find identical duplicates across two runtimes', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');
    createSkill(claudePath, 'pdf', 'PDF Skill');
    createSkill(agentsPath, 'pdf', 'PDF Skill');

    const analysis = analyzeRuntimes();
    expect(analysis.duplicates).toHaveLength(1);
    expect(analysis.duplicates[0].name).toBe('pdf');
    expect(analysis.duplicates[0].identical).toBe(true);
    expect(analysis.duplicates[0].skills).toHaveLength(2);
    expect(analysis.totalDuplicatesCount).toBe(2);
    expect(analysis.conflictsCount).toBe(0);
  });

  it('should find conflicting duplicates when content differs', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');
    createSkill(claudePath, 'pdf', 'PDF for Claude');
    createSkill(agentsPath, 'pdf', 'PDF for Agent');

    const analysis = analyzeRuntimes();
    expect(analysis.duplicates).toHaveLength(1);
    expect(analysis.duplicates[0].identical).toBe(false);
    expect(analysis.conflictsCount).toBe(1);
  });

  it('should detect drifted skills when registry hash differs from current', () => {
    const centralPath = path.join(tmpDir, '.skills');
    createSkill(centralPath, 'drifted', 'Current description');

    // Write registry with different hash
    fs.writeFileSync(
      path.join(centralPath, 'registry.json'),
      JSON.stringify({
        version: '1',
        skills: {
          'drifted': {
            installedAt: new Date().toISOString(),
            source: 'local',
            runtimes: ['claude'],
            contentHash: '00000000000000000000000000000000',
          },
        },
      }, null, 2),
    );

    const analysis = analyzeRuntimes();
    expect(analysis.driftedSkills).toHaveLength(1);
    expect(analysis.driftedSkills[0].name).toBe('drifted');
    expect(analysis.driftedSkills[0].registeredHash).toBe('00000000000000000000000000000000');
    expect(analysis.driftedSkills[0].currentHash).toBeTruthy();
    expect(analysis.driftedSkills[0].currentHash).not.toBe('00000000000000000000000000000000');
  });

  it('should not flag non-drifted skills (hash matches registry)', () => {
    const centralPath = path.join(tmpDir, '.skills');
    createSkill(centralPath, 'stable', 'Stable skill');

    // Compute the actual hash from the created SKILL.md
    const crypto = require('crypto');
    const content = fs.readFileSync(path.join(centralPath, 'stable', 'SKILL.md'), 'utf8');
    const actualHash = crypto.createHash('md5').update(content).digest('hex');

    fs.writeFileSync(
      path.join(centralPath, 'registry.json'),
      JSON.stringify({
        version: '1',
        skills: {
          'stable': {
            installedAt: new Date().toISOString(),
            source: 'local',
            runtimes: ['claude'],
            contentHash: actualHash,
          },
        },
      }, null, 2),
    );

    const analysis = analyzeRuntimes();
    expect(analysis.driftedSkills).toHaveLength(0);
  });

  it('should calculate space savings for duplicates', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');
    const cursorPath = path.join(tmpDir, '.cursor', 'skills');

    createSkill(claudePath, 'pdf', 'PDF Skill');
    createSkill(agentsPath, 'pdf', 'PDF Skill');
    createSkill(cursorPath, 'pdf', 'PDF Skill');

    const analysis = analyzeRuntimes();
    expect(analysis.duplicates[0].skills).toHaveLength(3);
    // 3 copies means 2 redundant copies
    expect(analysis.totalDuplicatesCount).toBe(3);
    expect(analysis.savingsBytes).toBeGreaterThan(0);
  });
});

describe('serializeAnalysisToJson', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-serialize-'));
    originalEnv = process.env.SKILLFS_HOME_OVERRIDE;
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.SKILLFS_HOME_OVERRIDE = originalEnv;
    } else {
      delete process.env.SKILLFS_HOME_OVERRIDE;
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should include duplicate group information', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');
    createSkill(claudePath, 'pdf', 'PDF Skill');
    createSkill(agentsPath, 'pdf', 'PDF Skill');

    const analysis = analyzeRuntimes();
    const json = serializeAnalysisToJson(analysis) as Record<string, unknown>;

    expect(json.duplicates).toBeDefined();
    const dupes = json.duplicates as Array<Record<string, unknown>>;
    expect(dupes).toHaveLength(1);
    expect(dupes[0].name).toBe('pdf');
    expect(dupes[0].identical).toBe(true);
    expect(dupes[0].copies).toBe(2);
    expect(Array.isArray(dupes[0].paths)).toBe(true);
  });

  it('should include runtime scan information', () => {
    const analysis = analyzeRuntimes();
    const json = serializeAnalysisToJson(analysis) as Record<string, unknown>;

    const runtimes = json.runtimes as Array<Record<string, unknown>>;
    expect(Array.isArray(runtimes)).toBe(true);
    expect(runtimes.length).toBeGreaterThan(0);
    for (const rt of runtimes) {
      expect(rt).toHaveProperty('name');
      expect(rt).toHaveProperty('path');
      expect(rt).toHaveProperty('exists');
      expect(rt).toHaveProperty('skillCount');
    }
  });
});
