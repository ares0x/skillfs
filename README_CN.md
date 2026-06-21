# SkillFS

<p align="center">
  <b>所有 AI Agent Skill 的单一真相源。</b><br>
  别再复制粘贴了，用软链接。
</p>

<p align="center">
  <a href="#快速开始"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node version"></a>
  <a href="#"><img src="https://img.shields.io/badge/tests-127%20passed-brightgreen" alt="Tests"></a>
  <a href="#"><img src="https://img.shields.io/badge/license-ISC-blue" alt="License"></a>
  <a href="README.md">English</a>
</p>

---

你用着 Claude Code、Cursor、还有好几个 AI 编程 agent。每个 agent 都要求把 skill 放在自己的目录里。于是你有了：

```
~/.claude/skills/pdf/SKILL.md
~/.agents/skills/pdf/SKILL.md
~/.clawdbot/skills/pdf/SKILL.md
~/.cursor/skills/pdf/SKILL.md
```

同一个 skill，四份拷贝。每次改了 PDF skill 的内容，你得手动同步四个地方——或者忘了同步，它们就悄悄地变不一样了。

**SkillFS 来解决。** 它找到所有重复的 skill，把它们迁移到 `~/.skills/`，再用软链接替换原来的位置。每个 agent 看到的还是 `skills/pdf/`——但实际上都指向同一份文件。

---

## 快速开始

```bash
# 1. 安装
npm install -g skillfs

# 2. 看看有哪些重复
sk doctor

# 3. 一键修复
sk dedupe
```

就这样。你的 agent 完全感知不到变化——它们天生就会跟随软链接。

---

## 功能

```
sk doctor          扫描所有运行时，发现重复，估算可节省空间
sk dedupe          把重复 skill 迁移到 ~/.skills/，原位置替换为软链接
sk dedupe --dry-run   仅预览，不实际修改任何文件
sk install <path>  安装 skill 到 ~/.skills/ 并链接到运行时
sk uninstall <name>   从 ~/.skills/ 移除 skill 并清理软链接
sk link --all      把 ~/.skills/ 里所有 skill 链接回每个运行时
sk list            可视化树展示每个 skill 在各运行时的链接状态
```

### `sk doctor`

扫描所有已配置的运行时，按名称分组，报告：

- **内容相同的重复 skill**（MD5 一致）——可以安全自动迁移
- **内容冲突的版本**（同名但内容不同）——需要你来决定
- **可节省的磁盘空间**
- **中断的事务**——如果上次 `dedupe` 被中断，会告诉你如何恢复

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

核心功能。内容相同的 skill 自动迁移。有冲突时，进入交互式选择：

- 选择保留哪个版本
- 查看**彩色逐行 diff** 对比差异
- 跳过，稍后再处理

每次迁移都遵循**事务性安全协议**：

1. 先复制到 `~/.skills/<name>/`
2. 验证副本完整（递归哈希比对）
3. 确认无误后才删除原始目录并创建软链接
4. 最后更新 registry

任何一步失败，**全部回滚**。

```bash
sk dedupe           # 交互式迁移
sk dedupe --dry-run # 仅预览，不做任何修改
```

### `sk link`

把集中管理的 skill 重新链接到运行时：

```bash
sk link pdf --runtime claude    # 一个 skill → 一个运行时
sk link pdf --all               # 一个 skill → 所有运行时
sk link --all                   # 全部 skill → 全部运行时
```

### `sk list`

你的整个 skill 生态系统的树状视图：

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

复制 skill 目录到 `~/.skills/` 并创建运行时软链接：

```bash
sk install ~/projects/my-skill           # 安装并链接到所有运行时
sk install ~/projects/my-skill -r claude # 安装并链接到指定运行时
sk install --all-from claude             # 批量安装某个运行时下所有独有 skill
sk install --all-from claude --dry-run   # 先预览，不实际修改
```

源目录必须包含 `SKILL.md` 文件。SkillFS 提取目录名作为 skill 名称，将所有内容复制到 `~/.skills/<name>/`，并可选择在每个运行时的 skills 目录中创建软链接。

