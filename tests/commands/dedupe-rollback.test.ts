import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock copyDirectory to do nothing so hash verification fails and rollback triggers.
// This vi.mock is hoisted above imports, so it takes effect before the module loads.
vi.mock('../../src/utils/fs.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/fs.js')>('../../src/utils/fs.js');
  return {
    ...actual,
    copyDirectory: vi.fn((_src: string, _dest: string) => {
      // Do NOT copy — the dest won't exist, causing hash verification to fail
    }),
  };
});

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
 * Helper: create empty runtime dirs to avoid directory-not-found noise.
 */
function ensureRuntimeDirs(tmpDir: string): void {
  for (const name of ['claude', 'agents', 'clawdbot', 'cursor', 'codex', 'gemini', 'windsurf', 'cline', 'continue', 'aider', 'augment', 'roo', 'opencode', 'trae']) {
    fs.mkdirSync(path.join(tmpDir, `.${name}`, 'skills'), { recursive: true });
  }
}

describe('runDedupe rollback', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-rollback-'));
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

  it('should roll back transaction on copy failure (hash mismatch)', async () => {
    ensureRuntimeDirs(tmpDir);

    const centralDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(centralDir, { recursive: true });

    const claudePath = path.join(tmpDir, '.claude', 'skills');
    createSkill(claudePath, 'my-skill', 'My Skill');

    // Create a second copy in agents to trigger dedupe
    const agentsPath = path.join(tmpDir, '.agents', 'skills');
    createSkill(agentsPath, 'my-skill', 'My Skill');

    await runDedupe();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');

    // Migration should have failed and rolled back
    expect(output).toContain('Migration failed');

    // Dest should NOT exist (rolled back)
    const centralSkill = path.join(centralDir, 'my-skill');
    expect(fs.existsSync(centralSkill)).toBe(false);

    // Original should still exist
    const claudeSkill = path.join(claudePath, 'my-skill');
    expect(fs.existsSync(claudeSkill)).toBe(true);

    // Original should NOT be a symlink (it was not migrated)
    expect(fs.lstatSync(claudeSkill).isDirectory()).toBe(true);
  });
});
