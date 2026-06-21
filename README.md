# SkillFS

<p align="center">
  <b>One source of truth for all your AI agent skills.</b><br>
  Stop copying. Start linking.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node version"></a>
  <a href="#"><img src="https://img.shields.io/badge/tests-110%20passed-brightgreen" alt="Tests"></a>
  <a href="#"><img src="https://img.shields.io/badge/license-ISC-blue" alt="License"></a>
  <a href="README_CN.md">中文文档</a>
</p>

---

You run Claude Code, Cursor, and a few other AI coding agents. Each one wants its skills in a different directory. So you end up with:

```
~/.claude/skills/pdf/SKILL.md
~/.agents/skills/pdf/SKILL.md
~/.clawdbot/skills/pdf/SKILL.md
~/.cursor/skills/pdf/SKILL.md
```

Same skill. Four copies. Every time you tweak the PDF skill, you have to sync four places — or forget, and they silently diverge.

**SkillFS fixes this.** It finds all your duplicate skills, migrates them to `~/.skills/`, and replaces the copies with symlinks. Each agent still sees its own `skills/pdf/` — but now they all point to the same files.

---

## Quick Start

```bash
# 1. Install
npm install -g skillfs

# 2. See what's duplicated
sk doctor

# 3. Fix it
sk dedupe
```

That's it. Your agents won't notice the difference — they follow symlinks transparently.

---

## Features

```
sk doctor          Scan all runtimes, find duplicates, estimate savings
sk dedupe          Migrate duplicates to ~/.skills/, replace with symlinks
sk dedupe --dry-run   Preview without touching anything
sk link --all      Link all ~/.skills/ back to every runtime
sk list            Visual tree of every skill and its link status
```

### `sk doctor`

Scans all configured runtimes, groups skills by name, and reports:

- **Identical duplicates** (same MD5 hash) — safe to auto-migrate
- **Conflicting versions** (different content, same name) — needs your decision
- **Disk space savings** — how much you'll reclaim
- **Incomplete transactions** — if a previous `dedupe` was interrupted, tells you how to recover

```
$ sk doctor

🔍 SkillFS Doctor 🔍

扫描目录：
✓ ~/.claude/skills      (5 skills)
✓ ~/.agent/skills       (3 skills)
✓ ~/.clawdbot/skills    (4 skills)
✓ ~/.skills              (2 skills)

发现重复 Skill：

  pdf          × 3  [内容相同 ✓]
  code-review  × 2  [内容不同 ⚠]

汇总：
  重复 Skill：2 个（共 5 个副本）
  内容冲突：1 个（需手动确认）
  可节省空间：约 156.3 KB

运行 sk dedupe 开始迁移
```

### `sk dedupe`

The main event. Identical skills are migrated automatically. For conflicts, you get an interactive prompt:

- Choose which version to keep
- View a **colored line-by-line diff** between versions
- Skip and come back later

Every migration follows a **transactional safety protocol**:

1. Copy to `~/.skills/<name>/`
2. Verify the copy is complete (recursive hash comparison)
3. Remove originals and create symlinks
4. Update the registry

If anything fails, all changes are **rolled back**.

```bash
sk dedupe           # Interactive
sk dedupe --dry-run # See what would happen, no changes made
```

### `sk link`

Re-link centralized skills to your runtimes:

```bash
sk link pdf --runtime claude    # One skill → one runtime
sk link pdf --all               # One skill → all runtimes
sk link --all                   # Everything → everywhere
```

### `sk list`

A tree view of your entire skill ecosystem:

```
$ sk list

📋 SkillFS List 📋

~/.skills (Source of Truth)
├── pdf              [claude ✓] [agent -] [clawdbot ✓]
└── code-review      [claude ✓] [agent ✓] [clawdbot ⚠]

~/.agent/skills (额外，未迁移)
└── legacy-formatter (未在 ~/.skills 中，运行 sk dedupe 迁移)

图例: ✓ 已链接  - 未链接  ⚠ 链接断裂
```

---

## CLI Reference

### `sk` (top-level)

```bash
sk --help       # Show all commands and options
sk --version    # Print version number (1.0.0)
```

### `sk doctor`

Scan all runtimes, discover duplicates, estimate savings.

```bash
sk doctor
```

No options. Run it anytime — it's read-only, zero side effects.

### `sk dedupe`

Migrate duplicates to `~/.skills/` and replace originals with symlinks.

```bash
sk dedupe              # Interactive migration
sk dedupe --dry-run    # Preview only — no files are modified
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--dry-run` | — | Show what *would* happen without making any changes |

Identical skills (same MD5) are auto-migrated. Conflicting versions offer an interactive prompt to choose, view a diff, or skip.

