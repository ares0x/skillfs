import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runList } from '../../src/commands/list.js';
import { safeCreateSymlink } from '../../src/utils/fs.js';

/**
 * Helper: create a skill in a given directory.
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

describe('runList', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-list-'));
    originalEnv = process.env.SKILLFS_HOME_OVERRIDE;
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
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
  });

  it('should show skills in central repo', () => {
    const centralPath = path.join(tmpDir, '.skills');
    createSkill(centralPath, 'pdf', 'PDF Skill');
    createSkill(centralPath, 'image-gen', 'Image Gen');

    runList();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('SkillFS List');
    expect(output).toContain('pdf');
    expect(output).toContain('image-gen');
    expect(output).toContain('Source of Truth');
  });

  it('should show no skills message when central is empty', () => {
    const centralPath = path.join(tmpDir, '.skills');
    fs.mkdirSync(centralPath, { recursive: true });

    runList();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('(no skills)');
  });

  it('should show unmigrated skills in runtime dirs', () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    createSkill(claudePath, 'unmigrated-skill', 'Unmigrated');

    // No central .skills dir means skill is unmigrated
    runList();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('unmigrated-skill');
    expect(output).toContain('not migrated');
    expect(output).toContain('not in ~/.skills/');
  });

  it('should show all skills synced when everything is central', () => {
    const centralPath = path.join(tmpDir, '.skills');
    createSkill(centralPath, 'synced-skill', 'Synced Skill');

    // No runtime skills => all synced
    runList();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('All skills are synced');
  });

  it('should show valid link status (✓) for correct symlinks', () => {
    const centralPath = path.join(tmpDir, '.skills');
    const centralSkill = createSkill(centralPath, 'linked-skill', 'Linked');

    // Create runtime dir and symlink to central
    const runtimeDir = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(runtimeDir, { recursive: true });
    safeCreateSymlink(centralSkill, path.join(runtimeDir, 'linked-skill'), centralPath);

    runList();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('linked-skill');
    // Should show the ✓ symbol
    expect(output).toContain('✓');
  });

  it('should show broken link status (⚠) for broken symlinks', () => {
    const centralPath = path.join(tmpDir, '.skills');
    const centralSkill = createSkill(centralPath, 'broken-skill', 'Broken');

    // Create runtime dir and symlink to a non-existent target
    const runtimeDir = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(runtimeDir, { recursive: true });
    const badTarget = path.join(tmpDir, '.skills', 'deleted-skill');
    fs.symlinkSync(
      path.relative(runtimeDir, badTarget),
      path.join(runtimeDir, 'broken-skill'),
    );

    runList();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('broken-skill');
    expect(output).toContain('⚠');
  });

  it('should show missing link status (-) for skills not linked', () => {
    const centralPath = path.join(tmpDir, '.skills');
    createSkill(centralPath, 'unlinked-skill', 'Unlinked');

    // Create runtime dir but NO symlink
    const runtimeDir = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(runtimeDir, { recursive: true });

    runList();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('unlinked-skill');
    // Should show `-` as not-linked indicator
    expect(output).toContain('-');
  });

  it('should show legend', () => {
    runList();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Legend');
    expect(output).toContain('linked');
    expect(output).toContain('not linked');
    expect(output).toContain('broken link');
  });
});
