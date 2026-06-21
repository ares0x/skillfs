import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { acquireLock } from '../../src/utils/lock.js';

describe('acquireLock (atomic O_CREAT|O_EXCL)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-lock-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should create a lock file atomically with current PID', () => {
    const lockPath = path.join(tmpDir, '.test.lock');
    const release = acquireLock(lockPath);

    // Lock file should exist with our PID
    expect(fs.existsSync(lockPath)).toBe(true);
    const content = fs.readFileSync(lockPath, 'utf8').trim();
    expect(content).toBe(String(process.pid));

    // Release should clean up
    release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('should throw when lock is held by a live process', () => {
    const lockPath = path.join(tmpDir, '.test.lock');
    // Our own PID is definitely alive
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');

    expect(() => acquireLock(lockPath)).toThrow(/another skillfs process/i);

    // Clean up
    fs.unlinkSync(lockPath);
  });

  it('should clean up a stale lock from a dead PID', () => {
    const lockPath = path.join(tmpDir, '.test.lock');
    // Use a very high PID that almost certainly doesn't exist
    fs.writeFileSync(lockPath, '99999', 'utf8');

    // Should acquire without throwing
    const release = acquireLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8').trim()).toBe(String(process.pid));

    release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('should handle lock file with invalid content (non-numeric PID)', () => {
    const lockPath = path.join(tmpDir, '.test.lock');
    fs.writeFileSync(lockPath, 'not-a-pid', 'utf8');

    // Should clean up the invalid lock and acquire
    const release = acquireLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8').trim()).toBe(String(process.pid));

    release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('should handle empty lock file', () => {
    const lockPath = path.join(tmpDir, '.test.lock');
    fs.writeFileSync(lockPath, '', 'utf8');

    // NaN PID is not alive, should clean up and acquire
    const release = acquireLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8').trim()).toBe(String(process.pid));

    release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('should release lock only if we own it', () => {
    const lockPath = path.join(tmpDir, '.test.lock');
    const release = acquireLock(lockPath);

    // Simulate another process taking over the lock
    fs.writeFileSync(lockPath, '1', 'utf8');

    // Release should be a no-op since PID no longer matches
    release();

    // The lock file should still exist with PID 1
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8').trim()).toBe('1');

    // Clean up
    fs.unlinkSync(lockPath);
  });

  it('should create parent directories if needed (via the caller)', () => {
    // acquireLock does NOT create directories; the caller must ensure them.
    // Test that it fails gracefully with a non-existent directory path.
    const lockPath = path.join(tmpDir, 'nonexistent-dir', '.test.lock');
    expect(() => acquireLock(lockPath)).toThrow();
  });

  it('should handle concurrent lock acquisition (sequential in same process)', () => {
    const lockPath = path.join(tmpDir, '.test.lock');

    // First acquisition
    const release1 = acquireLock(lockPath);
    expect(fs.readFileSync(lockPath, 'utf8').trim()).toBe(String(process.pid));

    // Release and re-acquire (sequential re-entry)
    release1();
    expect(fs.existsSync(lockPath)).toBe(false);

    const release2 = acquireLock(lockPath);
    expect(fs.readFileSync(lockPath, 'utf8').trim()).toBe(String(process.pid));
    release2();
  });

  it('should not leak file descriptors', () => {
    // Repeated acquire/release cycles should not fail
    const lockPath = path.join(tmpDir, '.test.lock');
    for (let i = 0; i < 10; i++) {
      const release = acquireLock(lockPath);
      release();
    }
    // If we got here without EMFILE or leaks, we're fine
  });
});
