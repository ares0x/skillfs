import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { 
  resolveHomePath, 
  resolveHomePathSafe,
  validatePathInScope,
  ensureDirExists, 
  isSymlink, 
  getSymlinkTarget, 
  safeCreateSymlink, 
  copyDirectory, 
  removeDirectory 
} from '../../src/utils/fs.js';

describe('resolveHomePath', () => {
  it('should resolve ~ to home directory', () => {
    const result = resolveHomePath('~/test');
    expect(result).toBe(path.join(os.homedir(), 'test'));
  });

  it('should resolve absolute path as-is', () => {
    const result = resolveHomePath('/tmp/test');
    expect(result).toBe('/tmp/test');
  });

  it('should resolve relative path', () => {
    const result = resolveHomePath('foo/bar');
    expect(result).toBe(path.resolve('foo/bar'));
  });

  it('should respect SKILLFS_HOME_OVERRIDE', () => {
    process.env.SKILLFS_HOME_OVERRIDE = '/custom/home';
    try {
      const result = resolveHomePath('~/test');
      expect(result).toBe('/custom/home/test');
    } finally {
      delete process.env.SKILLFS_HOME_OVERRIDE;
    }
  });
});

describe('ensureDirExists', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should create a directory that does not exist', () => {
    const newDir = path.join(tmpDir, 'new-dir');
    ensureDirExists(newDir);
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.statSync(newDir).isDirectory()).toBe(true);
  });

  it('should create nested directories recursively', () => {
    const newDir = path.join(tmpDir, 'a', 'b', 'c');
    ensureDirExists(newDir);
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.statSync(newDir).isDirectory()).toBe(true);
  });

  it('should not throw if directory already exists', () => {
    ensureDirExists(tmpDir);
    expect(() => ensureDirExists(tmpDir)).not.toThrow();
  });

  it('should handle ~ paths', () => {
    // We can't really create dirs in home in tests, so test with SKILLFS_HOME_OVERRIDE
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
    try {
      ensureDirExists('~/test-dir');
      expect(fs.existsSync(path.join(tmpDir, 'test-dir'))).toBe(true);
    } finally {
      delete process.env.SKILLFS_HOME_OVERRIDE;
    }
  });
});

describe('isSymlink', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return false for a regular file', () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello');
    expect(isSymlink(filePath)).toBe(false);
  });

  it('should return false for a regular directory', () => {
    const dirPath = path.join(tmpDir, 'test-dir');
    fs.mkdirSync(dirPath);
    expect(isSymlink(dirPath)).toBe(false);
  });

  it('should return true for a symlink', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.writeFileSync(target, 'hello');
    fs.symlinkSync(target, link);
    expect(isSymlink(link)).toBe(true);
  });

  it('should return false for a non-existent path', () => {
    expect(isSymlink(path.join(tmpDir, 'nonexistent'))).toBe(false);
  });
});

describe('getSymlinkTarget', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return the target of a symlink', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.writeFileSync(target, 'hello');
    fs.symlinkSync(target, link);
    expect(getSymlinkTarget(link)).toBe(target);
  });

  it('should return undefined for a regular file', () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello');
    expect(getSymlinkTarget(filePath)).toBeUndefined();
  });

  it('should return undefined for a non-existent path', () => {
    expect(getSymlinkTarget(path.join(tmpDir, 'nonexistent'))).toBeUndefined();
  });
});

describe('safeCreateSymlink', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should create a symlink', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.writeFileSync(target, 'hello');
    safeCreateSymlink(target, link);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(path.relative(path.dirname(link), target));
  });

  it('should overwrite an existing file', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.writeFileSync(target, 'hello');
    fs.writeFileSync(link, 'old content');
    safeCreateSymlink(target, link);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(path.relative(path.dirname(link), target));
  });

  it('should overwrite an existing directory', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.writeFileSync(target, 'hello');
    fs.mkdirSync(link);
    fs.writeFileSync(path.join(link, 'file.txt'), 'inside');
    safeCreateSymlink(target, link);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(path.relative(path.dirname(link), target));
  });

  it('should create parent directories if needed', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'deep', 'nested', 'link');
    fs.writeFileSync(target, 'hello');
    safeCreateSymlink(target, link);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('should overwrite an existing symlink', () => {
    const target = path.join(tmpDir, 'target');
    const oldTarget = path.join(tmpDir, 'old-target');
    const link = path.join(tmpDir, 'link');
    fs.writeFileSync(target, 'hello');
    fs.writeFileSync(oldTarget, 'old');
    fs.symlinkSync(oldTarget, link);
    safeCreateSymlink(target, link);
    expect(fs.readlinkSync(link)).toBe(path.relative(path.dirname(link), target));
  });
});

describe('copyDirectory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should copy a directory recursively', () => {
    const src = path.join(tmpDir, 'src');
    const dest = path.join(tmpDir, 'dest');
    fs.mkdirSync(src);
    fs.mkdirSync(path.join(src, 'sub'));
    fs.writeFileSync(path.join(src, 'a.txt'), 'file a');
    fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'file b');

    copyDirectory(src, dest);

    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('file a');
    expect(fs.readFileSync(path.join(dest, 'sub', 'b.txt'), 'utf8')).toBe('file b');
  });

  it('should overwrite existing destination', () => {
    const src = path.join(tmpDir, 'src');
    const dest = path.join(tmpDir, 'dest');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'file.txt'), 'new');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'file.txt'), 'old');

    copyDirectory(src, dest);

    expect(fs.readFileSync(path.join(dest, 'file.txt'), 'utf8')).toBe('new');
  });
});

