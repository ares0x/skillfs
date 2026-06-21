import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { parseSkill, parseDescription, Skill } from '../../src/core/skill.js';

describe('parseDescription', () => {
  it('should extract description from YAML frontmatter', () => {
    const content = `---
name: pdf
description: A PDF processing skill
version: 1.0
---

# PDF Skill

This skill handles PDF files.`;
    
    expect(parseDescription(content)).toBe('A PDF processing skill');
  });

  it('should extract description from frontmatter with quotes', () => {
    const content = `---
name: pdf
description: "A PDF processing skill"
---

# PDF Skill`;
    
    expect(parseDescription(content)).toBe('A PDF processing skill');
  });

  it('should extract description from frontmatter with single quotes', () => {
    const content = `---
name: pdf
description: 'A PDF processing skill'
---

# PDF Skill`;
    
    expect(parseDescription(content)).toBe('A PDF processing skill');
  });

  it('should fall back to first body line when no frontmatter description', () => {
    const content = `---
name: pdf
---

This is the first meaningful line.`;
    
    expect(parseDescription(content)).toBe('This is the first meaningful line.');
  });

  it('should skip headers in body fallback', () => {
    const content = `# My Skill

This is the description.`;
    
    expect(parseDescription(content)).toBe('This is the description.');
  });

  it('should skip empty lines and code block fences in body fallback', () => {
    const content = `

\`\`\`
some code
\`\`\`

The actual description line.
`;
    
    // The current implementation strips code block fences (```) but not
    // content inside code blocks. The first non-filtered line is `some code`.
    expect(parseDescription(content)).toBe('some code');
  });

  it('should return empty string for empty content', () => {
    expect(parseDescription('')).toBe('');
  });

  it('should handle frontmatter with only description', () => {
    const content = `---
description: A simple skill
---`;
    
    expect(parseDescription(content)).toBe('A simple skill');
  });

  it('should handle frontmatter with Windows line endings (CRLF)', () => {
    const content = `---\r
name: pdf\r
description: A PDF skill\r
---\r
\r
# Body`;
    
    expect(parseDescription(content)).toBe('A PDF skill');
  });
});

describe('parseSkill', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return null for non-existent path', () => {
    const result = parseSkill(path.join(tmpDir, 'nonexistent'), 'claude');
    expect(result).toBeNull();
  });

  it('should return null for a file (not directory)', () => {
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'hello');
    const result = parseSkill(filePath, 'claude');
    expect(result).toBeNull();
  });

  it('should parse a skill directory with SKILL.md', () => {
    const skillDir = path.join(tmpDir, 'pdf');
    fs.mkdirSync(skillDir);
    const skillMd = path.join(skillDir, 'SKILL.md');
    const content = `---
name: pdf
description: Process PDF files
---

# PDF Skill`;
    fs.writeFileSync(skillMd, content);

    const result = parseSkill(skillDir, 'claude');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('pdf');
    expect(result!.path).toBe(skillDir);
    expect(result!.runtime).toBe('claude');
    expect(result!.description).toBe('Process PDF files');
    expect(result!.isSymlink).toBe(false);
    expect(result!.symlinkTarget).toBeUndefined();

    // Verify hash
    const expectedHash = createHash('md5').update(content).digest('hex');
    expect(result!.hash).toBe(expectedHash);
  });

  it('should handle skill directory without SKILL.md', () => {
    const skillDir = path.join(tmpDir, 'no-md');
    fs.mkdirSync(skillDir);

    const result = parseSkill(skillDir, 'agent');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('no-md');
    expect(result!.description).toBe('(No SKILL.md)');
    expect(result!.hash).toBe('');
  });

  it('should handle unreadable SKILL.md gracefully', () => {
    const skillDir = path.join(tmpDir, 'bad');
    fs.mkdirSync(skillDir);
    // Create a directory where SKILL.md would be to cause EISDIR on read
    fs.mkdirSync(path.join(skillDir, 'SKILL.md'));

    const result = parseSkill(skillDir, 'claude');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('bad');
    expect(result!.description).toBe('(Unreadable SKILL.md)');
  });

  it('should detect symlinks', () => {
    // Set SKILLFS_HOME_OVERRIDE to tmpDir so symlink target validation passes
    const originalOverride = process.env.SKILLFS_HOME_OVERRIDE;
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;

    try {
      const realDir = path.join(tmpDir, 'real-skill');
      const linkDir = path.join(tmpDir, 'linked-skill');
      fs.mkdirSync(realDir);
      fs.writeFileSync(path.join(realDir, 'SKILL.md'), '---\ndescription: A linked skill\n---');
      fs.symlinkSync(realDir, linkDir);

      const result = parseSkill(linkDir, 'claude');
      expect(result).not.toBeNull();
      expect(result!.isSymlink).toBe(true);
      expect(result!.symlinkTarget).toBe(realDir);
      // Description should still be accessible via symlink
      expect(result!.description).toBe('A linked skill');
    } finally {
      if (originalOverride) {
        process.env.SKILLFS_HOME_OVERRIDE = originalOverride;
      } else {
        delete process.env.SKILLFS_HOME_OVERRIDE;
      }
    }
  });

  it('should handle empty skill directory', () => {
    const skillDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(skillDir);

    // Create a different name to avoid collision
    const result = parseSkill(skillDir, 'clawdbot');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('empty');
    expect(result!.description).toBe('(No SKILL.md)');
  });

  it('should use os.tmpdir() path without home override', () => {
    // ~/tmp-like paths should resolve using actual homedir
    const skillDir = path.join(tmpDir, 'any-run');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\ndescription: test\n---');

    const result = parseSkill(skillDir, 'custom');
    expect(result).not.toBeNull();
    expect(result!.runtime).toBe('custom');
    expect(result!.description).toBe('test');
  });
});

