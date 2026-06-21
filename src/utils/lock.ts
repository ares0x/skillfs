import * as fs from 'fs';

const MAX_RETRIES = 3;

/**
 * Acquires a PID-based file lock using atomic O_CREAT|O_EXCL.
 * Returns a release function.
 *
 * Uses fs.openSync(lockPath, 'wx') for atomic create-or-fail semantics,
 * eliminating the TOCTOU window between existsSync and writeFileSync.
 *
 * - If lock creation fails with EEXIST, reads the existing lock's PID.
 * - If that PID is alive, throws an error (lock is legitimately held).
 * - If that PID is dead, cleans up the stale lock and retries.
 * - Always release the lock in a try/finally block.
 */
export function acquireLock(lockPath: string): () => void {
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    let fd: number | undefined;
    try {
      // Atomic create-or-fail: O_WRONLY | O_CREAT | O_EXCL
      fd = fs.openSync(lockPath, 'wx');
      // Write current PID to the lock file
      fs.writeFileSync(fd, String(process.pid), 'utf8');
      fs.closeSync(fd);

      // Return the release function
      return () => releaseLock(lockPath);
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;

      if (nodeErr.code === 'EEXIST') {
        // Lock file already exists — check if the owner is alive
        attempts++;
        const content = fs.readFileSync(lockPath, 'utf8').trim();
        const existingPid = parseInt(content, 10);

        if (!isNaN(existingPid) && isProcessAlive(existingPid)) {
          throw new Error(
            `Another skillfs process (PID ${existingPid}) is currently running. ` +
            `If no other process is running, delete the lock file manually: ${lockPath}`
          );
        }

        // PID is dead — clean up the stale lock and retry
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // If we can't remove it, another process may have just done so
          // or the lock was cleared between our read and unlink. Retry.
        }
        // Loop back to retry the atomic open
        continue;
      }

      // Some other error — rethrow
      throw err;
    }
  }

  // Should not reach here unless we exhausted retries
  throw new Error(
    `Failed to acquire lock after ${MAX_RETRIES} attempts: ${lockPath}. ` +
    `This may indicate a persistent lock contention. ` +
    `Delete the lock file manually if no other process is running.`
  );
}

/**
 * Releases a lock file if we own it.
 */
function releaseLock(lockPath: string): void {
  try {
    if (fs.existsSync(lockPath)) {
      const content = fs.readFileSync(lockPath, 'utf8').trim();
      const lockPid = parseInt(content, 10);
      // Only release if we still own the lock
      if (lockPid === process.pid) {
        fs.unlinkSync(lockPath);
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Checks whether a process with the given PID is currently running.
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 is a special "null signal" that only checks if the process exists
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // ESRCH = no such process → definitely dead
    // EPERM = process exists but we don't have permission to signal it
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EPERM') {
      return true;
    }
    return false;
  }
}
