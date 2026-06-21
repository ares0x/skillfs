import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runDedupe } from '../../src/commands/dedupe.js';

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

/**
 * Helper: create an empty dir for runtimes that need to exist.
 */
function ensureRuntimeDirs(tmpDir: string): void {
  for (const name of ['claude', 'agents', 'clawdbot', 'cursor', 'codex', 'gemini', 'windsurf', 'cline', 'continue', 'aider', 'augment', 'roo', 'opencode', 'trae']) {
    fs.mkdirSync(path.join(tmpDir, `.${name}`, 'skills'), { recursive: true });
  }
}

describe('runDedupe', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-dedupe-'));
    originalEnv = process.env.SKILLFS_HOME_OVERRIDE;
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    consoleErrorSpy.mockRestore();
  });

  it('should say no duplicates when none exist', async () => {
    ensureRuntimeDirs(tmpDir);

    await runDedupe();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('No duplicates found');
  });

  it('should auto-migrate identical skills without interaction', async () => {
    ensureRuntimeDirs(tmpDir);

    // Create central skills dir (needed for migration target)
    const centralDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(centralDir, { recursive: true });

    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');

    createSkill(claudePath, 'pdf', 'PDF Skill');
    createSkill(agentsPath, 'pdf', 'PDF Skill');

    await runDedupe();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Found identical skill');
    expect(output).toContain('pdf');
    expect(output).toContain('Migrated: 1');

    // Verify central skill exists
    const centralSkill = path.join(centralDir, 'pdf');
    expect(fs.existsSync(centralSkill)).toBe(true);
    expect(fs.existsSync(path.join(centralSkill, 'SKILL.md'))).toBe(true);

    // Verify originals replaced with symlinks
    const claudeSkill = path.join(claudePath, 'pdf');
    expect(fs.lstatSync(claudeSkill).isSymbolicLink()).toBe(true);
  });

  it('should not modify filesystem when dry-run is enabled', async () => {
    ensureRuntimeDirs(tmpDir);

    const centralDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(centralDir, { recursive: true });

    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');

    createSkill(claudePath, 'pdf', 'PDF Skill');
    createSkill(agentsPath, 'pdf', 'PDF Skill');

    await runDedupe({ dryRun: true });

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('DRY RUN');
    expect(output).toContain('[DRY RUN]');

    // Central skill should NOT exist (dry run)
    const centralSkill = path.join(centralDir, 'pdf');
    expect(fs.existsSync(centralSkill)).toBe(false);

    // Originals should still be real directories
    const claudeSkill = path.join(claudePath, 'pdf');
    expect(fs.existsSync(claudeSkill)).toBe(true);
    expect(fs.lstatSync(claudeSkill).isDirectory()).toBe(true);
  });

  it('should skip when no duplicates exist in populated directories', async () => {
    ensureRuntimeDirs(tmpDir);

    const centralDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(centralDir, { recursive: true });

    const claudePath = path.join(tmpDir, '.claude', 'skills');
    const agentsPath = path.join(tmpDir, '.agents', 'skills');

    // Each runtime has a unique skill — no duplicates
    createSkill(claudePath, 'pdf', 'PDF Skill');
    createSkill(agentsPath, 'image-gen', 'Image Gen');

    await runDedupe();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('No duplicates found, nothing to dedupe');
  });
});
