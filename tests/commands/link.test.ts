import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runLink } from '../../src/commands/link.js';

/**
 * Helper: create a skill in the central repo (~/.skills/<name>).
 */
function createCentralSkill(tmpDir: string, name: string, description: string): string {
  const centralDir = path.join(tmpDir, '.skills');
  fs.mkdirSync(centralDir, { recursive: true });
  const skillDir = path.join(centralDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\ndescription: ${description}\n---\n\n# ${name}\n\nA sample skill.\n`,
  );
  return skillDir;
}

/**
 * Helper: ensure runtime directories exist (needed for safeCreateSymlink).
 */
function ensureRuntimeDir(tmpDir: string, runtimeName: string): string {
  const dir = path.join(tmpDir, `.${runtimeName}`, 'skills');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('runLink', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-link-'));
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

  it('should link to a specific runtime', () => {
    createCentralSkill(tmpDir, 'my-skill', 'My Skill');
    ensureRuntimeDir(tmpDir, 'claude');

    runLink('my-skill', { runtime: 'claude' });

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Linked my-skill to claude');

    // Verify symlink exists
    const linkPath = path.join(tmpDir, '.claude', 'skills', 'my-skill');
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
  });

  it('should link skill to all runtimes with --all', () => {
    createCentralSkill(tmpDir, 'my-skill', 'My Skill');

    // Create runtime dirs
    ensureRuntimeDir(tmpDir, 'claude');
    ensureRuntimeDir(tmpDir, 'cursor');
    ensureRuntimeDir(tmpDir, 'codex');

    runLink('my-skill', { all: true });

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Linking my-skill to all runtimes');

    // Verify symlinks exist
    for (const name of ['claude', 'cursor', 'codex']) {
      const linkPath = path.join(tmpDir, `.${name}`, 'skills', 'my-skill');
      if (fs.existsSync(linkPath)) {
        expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
      }
    }
  });

  it('should link all skills with --all (no skill name)', () => {
    createCentralSkill(tmpDir, 'skill-a', 'Skill A');
    createCentralSkill(tmpDir, 'skill-b', 'Skill B');
    ensureRuntimeDir(tmpDir, 'claude');
    ensureRuntimeDir(tmpDir, 'cursor');

    runLink(undefined, { all: true });

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Linking all skills');

    // Verify symlinks exist
    for (const skill of ['skill-a', 'skill-b']) {
      const linkPath = path.join(tmpDir, '.claude', 'skills', skill);
      expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    }
  });

  it('should error on missing skill name when no --all', () => {
    createCentralSkill(tmpDir, 'my-skill', 'My Skill');

    runLink(undefined, {});

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Please provide a skill name');
  });

  it('should error on unknown runtime', () => {
    createCentralSkill(tmpDir, 'my-skill', 'My Skill');

    runLink('my-skill', { runtime: 'nonexistent-runtime' });

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Unknown runtime');
    expect(output).toContain('nonexistent-runtime');
  });

  it('should error when central repository does not exist', () => {
    // Don't create ~/.skills/

    runLink('my-skill', { runtime: 'claude' });

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Central repository does not exist');
  });

  it('should error when skill does not exist in central repo', () => {
    createCentralSkill(tmpDir, 'existing', 'Existing');
    ensureRuntimeDir(tmpDir, 'claude');

    runLink('nonexistent', { runtime: 'claude' });

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('does not exist in the central repository');
  });
});