### `sk uninstall`

从 `~/.skills/` 移除 skill 并清理软链接：

```bash
sk uninstall my-skill           # 从 ~/.skills/ 和所有运行时中移除
sk uninstall my-skill -r claude # 仅从一个运行时移除，保留 ~/.skills/ 中的副本
```

不加 `--runtime` 时，所有指向 `~/.skills/<name>` 的软链接都会被删除，中央副本被移除，registry 记录被清除。加 `--runtime` 时仅移除指定运行时的软链接。

---

## CLI 命令参考

### `sk`（顶级命令）

```bash
sk --help       # 显示所有命令和选项
sk --version    # 打印版本号 (1.0.0)
```

### `sk doctor`

**自动发现你机器上所有 AI agent**，然后扫描重复 skill：

- 扫描 `~/.*/skills/`——连你忘掉装过的 agent 都能发现

```bash
sk doctor
```

无选项。随时可运行——只读操作，零副作用。

### `sk dedupe`

将重复 skill 迁移到 `~/.skills/`，原位置替换为软链接。

```bash
sk dedupe              # 交互式迁移
sk dedupe --dry-run    # 仅预览，不修改任何文件
```

| 选项 | 别名 | 说明 |
|------|------|------|
| `--dry-run` | — | 仅展示操作计划，不实际修改文件 |

内容相同的 skill（MD5 一致）自动迁移。有冲突时进入交互式选择、查看 diff 或跳过。

### `sk link`

从 `~/.skills/` 创建软链接到运行时 skills 目录。

```bash
sk link <name> --runtime <name>      # 链接一个 skill 到一个运行时
sk link <name> --all (-a)            # 链接一个 skill 到所有运行时
sk link --all (-a)                   # 链接全部 skill 到所有运行时
```

| 选项 | 别名 | 说明 |
|------|------|------|
| `--runtime <name>` | `-r` | 目标运行时（如 `claude`、`cursor`、`gemini`） |
| `--all` | `-a` | 链接到所有已配置的运行时 |

### `sk list`

显示 `~/.skills/` 中所有 skill 及其在各运行时的软链接状态。

```bash
sk list
```

无选项。按运行时显示 `✓`（已链接）、`-`（未链接）、`⚠`（链接断裂）。

### `sk install`

安装 skill 到 `~/.skills/` 并链接到运行时。

```bash
sk install <path>                     # 安装单个 skill，链接到所有运行时
sk install <path> --runtime <name>    # 安装单个 skill，链接到指定运行时
sk install --all-from <runtime>       # 批量安装某个运行时下所有独有 skill
sk install --all-from claude --dry-run # 先预览，不实际修改
```

| 选项 | 别名 | 说明 |
|------|------|------|
| `--runtime <name>` | `-r` | 目标运行时。省略则链接到所有已配置的运行时。 |
| `--all-from <name>` | — | 扫描指定运行时的 skills 目录，批量安装所有不在 `~/.skills/` 中的非软链接 skill |
| `--dry-run` | — | 仅预览，不实际修改文件 |

单个安装时 `<path>` 必须是包含 `SKILL.md` 文件的目录。批量安装时无需提供路径——运行时的 skills 目录会被自动扫描。

### `sk uninstall`

从 `~/.skills/` 移除 skill 并清理软链接。

```bash
sk uninstall <name> --runtime <name>  # 仅从一个运行时移除
sk uninstall <name>                   # 从所有运行时和 ~/.skills/ 中移除
```

| 选项 | 别名 | 说明 |
|------|------|------|
| `--runtime <name>` | `-r` | 仅移除指定运行时的软链接，保留 `~/.skills/` 中的副本。不加此选项时，移除所有内容：软链接、中央副本和 registry 记录。 |

仅移除实际指向 `~/.skills/<name>` 的软链接，指向其他位置的软链接不会被删除。

---

## 安全与防护

SkillFS 会修改你的文件系统。我们对此非常认真。

