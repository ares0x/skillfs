import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runUninstall } from '../../src/commands/uninstall.js';
import { loadRegistry, registerSkillRuntime, saveRegistry, lockRegistry } from '../../src/core/registry.js';
import { getCentralSkillsPath } from '../../src/core/config.js';
import { isSymlink, safeCreateSymlink, resolveHomePath } from '../../src/utils/fs.js';

describe('sk uninstall', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-uninstall-'));
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

  function setupSkill(skillName: string, runtimes: string[]): string {
    const centralDir = getCentralSkillsPath();
    const skillPath = path.join(centralDir, skillName);
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(path.join(skillPath, 'SKILL.md'), `# ${skillName}\n`);
    fs.writeFileSync(path.join(skillPath, 'helper.txt'), 'some content');

    // Register and create symlinks
    for (const rt of runtimes) {
      registerSkillRuntime(skillName, rt);

      const runtimeSkillsDir = resolveHomePath(`~/.${rt}/skills`);
      fs.mkdirSync(runtimeSkillsDir, { recursive: true });
      safeCreateSymlink(skillPath, path.join(runtimeSkillsDir, skillName), centralDir);
    }

    return skillPath;
  }

  it('should uninstall a skill from all runtimes and ~/.skills/', async () => {
    const skillPath = setupSkill('my-skill', ['rt-a', 'rt-b']);

    await runUninstall('my-skill', {});

    // Central directory should be gone
    expect(fs.existsSync(skillPath)).toBe(false);

    // Symlinks should be gone
    expect(fs.existsSync(path.join(resolveHomePath('~/.rt-a/skills'), 'my-skill'))).toBe(false);
    expect(fs.existsSync(path.join(resolveHomePath('~/.rt-b/skills'), 'my-skill'))).toBe(false);

    // Registry should be gone
    const registry = loadRegistry();
    expect(registry.skills['my-skill']).toBeUndefined();
  });

  it('should uninstall from one runtime only, keeping ~/.skills/', async () => {
    const skillPath = setupSkill('my-skill', ['rt-a', 'rt-b']);

    await runUninstall('my-skill', { runtime: 'rt-a' });

    // Central directory should still exist
    expect(fs.existsSync(skillPath)).toBe(true);

    // rt-a symlink should be gone
    expect(fs.existsSync(path.join(resolveHomePath('~/.rt-a/skills'), 'my-skill'))).toBe(false);

    // rt-b symlink should still exist
    expect(isSymlink(path.join(resolveHomePath('~/.rt-b/skills'), 'my-skill'))).toBe(true);

    // Registry should only have rt-b
    const registry = loadRegistry();
    expect(registry.skills['my-skill']).toBeDefined();
    expect(registry.skills['my-skill'].runtimes).toEqual(['rt-b']);
  });

  it('should error for non-existent skill', async () => {
    await runUninstall('nonexistent', {});
    // Should not throw
  });

  it('should not remove symlink that points elsewhere', async () => {
    const skillPath = setupSkill('my-skill', ['rt-a']);

    // Create a symlink in rt-b that points somewhere else
    const runtimeSkillsDirB = resolveHomePath('~/.rt-b/skills');
    fs.mkdirSync(runtimeSkillsDirB, { recursive: true });
    const otherTarget = path.join(tmpDir, 'other-dir');
    fs.mkdirSync(otherTarget, { recursive: true });
    fs.writeFileSync(path.join(otherTarget, 'SKILL.md'), 'other');
    fs.symlinkSync(otherTarget, path.join(runtimeSkillsDirB, 'my-skill'));

    await runUninstall('my-skill', {});

    // rt-a symlink should be gone
    expect(fs.existsSync(path.join(resolveHomePath('~/.rt-a/skills'), 'my-skill'))).toBe(false);

    // rt-b symlink should still exist (it pointed elsewhere)
    expect(isSymlink(path.join(resolveHomePath('~/.rt-b/skills'), 'my-skill'))).toBe(true);

    // Central dir should be gone
    expect(fs.existsSync(skillPath)).toBe(false);
  });

  it('should uninstall when skill exists only in ~/.skills/ (not in registry)', async () => {
    const centralDir = getCentralSkillsPath();
    const skillPath = path.join(centralDir, 'orphan-skill');
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# orphan\n');

    // Also create a symlink in a runtime
    const runtimeSkillsDir = resolveHomePath('~/.rt-a/skills');
    fs.mkdirSync(runtimeSkillsDir, { recursive: true });
    safeCreateSymlink(skillPath, path.join(runtimeSkillsDir, 'orphan-skill'), centralDir);

    await runUninstall('orphan-skill', {});

    // Central directory should be gone
    expect(fs.existsSync(skillPath)).toBe(false);

    // Symlink should be gone
    expect(fs.existsSync(path.join(runtimeSkillsDir, 'orphan-skill'))).toBe(false);
  });

  it('should handle uninstalling last runtime from a skill', async () => {
    const skillPath = setupSkill('my-skill', ['rt-a']);

    await runUninstall('my-skill', { runtime: 'rt-a' });

    // Central directory should still exist (--runtime mode)
    expect(fs.existsSync(skillPath)).toBe(true);

    // Registry should have skill entry removed
    const registry = loadRegistry();
    expect(registry.skills['my-skill']).toBeUndefined();
  });

  it('should not break when skill has no registered runtimes', async () => {
    // Create skill directory only, no runtimes
    const centralDir = getCentralSkillsPath();
    const skillPath = path.join(centralDir, 'lonely-skill');
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# lonely\n');

    // Manually register without runtimes
    const release = lockRegistry();
    try {
      const registry = loadRegistry();
      registry.skills['lonely-skill'] = {
        installedAt: new Date().toISOString(),
        source: 'local',
        runtimes: [],
      };
      saveRegistry(registry);
    } finally {
      release();
    }

    await runUninstall('lonely-skill', {});

    // Central directory should be gone
    expect(fs.existsSync(skillPath)).toBe(false);
  });
});