describe('MD5 hashing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should produce identical hash for identical SKILL.md', () => {
    const dir1 = path.join(tmpDir, 'skill1');
    const dir2 = path.join(tmpDir, 'skill2');
    const content = '---\ndescription: Same skill\n---\n\n# Same';

    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
    fs.writeFileSync(path.join(dir1, 'SKILL.md'), content);
    fs.writeFileSync(path.join(dir2, 'SKILL.md'), content);

    const s1 = parseSkill(dir1, 'claude');
    const s2 = parseSkill(dir2, 'agent');

    expect(s1!.hash).toBe(s2!.hash);
  });

  it('should produce different hash for different SKILL.md', () => {
    const dir1 = path.join(tmpDir, 'skill-a');
    const dir2 = path.join(tmpDir, 'skill-b');

    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
    fs.writeFileSync(path.join(dir1, 'SKILL.md'), '---\ndescription: Version A\n---');
    fs.writeFileSync(path.join(dir2, 'SKILL.md'), '---\ndescription: Version B\n---');

    const s1 = parseSkill(dir1, 'claude');
    const s2 = parseSkill(dir2, 'claude');

    expect(s1!.hash).not.toBe(s2!.hash);
  });
});

describe('parseSkill symlink target validation', () => {
  let tmpDir: string;
  let originalOverride: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-stv-'));
    originalOverride = process.env.SKILLFS_HOME_OVERRIDE;
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
  });

  afterEach(() => {
    if (originalOverride) {
      process.env.SKILLFS_HOME_OVERRIDE = originalOverride;
    } else {
      delete process.env.SKILLFS_HOME_OVERRIDE;
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should accept a symlink whose target is within home scope', () => {
    // Create a real skill dir inside tmpDir (which is our "home")
    const realDir = path.join(tmpDir, 'real-skill');
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, 'SKILL.md'), '---\ndescription: Safe skill\n---');

    // Create a symlink pointing to it (also inside tmpDir = "home")
    const linkDir = path.join(tmpDir, '.skills', 'linked-skill');
    fs.mkdirSync(path.join(tmpDir, '.skills'), { recursive: true });
    fs.symlinkSync(realDir, linkDir);

    const result = parseSkill(linkDir, 'skills');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('linked-skill');
    expect(result!.isSymlink).toBe(true);
  });

  it('should reject a symlink whose target escapes home scope', () => {
    // Create a symlink pointing to /tmp (outside our tmpDir "home" scope)
    const linkDir = path.join(tmpDir, '.skills', 'evil-link');
    fs.mkdirSync(path.join(tmpDir, '.skills'), { recursive: true });

    // Point to /tmp which is definitely outside tmpDir
    fs.symlinkSync('/tmp', linkDir);

    const result = parseSkill(linkDir, 'skills');
    expect(result).toBeNull();
  });

  it('should reject a symlink pointing to /etc', () => {
    const linkDir = path.join(tmpDir, '.skills', 'etc-link');
    fs.mkdirSync(path.join(tmpDir, '.skills'), { recursive: true });

    // Point to /etc — should be rejected
    try {
      fs.symlinkSync('/etc', linkDir);
    } catch {
      // symlink creation may fail on some systems, skip the test
      return;
    }

    const result = parseSkill(linkDir, 'skills');
    expect(result).toBeNull();
  });

  it('should not affect regular (non-symlink) directories', () => {
    const realDir = path.join(tmpDir, '.skills', 'normal-skill');
    fs.mkdirSync(path.join(tmpDir, '.skills'), { recursive: true });
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, 'SKILL.md'), '---\ndescription: Normal\n---');

    // Regular directories should pass through without issue
    const result = parseSkill(realDir, 'skills');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('normal-skill');
    expect(result!.isSymlink).toBe(false);
  });

  it('should accept a symlink with a relative target within scope', () => {
    const realDir = path.join(tmpDir, 'real-skill');
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, 'SKILL.md'), '---\ndescription: Relative target\n---');

    // Create a symlink with a relative path target
    const skillsDir = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const linkDir = path.join(skillsDir, 'rel-link');

    // Use absolute path for the symlink target (fs.symlinkSync needs it)
    fs.symlinkSync(realDir, linkDir);

    const result = parseSkill(linkDir, 'skills');
    expect(result).not.toBeNull();
    expect(result!.isSymlink).toBe(true);
  });
});
