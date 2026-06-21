import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { isSymlink, getSymlinkTarget, resolveHomePath, validatePathInScope } from '../utils/fs.js';

/**
 * Computes the MD5 hash of a file's contents.
 * Returns empty string if the file cannot be read.
 */
export function hashFile(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return createHash('md5').update(content).digest('hex');
  } catch {
    return '';
  }
}

export interface Skill {
  name: string;          // Directory name, e.g. "pdf"
  path: string;          // Absolute path
  runtime: string;       // "claude" | "agent" | "clawdbot" | "skills"
  description: string;   // Extracted from SKILL.md
  hash: string;          // MD5 hash of SKILL.md contents to check version similarity
  isSymlink: boolean;
  symlinkTarget?: string;
}

/**
 * Parses description from SKILL.md content, checking YAML frontmatter first, then body text.
 */
export function parseDescription(content: string): string {
  // Try to parse description from frontmatter
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatterMatch) {
    const yaml = frontmatterMatch[1];
    const descMatch = yaml.match(/^description:\s*(.+)$/m);
    if (descMatch) {
      return descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  // Fallback: strip frontmatter and find the first non-empty, non-header line
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
  const lines = body.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('```'));
  
  if (lines.length > 0) {
    return lines[0];
  }
  
  return '';
}

/**
 * Parses a skill directory and constructs a Skill object.
 * Returns null if the path does not exist or isn't a directory.
 *
 * When encountering a symlink directory, validates that the symlink target
 * is within the home directory scope. If the symlink target escapes scope,
 * logs a warning and returns null (skipping the skill).
 */
export function parseSkill(dirPath: string, runtime: string): Skill | null {
  const absolutePath = resolveHomePath(dirPath);

  try {
    if (!fs.existsSync(absolutePath) && !isSymlink(absolutePath)) {
      return null;
    }

    const stats = fs.lstatSync(absolutePath);
    if (!stats.isDirectory() && !stats.isSymbolicLink()) {
      return null;
    }

    const name = path.basename(absolutePath);
    const symlink = isSymlink(absolutePath);
    const symlinkTarget = symlink ? getSymlinkTarget(absolutePath) : undefined;

    // Validate symlink target: ensure it stays within the home directory scope.
    // Symlinks pointing outside home (e.g., to /etc or /tmp/evil) are rejected
    // to prevent reading arbitrary system files disguised as skills.
    if (symlink && symlinkTarget) {
      const homeScope = process.env.SKILLFS_HOME_OVERRIDE || os.homedir();
      const resolvedTarget = resolveHomePath(symlinkTarget);
      if (!validatePathInScope(resolvedTarget, homeScope)) {
        console.warn(
          `⚠ Symlink target for "${name}" escapes home directory scope: ` +
          `${symlinkTarget} → ${resolvedTarget}. Skipping this skill.`
        );
        return null;
      }
    }

    // Resolve SKILL.md path. Note that fs.readFileSync resolves symlinks automatically.
    const skillMdPath = path.join(absolutePath, 'SKILL.md');
    let description = '';
    let hash = '';

    if (fs.existsSync(skillMdPath)) {
      try {
        const content = fs.readFileSync(skillMdPath, 'utf8');
        description = parseDescription(content);
        hash = createHash('md5').update(content).digest('hex');
      } catch (err) {
        description = '(Unreadable SKILL.md)';
      }
    } else {
      description = '(No SKILL.md)';
    }

    return {
      name,
      path: absolutePath,
      runtime,
      description,
      hash,
      isSymlink: symlink,
      symlinkTarget,
    };
  } catch (err) {
    return null;
  }
}