### `sk link`

Create symlinks from `~/.skills/` to runtime skills directories.

```bash
sk link <name> --runtime <name>      # Link one skill to one runtime
sk link <name> --all (-a)            # Link one skill to all runtimes
sk link --all (-a)                   # Link all skills to every runtime
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--runtime <name>` | `-r` | Target runtime (e.g. `claude`, `cursor`, `gemini`) |
| `--all` | `-a` | Link to all configured runtimes |

### `sk list`

Display all skills in `~/.skills/` with their symlink status across runtimes.

```bash
sk list
```

No options. Shows `✓` (linked), `-` (not linked), `⚠` (broken link) per runtime.

---

## Safety & Security

SkillFS modifies your filesystem. We take that seriously.

| Protection | How it works |
|------------|-------------|
| **Dry run** | `sk dedupe --dry-run` shows everything that would happen without touching a single file |
| **Transactional migration** | Copy → verify → remove → symlink → registry. Any failure triggers full rollback |
| **Atomic file lock** | `O_CREAT \| O_EXCL` prevents two `sk` processes from corrupting the registry |
| **Path traversal guard** | All paths are validated — `config.json` can't trick the scanner into reading `/etc` |
| **Symlink target validation** | Symlinks pointing outside your home directory are detected and rejected |
| **Incomplete transaction detection** | `sk doctor` flags interrupted `dedupe` runs and shows recovery steps |
| **110 tests** | Full coverage of filesystem operations, scanner, registry, lock, and security edge cases |

---

## Installation

### Global install (recommended)

```bash
npm install -g skillfs
sk doctor
```

After global install, all commands are available as `sk <command>` anywhere.

### From GitHub

```bash
git clone https://github.com/jacejia/skillfs.git
cd skillfs
pnpm install
pnpm run build
```

After building, use commands via one of these methods:

```bash
# Method 1: npm link (makes `sk` available globally)
npm link
sk doctor

# Method 2: pnpm dev script
pnpm run dev doctor
pnpm run dev dedupe --dry-run
pnpm run dev link --all
pnpm run dev list

# Method 3: direct Node execution
node dist/index.js doctor
node dist/index.js dedupe --dry-run
node dist/index.js link --all
node dist/index.js list
```

### Requirements

- Node.js ≥ 18
- macOS or Linux (symlinks are Unix-only)
- pnpm (for development)

---

## Custom Runtimes

Got an agent that isn't in the defaults? Add it to `~/.skills/config.json`:

```json
{
  "runtimes": [
    {
      "name": "custom-agent",
      "path": "~/my-custom-agent/skills"
    }
  ]
}
```

**13 agents are covered out of the box:** Claude Code, VS Code / Copilot (`~/.agents/`), Clawdbot, Cursor, Codex, Gemini CLI, Windsurf, Cline, Continue, Aider, Augment, Roo Code, and OpenCode. Missing runtimes show up as inactive in `sk doctor` — no errors, no side effects.

---

## Architecture

```
src/
├── index.ts              # Commander CLI entry (4 subcommands)
├── commands/
│   ├── doctor.ts         # Scan, analyze, report
│   ├── dedupe.ts         # Migrate with rollback + interactive diff
│   ├── link.ts           # Symlink management
│   └── list.ts           # Tree visualization
├── core/
│   ├── config.ts         # Runtime definitions + custom config
│   ├── registry.ts       # ~/.skills/registry.json with atomic locking
│   ├── scanner.ts        # Multi-runtime directory scanner
│   └── skill.ts          # SKILL.md parser + MD5 identity
└── utils/
    ├── fs.ts             # Safe filesystem ops + path validation
    ├── lock.ts           # Atomic PID-based file lock
    └── display.ts        # Terminal output formatting
```

**Data flow:** Config → Scanner → Skill Parser → Registry → Commands

The central directory `~/.skills/` becomes the single source of truth. Runtimes see symlinks that transparently resolve to it. No agent needs to know SkillFS exists.

---

## Who is this for?

- **AI agent power users** running multiple coding agents simultaneously
- **Teams** that want shared, version-controlled skill directories
- **Anyone** who's tired of "which copy of this skill did I update last?"

If you only use one agent — you probably don't need this. If you use three and have 12 duplicate skill directories, this saves you from yourself.

---

## Contributing

Bug reports and PRs welcome. Run tests before submitting:

```bash
pnpm test          # 110 tests, must all pass
pnpm run build     # TypeScript compilation, must succeed
```

Tests use `vitest` with isolated temporary directories (`os.tmpdir()`) — they never touch your real `~/.skills/`.

---

## License

ISC © Jace (Sanage)
