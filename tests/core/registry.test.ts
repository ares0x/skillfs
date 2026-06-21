import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { 
  loadRegistry, 
  saveRegistry, 
  registerSkillRuntime, 
  deregisterSkillRuntime, 
  syncSkillRuntimes,
  getRegistryPath,
  lockRegistry,
  RegistrySchema
} from '../../src/core/registry.js';
import { ensureDirExists } from '../../src/utils/fs.js';

describe('getRegistryPath', () => {
  it('should return path under ~/.skills', () => {
    const result = getRegistryPath();
    expect(result).toBe(path.join(os.homedir(), '.skills', 'registry.json'));
  });
});

describe('loadRegistry', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-reg-'));
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

  it('should return default schema when registry does not exist', () => {
    const registry = loadRegistry();
    expect(registry.version).toBe('1');
    expect(registry.skills).toEqual({});
  });

  it('should load an existing registry', () => {
    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const data: RegistrySchema = {
      version: '1',
      skills: {
        'pdf': {
          installedAt: '2024-01-01T00:00:00.000Z',
          source: 'local',
          runtimes: ['claude', 'agent']
        }
      }
    };
    fs.writeFileSync(path.join(skillsDir, 'registry.json'), JSON.stringify(data, null, 2));

    const registry = loadRegistry();
    expect(registry.version).toBe('1');
    expect(registry.skills['pdf']).toBeDefined();
    expect(registry.skills['pdf'].runtimes).toEqual(['claude', 'agent']);
  });

  it('should return default for invalid JSON', () => {
    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'registry.json'), '{invalid}');

    const registry = loadRegistry();
    expect(registry.version).toBe('1');
    expect(registry.skills).toEqual({});
  });

  it('should return default for wrong version', () => {
    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'registry.json'), JSON.stringify({ version: '2', skills: {} }));

    const registry = loadRegistry();
    expect(registry.version).toBe('1');
  });
});

describe('saveRegistry', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-reg-'));
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

  it('should save registry and create directory', () => {
    const registry: RegistrySchema = {
      version: '1',
      skills: {
        'test-skill': {
          installedAt: '2024-01-01T00:00:00.000Z',
          source: 'local',
          runtimes: ['claude']
        }
      }
    };

    saveRegistry(registry);

    const filePath = path.join(tmpDir, '.skills', 'registry.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(content.version).toBe('1');
    expect(content.skills['test-skill'].runtimes).toEqual(['claude']);
  });

  it('should overwrite existing registry', () => {
    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'registry.json'), JSON.stringify({ version: '1', skills: { old: {} } }));

    const registry: RegistrySchema = {
      version: '1',
      skills: {
        'new-skill': {
          installedAt: '2024-01-01T00:00:00.000Z',
          source: 'local',
          runtimes: ['agent']
        }
      }
    };
    saveRegistry(registry);

    const content = JSON.parse(fs.readFileSync(path.join(skillsDir, 'registry.json'), 'utf8'));
    expect(content.skills['new-skill']).toBeDefined();
    expect(content.skills['old']).toBeUndefined();
  });
});

describe('registerSkillRuntime', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-reg-'));
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

  it('should register a new skill with runtime', () => {
    registerSkillRuntime('new-skill', 'claude');

    const registry = loadRegistry();
    expect(registry.skills['new-skill']).toBeDefined();
    expect(registry.skills['new-skill'].runtimes).toContain('claude');
    expect(registry.skills['new-skill'].source).toBe('local');
  });

  it('should add runtime to existing skill', () => {
    registerSkillRuntime('pdf', 'claude');
    registerSkillRuntime('pdf', 'agent');

    const registry = loadRegistry();
    expect(registry.skills['pdf'].runtimes).toContain('claude');
    expect(registry.skills['pdf'].runtimes).toContain('agent');
  });

  it('should not duplicate runtimes', () => {
    registerSkillRuntime('pdf', 'claude');
    registerSkillRuntime('pdf', 'claude');

    const registry = loadRegistry();
    expect(registry.skills['pdf'].runtimes).toEqual(['claude']);
  });
});

describe('deregisterSkillRuntime', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-reg-'));
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

  it('should remove runtime from skill', () => {
    registerSkillRuntime('pdf', 'claude');
    registerSkillRuntime('pdf', 'agent');
    deregisterSkillRuntime('pdf', 'claude');

    const registry = loadRegistry();
    expect(registry.skills['pdf'].runtimes).toEqual(['agent']);
  });

  it('should delete skill entry when no runtimes remain', () => {
    registerSkillRuntime('pdf', 'claude');
    deregisterSkillRuntime('pdf', 'claude');

    const registry = loadRegistry();
    expect(registry.skills['pdf']).toBeUndefined();
  });

  it('should not throw for non-existent skill', () => {
    expect(() => deregisterSkillRuntime('nonexistent', 'claude')).not.toThrow();
  });
});

describe('syncSkillRuntimes', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-reg-'));
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

  it('should set runtimes for a new skill', () => {
    syncSkillRuntimes('pdf', ['claude', 'agent']);

    const registry = loadRegistry();
    expect(registry.skills['pdf'].runtimes).toEqual(['claude', 'agent']);
  });

  it('should replace runtimes for an existing skill', () => {
    registerSkillRuntime('pdf', 'claude');
    syncSkillRuntimes('pdf', ['agent', 'clawdbot']);

    const registry = loadRegistry();
    expect(registry.skills['pdf'].runtimes).toEqual(['agent', 'clawdbot']);
  });

  it('should de-duplicate runtime list', () => {
    syncSkillRuntimes('pdf', ['claude', 'claude', 'agent']);

    const registry = loadRegistry();
    expect(registry.skills['pdf'].runtimes).toEqual(['claude', 'agent']);
  });
});

describe('lockRegistry', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-reg-'));
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

  it('should acquire and release lock', () => {
    const release = lockRegistry();
    const lockPath = path.join(tmpDir, '.skills', '.registry.lock');
    
    // Lock file should exist
    expect(fs.existsSync(lockPath)).toBe(true);
    const content = fs.readFileSync(lockPath, 'utf8').trim();
    expect(content).toBe(String(process.pid));

    // Release
    release();

    // Lock file should be gone
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('should throw when lock is held by another process', () => {
    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const lockPath = path.join(skillsDir, '.registry.lock');
    // Simulate a lock held by PID 1 (should be alive on most systems)
    fs.writeFileSync(lockPath, '1', 'utf8');

    expect(() => lockRegistry()).toThrow(/another skillfs process/i);

    // Clean up the fake lock
    fs.unlinkSync(lockPath);
  });

  it('should clean up stale lock from dead PID', () => {
    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const lockPath = path.join(skillsDir, '.registry.lock');
    // Use a very high PID that almost certainly doesn't exist
    fs.writeFileSync(lockPath, '99999', 'utf8');

    // Should acquire lock without throwing
    const release = lockRegistry();
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8').trim()).toBe(String(process.pid));

    release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