describe('removeDirectory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should remove a directory', () => {
    const dirPath = path.join(tmpDir, 'dir');
    fs.mkdirSync(dirPath);
    removeDirectory(dirPath);
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  it('should remove a directory with contents', () => {
    const dirPath = path.join(tmpDir, 'dir');
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, 'file.txt'), 'hello');
    fs.mkdirSync(path.join(dirPath, 'sub'));
    removeDirectory(dirPath);
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  it('should remove a file', () => {
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'hello');
    removeDirectory(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('should remove a symlink without following it', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'file.txt'), 'inside');
    fs.symlinkSync(target, link);

    removeDirectory(link);
    expect(fs.existsSync(link)).toBe(false);
    // Target should still exist
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(path.join(target, 'file.txt'), 'utf8')).toBe('inside');
  });

  it('should not throw on non-existent path', () => {
    expect(() => removeDirectory(path.join(tmpDir, 'nonexistent'))).not.toThrow();
  });
});

describe('validatePathInScope', () => {
  it('should return true when path is within scope', () => {
    expect(validatePathInScope('/home/user/projects/myapp', '/home/user')).toBe(true);
    expect(validatePathInScope('/home/user/projects/myapp/sub', '/home/user')).toBe(true);
    expect(validatePathInScope('/home/user', '/home/user')).toBe(true);
  });

  it('should return false when path escapes scope via ../', () => {
    expect(validatePathInScope('/etc/passwd', '/home/user')).toBe(false);
    expect(validatePathInScope('/home/otheruser/file', '/home/user')).toBe(false);
    expect(validatePathInScope('/tmp/evil', '/home/user')).toBe(false);
  });

  it('should detect prefix-based traversal (e.g. /home/user2 not within /home/user)', () => {
    expect(validatePathInScope('/home/user2/file', '/home/user')).toBe(false);
  });

  it('should work with temp directories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-vps-'));
    try {
      const scope = tmpDir;
      const inside = path.join(tmpDir, 'subdir', 'file');
      const outside = path.join(os.tmpdir(), 'other-dir', 'file');

      expect(validatePathInScope(inside, scope)).toBe(true);
      expect(validatePathInScope(outside, scope)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should normalize paths before comparison', () => {
    expect(validatePathInScope(
      '/home/user/projects/../projects/myapp',
      '/home/user'
    )).toBe(true);

    expect(validatePathInScope(
      '/home/user/projects/../../etc/passwd',
      '/home/user'
    )).toBe(false);

    expect(validatePathInScope(
      '/home/user/projects/./myapp',
      '/home/user'
    )).toBe(true);
  });
});

describe('resolveHomePathSafe', () => {
  it('should resolve ~ and validate within home scope', () => {
    const homeScope = os.homedir();
    const result = resolveHomePathSafe('~/projects', homeScope);
    expect(result).toBe(path.join(os.homedir(), 'projects'));
    expect(validatePathInScope(result, homeScope)).toBe(true);
  });

  it('should throw for path outside scope using /etc', () => {
    const homeScope = os.homedir();
    // Absolute path to /etc — definitely outside home scope on all platforms
    expect(() => resolveHomePathSafe('/etc/passwd', homeScope)).toThrow(/Path traversal/);
  });

  it('should throw for absolute /tmp path outside scope', () => {
    const homeScope = os.homedir();
    // /tmp is outside home scope on macOS/Linux
    expect(() => resolveHomePathSafe('/tmp/evil', homeScope)).toThrow(/Path traversal/);
  });

  it('should work with SKILLFS_HOME_OVERRIDE scope', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-rhps-'));
    try {
      process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
      const result = resolveHomePathSafe('~/my-skills', tmpDir);
      expect(result).toBe(path.join(tmpDir, 'my-skills'));
      expect(validatePathInScope(result, tmpDir)).toBe(true);
    } finally {
      delete process.env.SKILLFS_HOME_OVERRIDE;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should reject ~ path that traverses outside via ../', () => {
    const homeScope = os.homedir();
    // ~/../../etc/passwd → resolves to /etc/passwd
    expect(() => resolveHomePathSafe('~/../../etc/passwd', homeScope))
      .toThrow(/Path traversal/);
  });

  it('should allow path equal to scope root', () => {
    const homeScope = os.homedir();
    const result = resolveHomePathSafe('~', homeScope);
    expect(result).toBe(os.homedir());
    expect(validatePathInScope(result, homeScope)).toBe(true);
  });
});

describe('safeCreateSymlink with scope validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-scs-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should allow creating symlink when target is within scope', () => {
    const scope = path.join(tmpDir, 'scope');
    const target = path.join(scope, 'target');
    const link = path.join(tmpDir, 'link');

    fs.mkdirSync(scope, { recursive: true });
    fs.writeFileSync(target, 'hello');

    safeCreateSymlink(target, link, scope);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(path.relative(path.dirname(link), target));
  });

  it('should throw when target is outside scope', () => {
    const scope = path.join(tmpDir, 'scope');
    const target = path.join(tmpDir, 'outside-scope', 'target');
    const link = path.join(tmpDir, 'link');

    fs.mkdirSync(path.join(tmpDir, 'outside-scope'), { recursive: true });
    fs.writeFileSync(target, 'evil');
    fs.mkdirSync(scope, { recursive: true });

    expect(() => safeCreateSymlink(target, link, scope))
      .toThrow(/Symlink target validation failed/);
  });

  it('should not validate scope when scope parameter is omitted', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.writeFileSync(target, 'hello');

    // Should succeed without scope validation
    safeCreateSymlink(target, link);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('should overwrite existing link with EEXIST-safe approach', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.writeFileSync(target, 'hello');

    // Create a pre-existing file at the link location
    fs.writeFileSync(link, 'old content');

    // Should overwrite without TOCTOU race
    safeCreateSymlink(target, link);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(path.relative(path.dirname(link), target));
  });
});
