import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getRuntimeConfigs, getCentralSkillsPath, DEFAULT_RUNTIMES } from '../../src/core/config.js';

describe('getCentralSkillsPath', () => {
  it('should return ~/.skills resolved to home', () => {
    const result = getCentralSkillsPath();
    expect(result).toBe(path.join(os.homedir(), '.skills'));
  });

  it('should respect SKILLFS_HOME_OVERRIDE', () => {
    process.env.SKILLFS_HOME_OVERRIDE = '/custom/home';
    try {
      const result = getCentralSkillsPath();
      expect(result).toBe('/custom/home/.skills');
    } finally {
      delete process.env.SKILLFS_HOME_OVERRIDE;
    }
  });
});

describe('getRuntimeConfigs', () => {
  let originalHomeOverride: string | undefined;

  beforeEach(() => {
    originalHomeOverride = process.env.SKILLFS_HOME_OVERRIDE;
  });

  afterEach(() => {
    if (originalHomeOverride) {
      process.env.SKILLFS_HOME_OVERRIDE = originalHomeOverride;
    } else {
      delete process.env.SKILLFS_HOME_OVERRIDE;
    }
  });

  it('should return default runtimes when no config exists', () => {
    // Point HOME_OVERRIDE to a temp dir with no config
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-config-'));
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
    try {
      const configs = getRuntimeConfigs();
      expect(configs).toHaveLength(DEFAULT_RUNTIMES.length);
      expect(configs[0].name).toBe('claude');
      expect(configs[1].name).toBe('agents');
      expect(configs[2].name).toBe('clawdbot');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should append custom runtimes from config.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-config-'));
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;

    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const configPath = path.join(skillsDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      runtimes: [
        { name: 'custom-rt', path: '~/custom/skills' }
      ]
    }));

    try {
      const configs = getRuntimeConfigs();
      expect(configs).toHaveLength(DEFAULT_RUNTIMES.length + 1);
      const custom = configs.find(r => r.name === 'custom-rt');
      expect(custom).toBeDefined();
      expect(custom!.path).toBe('~/custom/skills');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should override default runtime if name matches', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-config-'));
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;

    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const configPath = path.join(skillsDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      runtimes: [
        { name: 'claude', path: '~/custom-claude/skills' }
      ]
    }));

    try {
      const configs = getRuntimeConfigs();
      const claude = configs.find(r => r.name === 'claude');
      expect(claude).toBeDefined();
      expect(claude!.path).toBe('~/custom-claude/skills');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should handle malformed config.json gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-config-'));
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;

    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const configPath = path.join(skillsDir, 'config.json');
    fs.writeFileSync(configPath, '{ not valid json }');

    try {
      const configs = getRuntimeConfigs();
      // Should fall back to defaults
      expect(configs).toHaveLength(DEFAULT_RUNTIMES.length);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should handle config without runtimes array', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-config-'));
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;

    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const configPath = path.join(skillsDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ version: '1' }));

    try {
      const configs = getRuntimeConfigs();
      expect(configs).toHaveLength(DEFAULT_RUNTIMES.length);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
