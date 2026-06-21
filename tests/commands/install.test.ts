import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runInstall } from '../../src/commands/install.js';
import { loadRegistry } from '../../src/core/registry.js';
import { getCentralSkillsPath } from '../../src/core/config.js';
import { isSymlink, resolveHomePath } from '../../src/utils/fs.js';

describe('sk install', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-install-'));
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

  function createSkillSource(name: string): string {
    const srcDir = path.join(tmpDir, 'source', name);
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), `# Skill: ${name}\n\nDescription of ${name}.\n`);
    return srcDir;
  }

  it('should install a skill directory to ~/.skills/ and link to runtimes', async () => {
    const srcDir = createSkillSource('my-skill');

    // Create a test runtime config
    const configDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        runtimes: [{ name: 'testrt', path: `~/.testrt/skills` }],
      }),
    );

    await runInstall(srcDir, {});

    // Check the skill was copied
    const centralDir = getCentralSkillsPath();
    const destPath = path.join(centralDir, 'my-skill');
    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.existsSync(path.join(destPath, 'SKILL.md'))).toBe(true);

    // Check symlink was created
    const runtimeSkillsDir = resolveHomePath('~/.testrt/skills');
    const symlinkPath = path.join(runtimeSkillsDir, 'my-skill');
    expect(isSymlink(symlinkPath)).toBe(true);

    // Check registry
    const registry = loadRegistry();
    expect(registry.skills['my-skill']).toBeDefined();
    expect(registry.skills['my-skill'].runtimes).toContain('testrt');
  });

  it('should install to a specific runtime only', async () => {
    const srcDir = createSkillSource('my-skill');

    const configDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        runtimes: [
          { name: 'rt-a', path: `~/.rt-a/skills` },
          { name: 'rt-b', path: `~/.rt-b/skills` },
        ],
      }),
    );

    await runInstall(srcDir, { runtime: 'rt-a' });

    // Check the skill was copied
    const centralDir = getCentralSkillsPath();
    const destPath = path.join(centralDir, 'my-skill');
    expect(fs.existsSync(destPath)).toBe(true);

    // Check only rt-a has the symlink
    const symlinkA = path.join(resolveHomePath('~/.rt-a/skills'), 'my-skill');
    const symlinkB = path.join(resolveHomePath('~/.rt-b/skills'), 'my-skill');
    expect(isSymlink(symlinkA)).toBe(true);
    expect(fs.existsSync(symlinkB) || isSymlink(symlinkB)).toBe(false);

    // Check registry only has rt-a
    const registry = loadRegistry();
    expect(registry.skills['my-skill'].runtimes).toEqual(['rt-a']);
  });

  it('should error if source path does not exist', async () => {
    const nonExistent = path.join(tmpDir, 'nonexistent');
    await runInstall(nonExistent, {});
    // Should not throw — command handles errors gracefully
  });

  it('should error if source directory has no SKILL.md', async () => {
    const dirWithoutSkill = path.join(tmpDir, 'no-skill');
    fs.mkdirSync(dirWithoutSkill, { recursive: true });
    fs.writeFileSync(path.join(dirWithoutSkill, 'README.md'), 'just a readme');

    await runInstall(dirWithoutSkill, {});

    // Skill should NOT have been installed
    const centralDir = getCentralSkillsPath();
    expect(fs.existsSync(path.join(centralDir, 'no-skill'))).toBe(false);
  });

  it('should error if source path is a file not a directory', async () => {
    const filePath = path.join(tmpDir, 'some-file.txt');
    fs.writeFileSync(filePath, 'not a directory');

    await runInstall(filePath, {});

    // Skill should NOT have been installed
    const centralDir = getCentralSkillsPath();
    expect(fs.existsSync(path.join(centralDir, 'some-file.txt'))).toBe(false);
  });

  it('should report error for unknown runtime and clean up', async () => {
    const srcDir = createSkillSource('my-skill');

    const configDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        runtimes: [{ name: 'testrt', path: `~/.testrt/skills` }],
      }),
    );

    await runInstall(srcDir, { runtime: 'nonexistent' });

    // Skill should NOT be installed (cleaned up after failed install)
    const centralDir = getCentralSkillsPath();
    const destPath = path.join(centralDir, 'my-skill');
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('should create runtime skills dir if it does not exist', async () => {
    const srcDir = createSkillSource('my-skill');

    const configDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        runtimes: [{ name: 'newrt', path: `~/.newrt/skills` }],
      }),
    );

    // Ensure the runtime skills dir does NOT exist initially
    const runtimeSkillsDir = resolveHomePath('~/.newrt/skills');
    if (fs.existsSync(runtimeSkillsDir)) {
      fs.rmSync(runtimeSkillsDir, { recursive: true, force: true });
    }

    await runInstall(srcDir, {});

    // It should have been created
    expect(fs.existsSync(runtimeSkillsDir)).toBe(true);
    const symlinkPath = path.join(runtimeSkillsDir, 'my-skill');
    expect(isSymlink(symlinkPath)).toBe(true);
  });

  it('should handle skills with dots in names', async () => {
    const srcDir = createSkillSource('my-skill.v2');

    const configDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        runtimes: [{ name: 'testrt', path: `~/.testrt/skills` }],
      }),
    );

    await runInstall(srcDir, {});

    const centralDir = getCentralSkillsPath();
    expect(fs.existsSync(path.join(centralDir, 'my-skill.v2'))).toBe(true);
    expect(fs.existsSync(path.join(centralDir, 'my-skill.v2', 'SKILL.md'))).toBe(true);
  });

  it('should install to default runtimes when no config is present', async () => {
    const srcDir = createSkillSource('my-cool-skill');

    await runInstall(srcDir, {});

    const centralDir = getCentralSkillsPath();
    expect(fs.existsSync(path.join(centralDir, 'my-cool-skill'))).toBe(true);

    // Should be in registry
    const registry = loadRegistry();
    expect(registry.skills['my-cool-skill']).toBeDefined();
    const entry = registry.skills['my-cool-skill'];
    expect(entry.installedAt).toBeDefined();
    // At least some default runtimes should have succeeded (they get created in tmpDir)
    expect(entry.runtimes.length).toBeGreaterThan(0);
  });

  it('should install multiple skills independently', async () => {
    const srcDir1 = createSkillSource('skill-a');
    const srcDir2 = createSkillSource('skill-b');

    const configDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        runtimes: [{ name: 'testrt', path: `~/.testrt/skills` }],
      }),
    );

    await runInstall(srcDir1, {});
    await runInstall(srcDir2, {});

    const centralDir = getCentralSkillsPath();
    expect(fs.existsSync(path.join(centralDir, 'skill-a', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(centralDir, 'skill-b', 'SKILL.md'))).toBe(true);

    const runtimeSkillsDir = resolveHomePath('~/.testrt/skills');
    expect(isSymlink(path.join(runtimeSkillsDir, 'skill-a'))).toBe(true);
    expect(isSymlink(path.join(runtimeSkillsDir, 'skill-b'))).toBe(true);

    const registry = loadRegistry();
    expect(registry.skills['skill-a']).toBeDefined();
    expect(registry.skills['skill-b']).toBeDefined();
  });
});
