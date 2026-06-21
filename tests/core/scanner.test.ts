import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanAll, ScanResult } from '../../src/core/scanner.js';
import { DEFAULT_RUNTIMES } from '../../src/core/config.js';

describe('scanAll', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-scan-'));
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

  function createSkillInDir(dirPath: string, name: string, description: string): string {
    const skillDir = path.join(dirPath, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\ndescription: ${description}\n---`);
    return skillDir;
  }

  it('should scan with no runtimes existing (empty result)', () => {
    const result = scanAll();
    expect(result.runtimes).toHaveLength(DEFAULT_RUNTIMES.length);
    for (const rt of result.runtimes) {
      expect(rt.exists).toBe(false);
      expect(rt.skills).toHaveLength(0);
    }
  });

  it('should scan runtimes with skills', () => {
    // Create claude runtime with two skills
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    createSkillInDir(claudePath, 'pdf', 'PDF Skill');
    createSkillInDir(claudePath, 'image-gen', 'Image Generation Skill');

    const result = scanAll();
    const claudeRuntime = result.runtimes.find(r => r.name === 'claude');
    expect(claudeRuntime).toBeDefined();
    expect(claudeRuntime!.exists).toBe(true);
    expect(claudeRuntime!.skills).toHaveLength(2);

    const skillNames = claudeRuntime!.skills.map(s => s.name);
    expect(skillNames).toContain('pdf');
    expect(skillNames).toContain('image-gen');
  });

  it('should skip hidden directories', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    createSkillInDir(claudePath, 'pdf', 'PDF Skill');
    // Create a hidden directory (should be skipped)
    fs.mkdirSync(path.join(claudePath, '.hidden-skill'));
    fs.writeFileSync(path.join(claudePath, '.hidden-skill', 'SKILL.md'), '---\ndescription: Hidden\n---');

    const result = scanAll();
    const claudeRuntime = result.runtimes.find(r => r.name === 'claude');
    expect(claudeRuntime!.skills).toHaveLength(1);
    expect(claudeRuntime!.skills[0].name).toBe('pdf');
  });

  it('should scan central skills directory', () => {
    const centralPath = path.join(tmpDir, '.skills');
    createSkillInDir(centralPath, 'central-skill', 'Central Skill');

    const result = scanAll();
    expect(result.central.exists).toBe(true);
    expect(result.central.skills).toHaveLength(1);
    expect(result.central.skills[0].name).toBe('central-skill');
    expect(result.central.skills[0].runtime).toBe('skills');
  });

  it('should handle multiple runtimes with same skill name', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentPath = path.join(tmpDir, '.agents', 'skills');
    
    createSkillInDir(claudePath, 'pdf', 'PDF for Claude');
    createSkillInDir(agentPath, 'pdf', 'PDF for Agent');

    const result = scanAll();
    
    // allSkills should contain both
    const pdfSkills = result.allSkills.filter(s => s.name === 'pdf');
    expect(pdfSkills).toHaveLength(2);
    expect(pdfSkills.map(s => s.runtime).sort()).toEqual(['agents', 'claude']);
  });

  it('should not include skills from non-existent runtimes', () => {
    // Don't create any runtime dirs
    const result = scanAll();
    const existingSkillsOnly = result.allSkills.filter(s => s.runtime !== 'skills');
    expect(existingSkillsOnly).toHaveLength(0);
  });

  it('should mark runtime as not existing when path is missing', () => {
    // Point HOME_OVERRIDE to tmpDir which has no runtime dirs
    const result = scanAll();
    for (const rt of result.runtimes) {
      expect(rt.exists).toBe(false);
      expect(rt.skills).toHaveLength(0);
    }
  });

  it('should populate allSkills from both runtimes and central', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const centralPath = path.join(tmpDir, '.skills');

    createSkillInDir(claudePath, 'pdf', 'Claude PDF');
    createSkillInDir(centralPath, 'central-skill', 'Central');

    const result = scanAll();
    // allSkills should contain both
    expect(result.allSkills.length).toBeGreaterThanOrEqual(2);
    expect(result.allSkills.some(s => s.name === 'pdf')).toBe(true);
    expect(result.allSkills.some(s => s.name === 'central-skill')).toBe(true);
  });

  it('should handle skills without SKILL.md', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const skillDir = path.join(claudePath, 'no-md');
    fs.mkdirSync(skillDir, { recursive: true });
    // No SKILL.md file

    const result = scanAll();
    const claudeRuntime = result.runtimes.find(r => r.name === 'claude');
    expect(claudeRuntime!.skills).toHaveLength(1);
    expect(claudeRuntime!.skills[0].description).toBe('(No SKILL.md)');
  });
});