| 防护措施 | 原理 |
|----------|------|
| **Dry run 预览** | `sk dedupe --dry-run` 展示全部操作计划，不碰任何文件 |
| **事务性迁移** | 复制 → 验证 → 删除 → 软链接 → 写 registry。任一步失败即全量回滚 |
| **原子文件锁** | `O_CREAT \| O_EXCL` 防止两个 `sk` 进程同时损坏 registry |
| **路径穿越防护** | 所有路径都经过校验——`config.json` 里写 `../../../etc` 会被拦截 |
| **软链接目标校验** | 指向 home 目录以外的软链接会被检测并拒绝 |
| **中断事务检测** | `sk doctor` 能发现被中断的 `dedupe` 操作并给出恢复建议 |
| **127 个测试** | 覆盖文件系统操作、扫描器、registry、锁、以及安全边界场景 |

---

## 安装

### 全局安装（推荐）

```bash
npm install -g skillfs
sk doctor
```

全局安装后，所有命令都可以通过 `sk <command>` 在任何目录运行。

### 从 GitHub

```bash
git clone https://github.com/jacejia/skillfs.git
cd skillfs
pnpm install
pnpm run build
```

编译完成后，通过以下方式之一使用命令：

```bash
# 方式 1：npm link（将 sk 注册为全局命令）
npm link
sk doctor

# 方式 2：pnpm dev 脚本
pnpm run dev doctor
pnpm run dev dedupe --dry-run
pnpm run dev link --all
pnpm run dev list

# 方式 3：直接执行编译产物
node dist/index.js doctor
node dist/index.js dedupe --dry-run
node dist/index.js link --all
node dist/index.js list
```

### 环境要求

- Node.js ≥ 18
- macOS 或 Linux（软链接为 Unix 特性）
- pnpm（开发时）

---

## 自定义运行时

如果你的 agent 不在默认列表里，在 `~/.skills/config.json` 中添加：

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

**自动发现，零配置。** SkillFS 自动扫描 `~/.*/skills/`，任何包含有效 `SKILL.md` 的目录都会被识别。安装新 agent 后 `sk doctor` 立刻就能看到，无需手动配置任何东西。使用 `~/.skills/config.json` 排除不需要的目录。

---

## 架构

```
src/
├── index.ts              # Commander CLI 入口（4 个子命令）
├── commands/
│   ├── doctor.ts         # 扫描、分析、报告
│   ├── dedupe.ts         # 迁移（带回滚）+ 交互式 diff
│   ├── link.ts           # 软链接管理
│   └── list.ts           # 树状可视化
├── core/
│   ├── config.ts         # 运行时定义 + 自定义配置
│   ├── registry.ts       # ~/.skills/registry.json（带原子锁）
│   ├── scanner.ts        # 多运行时目录扫描器
│   └── skill.ts          # SKILL.md 解析 + MD5 身份标识
└── utils/
    ├── fs.ts             # 安全的文件系统操作 + 路径校验
    ├── lock.ts           # 原子 PID 文件锁
    └── display.ts        # 终端输出格式化
```

**数据流：** 配置 → 扫描器 → Skill 解析器 → Registry → 命令层

中央目录 `~/.skills/` 是唯一的真相源。各运行时看到的是透明解析到它的软链接。没有任何 agent 需要知道 SkillFS 的存在。

---

## 适合谁用？

- 同时使用**多个 AI 编程 agent** 的重度用户
- 需要**共享、版本化管理** skill 目录的团队
- 跑了一次 `ls ~/.*/skills` 被数量吓到的人

SkillFS 自动发现你机器上每一个 agent——你不需要记得装过哪些。`sk doctor` 会告诉你。

---

## 贡献

欢迎提交 Bug 报告和 PR。提交前请运行测试：

```bash
pnpm test          # 127 个测试，必须全部通过
pnpm run build     # TypeScript 编译，必须成功
```

测试用 `vitest` + 隔离的临时目录（`os.tmpdir()`）——永远不会碰你真实的 `~/.skills/`。

---

## 许可证

ISC © Jace (Sanage)
