import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Helper: create a skill directory with a SKILL.md file.
 */
function createSkill(dirPath: string, name: string, description: string): string {
  const skillDir = path.join(dirPath, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\ndescription: ${description}\n---\n\n# ${name}\n\nA sample skill.\n`,
  );
  return skillDir;
}

describe('runWatch', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillfs-watch-'));
    originalEnv = process.env.SKILLFS_HOME_OVERRIDE;
    process.env.SKILLFS_HOME_OVERRIDE = tmpDir;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
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
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /**
   * Extracts the polling callback from runWatch by intercepting setInterval.
   * Returns the interval callback so tests can invoke it directly.
   */
  async function getPollCallback(): Promise<() => void> {
    // We need to capture the interval callback.
    // Mock setInterval to capture the callback, then restore.
    let capturedCallback: (() => void) | null = null;

    const origSetInterval = global.setInterval;
    const setIntervalMock = vi.spyOn(global, 'setInterval').mockImplementation(
      ((cb: () => void, _ms?: number) => {
        capturedCallback = cb;
        return 42 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
    );

    // Mock process.exit and process.on to prevent actual shutdown
    const exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {
      // no-op
    }) as NodeJS.ExitFn);
    const onMock = vi.spyOn(process, 'on').mockImplementation(((_event: string, _listener: (...args: any[]) => void) => process) as typeof process.on);

    // Dynamically import runWatch
    const { runWatch } = await import('../../src/commands/watch.js');

    // Call runWatch — it will call setInterval, capturing the poll callback
    runWatch({});

    // Restore setInterval so we don't interfere with other tests
    setIntervalMock.mockRestore();
    exitMock.mockRestore();
    onMock.mockRestore();

    if (!capturedCallback) {
      throw new Error('Failed to capture interval callback from runWatch');
    }

    return capturedCallback;
  }

  it('should detect new skill directory appearing', async () => {
    // Create the runtime dir that runWatch will scan
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(claudePath, { recursive: true });

    const poll = await getPollCallback();

    // Initial poll: no skills
    poll();

    // Simulate a new skill appearing
    createSkill(claudePath, 'new-skill', 'New Skill');

    // Poll again: should detect
    poll();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('new-skill');
    expect(output).toContain('发现新 skill');
  });

  it('should detect SKILL.md appearing in a new directory', async () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(claudePath, { recursive: true });

    const poll = await getPollCallback();

    // Initial poll: nothing
    poll();

    // Create a directory first (without SKILL.md)
    const emptyDir = path.join(claudePath, 'late-skill');
    fs.mkdirSync(emptyDir, { recursive: true });

    // Poll: directory exists but no SKILL.md => not detected
    poll();

    let output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).not.toContain('late-skill');

    // Now add SKILL.md
    fs.writeFileSync(
      path.join(emptyDir, 'SKILL.md'),
      '---\ndescription: Late skill\n---\n',
    );

    // Poll again: should now detect
    poll();

    output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('late-skill');
  });

  it('should ignore hidden directories', async () => {
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(claudePath, { recursive: true });

    const poll = await getPollCallback();

    // Initial poll
    poll();

    // Create a hidden directory with SKILL.md (should be ignored)
    const hiddenDir = path.join(claudePath, '.hidden-skill');
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(
      path.join(hiddenDir, 'SKILL.md'),
      '---\ndescription: Hidden\n---\n',
    );

    // Poll: hidden directory should not be detected
    poll();

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).not.toContain('.hidden-skill');
    expect(output).not.toContain('hidden-skill');
  });

  it('should handle graceful shutdown on signal', async () => {
    let capturedSigintHandler: (() => void) | null = null;
    let capturedSigtermHandler: (() => void) | null = null;
    let exitCalled = false;
    let intervalCleared = false;

    // Mock process.on to capture handlers
    const onMock = vi.spyOn(process, 'on').mockImplementation(
      ((event: string, listener: (...args: any[]) => void) => {
        if (event === 'SIGINT') capturedSigintHandler = listener as () => void;
        if (event === 'SIGTERM') capturedSigtermHandler = listener as () => void;
        return process;
      }) as typeof process.on,
    );

    // Mock process.exit
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      exitCalled = true;
      return undefined as never;
    }) as NodeJS.ExitFn);

    // Mock clearInterval to verify it's called
    const clearIntervalMock = vi.spyOn(global, 'clearInterval').mockImplementation(((_id?: NodeJS.Timeout) => {
      intervalCleared = true;
    }) as typeof clearInterval);

    const { runWatch } = await import('../../src/commands/watch.js');

    // Set up the runtime dir
    const claudePath = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(claudePath, { recursive: true });

    runWatch({});

    // Verify handlers were registered
    expect(capturedSigintHandler).not.toBeNull();
    expect(capturedSigtermHandler).not.toBeNull();

    // Simulate SIGINT
    capturedSigintHandler!();

    expect(intervalCleared).toBe(true);
    expect(exitCalled).toBe(true);

    onMock.mockRestore();
    exitMock.mockRestore();
    clearIntervalMock.mockRestore();
  });
});
