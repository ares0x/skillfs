# SkillFS

<p align="center">
  <b>One source of truth for all your AI agent skills.</b><br>
  Stop copying. Start linking.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node version"></a>
  <img src="https://img.shields.io/badge/tests-127%20passed-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/license-ISC-blue" alt="License">
  <a href="https://github.com/ares0x/skillfs/actions/workflows/ci.yml"><img src="https://github.com/ares0x/skillfs/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
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

```text
sk doctor          Scan all runtimes, find duplicates, estimate savings
sk doctor --json   Machine-readable JSON output for automation
sk dedupe          Migrate duplicates to ~/.skills/, replace with symlinks
sk dedupe --dry-run   Preview without touching anything
sk install <path>  Install a skill to ~/.skills/ and link to runtimes
sk uninstall <name>   Remove a skill from ~/.skills/ and clean up symlinks
sk link --all      Link all ~/.skills/ back to every runtime
sk list            Visual tree of every skill and its link status
sk watch           Watch runtime dirs for new skills in real time
```

### `sk doctor`

**Auto-discovers every AI agent on your machine**, then scans for duplicates:

- Scans `~/.*/skills/` — finds agents you forgot you even installed
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

### `sk install`

Copy a skill directory to `~/.skills/` and create symlinks to runtimes:

```bash
sk install ~/projects/my-skill           # Install and link to all runtimes
sk install ~/projects/my-skill -r claude # Install and link to one runtime
sk install --all-from claude             # Batch-install all unique skills from one runtime
sk install --all-from claude --dry-run   # Preview before batch-installing
```

The source must be a directory containing a `SKILL.md` file. SkillFS extracts the directory name as the skill name, copies everything to `~/.skills/<name>/`, and optionally creates symlinks in each runtime's skills directory.

### `sk uninstall`

Remove a skill from `~/.skills/` and clean up symlinks:

```bash
sk uninstall my-skill           # Remove from ~/.skills/ and all runtimes
sk uninstall my-skill -r claude # Remove from one runtime only, keep ~/.skills/
```

When removing from all runtimes (no `--runtime` flag), every symlink pointing to `~/.skills/<name>` is removed, the central copy is deleted, and the registry entry is cleared. With `--runtime`, only the specified runtime's symlink is removed.

### `sk watch`

Monitor runtime skills directories for new skills in real time:

```bash
sk watch                  # Watch all configured runtimes
sk watch --runtime claude # Watch one runtime only
```

Polling-based detection (every 2 seconds) — reliable across all platforms. When a new skill directory containing a `SKILL.md` appears, prints:

```
✨ 发现新 skill: my-skill — 使用 sk install ~/.claude/skills/my-skill 安装
```

Runs until `Ctrl+C`. Graceful shutdown on `SIGINT`.

---

## CLI Reference

### `sk` (top-level)

```bash
sk --help       # Show all commands and options
sk --version    # Print version number
```

### `sk doctor`

Auto-discover agents and scan for duplicates, estimate savings.

```bash
sk doctor              # Human-readable report
sk doctor --json       # Machine-readable JSON output
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--json` | — | Output analysis results as structured JSON to stdout |

Run it anytime — it's read-only, zero side effects. Automatically finds any `~/.{name}/skills/` directory with valid `SKILL.md` files.

When `--json` is passed, the output is a JSON object with `runtimes`, `central`, `duplicates`, `totalDuplicatesCount`, `conflictsCount`, `savingsBytes`, and `incompleteTransactions` fields — suitable for piping to `jq` or consumption by other tools.

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

### `sk install`

Install skill(s) to `~/.skills/` and link to runtimes.

```bash
sk install <path>                     # Install one skill, link to all runtimes
sk install <path> --runtime <name>    # Install one skill, link to one runtime
sk install --all-from <runtime>       # Batch-install all unique skills from a runtime
sk install --all-from claude --dry-run # Preview batch install, no changes
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--runtime <name>` | `-r` | Target runtime. If omitted, links to all configured runtimes. |
| `--all-from <name>` | — | Scan a runtime's skills dir and install every non-symlink skill not yet in `~/.skills/` |
| `--dry-run` | — | Preview only — no files are modified |

For single-skill install, `<path>` must be a directory containing a `SKILL.md` file. For batch install with `--all-from`, no `<path>` is needed — the runtime's skills directory is scanned automatically.

### `sk uninstall`

Remove a skill from `~/.skills/` and clean up symlinks.

```bash
sk uninstall <name> --runtime <name>  # Remove from one runtime only
sk uninstall <name>                   # Remove from all runtimes and ~/.skills/
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--runtime <name>` | `-r` | Only remove symlink from the specified runtime. Keeps the skill in `~/.skills/`. Without this flag, removes everything: symlinks, central copy, and registry entry. |

Only removes symlinks that actually point to `~/.skills/<name>`. Symlinks pointing elsewhere are left untouched.

### `sk watch`

Monitor runtime skills directories for new skills in real time.

```bash
sk watch                  # Watch all configured runtimes
sk watch --runtime <name> # Watch one runtime only
```

| Option | Alias | Description |
|--------|-------|-------------|
| `--runtime <name>` | `-r` | Only watch the specified runtime. Omitting watches all configured runtimes. |

Polls every 2 seconds. Prints a notification when a new skill directory (with `SKILL.md`) appears. Runs until `Ctrl+C`.

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
| **127 tests** | Full coverage of filesystem operations, scanner, registry, lock, and security edge cases |

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
git clone https://github.com/ares0x/skillfs.git
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

**Auto-discovery — zero config.** SkillFS scans `~/.*/skills/` for any directory with valid `SKILL.md` files. Install a new agent and `sk doctor` sees it immediately. No manual config, no hardcoded list to maintain. Use `~/.skills/config.json` to exclude specific directories.

If you only use one agent — you probably don't need this. If you have 27 and didn't even remember half of them, this changes everything.

---

## Architecture

```
src/
├── index.ts              # Commander CLI entry (6 subcommands)
├── commands/
│   ├── doctor.ts         # Scan, analyze, report (human + JSON)
│   ├── dedupe.ts         # Migrate with rollback + interactive diff
│   ├── link.ts           # Symlink management
│   ├── list.ts           # Tree visualization
│   ├── install.ts        # Skill installation
│   ├── uninstall.ts      # Skill removal
│   └── watch.ts          # Real-time directory monitor
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
- **Anyone** who ran `ls ~/.*/skills` and was surprised by the number

SkillFS auto-discovers every agent on your machine — you don't need to remember which ones you installed. `sk doctor` tells you.

---

## Contributing

Bug reports and PRs welcome. Run tests before submitting:

```bash
pnpm test          # 127 tests, must all pass
pnpm run build     # TypeScript compilation, must succeed
```

Tests use `vitest` with isolated temporary directories (`os.tmpdir()`) — they never touch your real `~/.skills/`.

---

## License

ISC © Jace (Sanage)
