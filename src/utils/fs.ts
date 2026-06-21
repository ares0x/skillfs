import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Resolves a path string, expanding the home directory symbol '~' to the user's home directory.
 */
export function resolveHomePath(pathStr: string): string {
  if (pathStr.startsWith('~')) {
    const home = process.env.SKILLFS_HOME_OVERRIDE || os.homedir();
    return path.join(home, pathStr.slice(1));
  }
  return path.resolve(pathStr);
}

/**
 * Validates that a resolved absolute path stays within a given scope directory.
 * Returns true if the path is within scope, false otherwise.
 * Both path and scope must be absolute and normalized.
 */
export function validatePathInScope(targetPath: string, scope: string): boolean {
  const normalizedTarget = path.normalize(targetPath) + path.sep;
  const normalizedScope = path.normalize(scope) + path.sep;
  return normalizedTarget.startsWith(normalizedScope);
}

/**
 * Resolves a path string (expanding ~) and validates that the resolved path
 * stays within the given scope. Throws if the path escapes the scope via ../ traversal.
 *
 * @param pathStr - The path string, may start with ~
 * @param scope - The absolute directory that the resolved path must stay within
 * @throws Error if the resolved path escapes the scope
 */
export function resolveHomePathSafe(pathStr: string, scope: string): string {
  const resolved = resolveHomePath(pathStr);
  if (!validatePathInScope(resolved, scope)) {
    throw new Error(
      `Path traversal detected: "${pathStr}" resolves to "${resolved}" ` +
      `which is outside the allowed scope "${scope}"`
    );
  }
  return resolved;
}

/**
 * Ensures that a directory exists, recursively creating it if necessary.
 */
export function ensureDirExists(dirPath: string): void {
  const resolved = resolveHomePath(dirPath);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
}

/**
 * Checks if a given path is a symbolic link.
 */
export function isSymlink(filePath: string): boolean {
  const resolved = resolveHomePath(filePath);
  try {
    const stats = fs.lstatSync(resolved);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Gets the target path that a symbolic link points to.
 * Returns undefined if the path is not a symlink or doesn't exist.
 */
export function getSymlinkTarget(filePath: string): string | undefined {
  const resolved = resolveHomePath(filePath);
  try {
    if (isSymlink(resolved)) {
      const target = fs.readlinkSync(resolved);
      // Resolve relative targets against the symlink's parent directory
      // so callers always get an absolute path regardless of how the symlink was created.
      if (path.isAbsolute(target)) return target;
      return path.resolve(path.dirname(resolved), target);
    }
  } catch {
    // Ignore error
  }
  return undefined;
}

/**
 * Safely creates a symlink at linkPath pointing to target.
 * Uses fs.symlinkSync directly with EEXIST handling to avoid TOCTOU race condition.
 * Optionally validates that the resolved target stays within the given scope.
 *
 * @param target - The symlink target path
 * @param linkPath - Where to create the symlink
 * @param targetScope - Optional scope that the target must stay within; if provided
 *   and the target is outside scope, throws an error
 */
export function safeCreateSymlink(target: string, linkPath: string, targetScope?: string): void {
  const resolvedLinkPath = resolveHomePath(linkPath);
  const resolvedTarget = resolveHomePath(target);

  // Validate target is within scope if a scope is provided
  if (targetScope !== undefined) {
    const resolvedScope = resolveHomePath(targetScope);
    if (!validatePathInScope(resolvedTarget, resolvedScope)) {
      throw new Error(
        `Symlink target validation failed: "${resolvedTarget}" is outside ` +
        `the allowed scope "${resolvedScope}"`
      );
    }
  }

  // Ensure parent directory of link path exists
  ensureDirExists(path.dirname(resolvedLinkPath));

  // Compute a relative symlink target so the link survives home-directory
  // renames and machine migrations. Falls back to absolute if relative computation
  // fails (e.g. different filesystems).
  const symlinkTarget =
    path.relative(path.dirname(resolvedLinkPath), resolvedTarget) || resolvedTarget;

  // Try symlinkSync directly; handle EEXIST by removing and retrying.
  // This avoids the TOCTOU window between existsSync/rmSync/symlinkSync.
  try {
    fs.symlinkSync(symlinkTarget, resolvedLinkPath);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EEXIST') {
      // Something exists at the link path — remove and retry
      fs.rmSync(resolvedLinkPath, { recursive: true, force: true });
      fs.symlinkSync(symlinkTarget, resolvedLinkPath);
    } else {
      throw err;
    }
  }
}

/**
 * Recursively copies a directory from src to dest.
 */
export function copyDirectory(src: string, dest: string): void {
  const resolvedSrc = resolveHomePath(src);
  const resolvedDest = resolveHomePath(dest);

  ensureDirExists(path.dirname(resolvedDest));
  fs.cpSync(resolvedSrc, resolvedDest, { recursive: true });
}

/**
 * Recursively deletes a directory or file.
 */
export function removeDirectory(dirPath: string): void {
  const resolved = resolveHomePath(dirPath);
  if (fs.existsSync(resolved) || isSymlink(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
