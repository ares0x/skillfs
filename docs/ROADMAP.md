# SkillFS 路线图

> 最后更新：2026-06-21
>
> 核心理念：**最轻、最硬、最可组合的 AI Agent Skill CLI。** 不做 GUI，不做 marketplace，做 Unix 哲学下的管道组件。

---

## 指导原则

1. **CLI 优先，永远不碰 GUI。** GUI 是别人的赛道（skills-manager），CLI 是我们的。
2. **安全是功能。** 事务回滚、原子锁、路径验证不是"附加"，是核心卖点。
3. **自动发现是护城河。** 竞品还在手动维护 agent 列表，我们已经零配置了。
4. **管道友好。** 每个命令都应该能被 `jq`、`xargs`、shell 脚本消费。
5. **保持轻量。** 依赖不超过 5 个，代码行数控制在 3000 以内。

---

## 已完成

### v1.0.0 — 核心去重引擎
- [x] `sk doctor` — 扫描发现重复 skill
- [x] `sk dedupe` — 交互式去重 + 软链接替换
- [x] `sk link` — 手动建立软链接
- [x] `sk list` — 树状可视化链接状态
- [x] 事务性迁移 + 回滚机制
- [x] 原子文件锁
- [x] 路径穿越防护
- [x] 110 个测试

### v1.1.0 — 安装/卸载
- [x] `sk install <path>` — 单个 skill 安装
- [x] `sk install --all-from <runtime>` — 批量安装
- [x] `sk uninstall <name>` — 卸载 skill
- [x] `--dry-run` 预览模式

### v1.2.0 — 自动发现
- [x] `discoverRuntimes()` — 扫描 `~/.*/skills/` 自动识别 agent
- [x] `config.json` exclude 机制
- [x] 默认列表从 30 精简到 14（自动发现兜底）
- [x] 实测发现 27 个 agent，包括 12 个之前未察觉的

### v1.3.0 — 工程化
- [x] GitHub Actions CI（Node 18/20/22）
- [x] `sk doctor --json` — 机器可读输出
- [x] `sk watch` — 实时监控新 skill

---

## 短期（v1.4 - v1.6）

### v1.4 — `sk doctor --fix`
非交互式一键修复。`sk doctor --fix` 等价于 `sk dedupe` 但静默处理所有相同 skill、跳过冲突、返回 exit code 表示是否有未处理的冲突。适合 CI/CD 管道：

```bash
sk doctor --fix --json | jq '.unresolved'
```

**工作量：** 小（dedupe.ts 加一个 nonInteractive 模式）

### v1.5 — `sk backup / sk restore`
Git 驱动的备份恢复：

```bash
sk backup              # git init ~/.skills/ + commit + push
sk backup --remote     # 推送到配置的 git remote
sk restore <ref>       # 从 git 历史恢复特定版本
sk restore --latest    # 从 remote 拉取最新
```

**工作量：** 中（需要 git 操作 + registry 快照）

### v1.6 — `sk doctor --json` 增强
- 增加 `--summary` 只输出摘要（适合终端横幅）
- 增加 `--filter <name>` 只看特定 skill 的状态
- JSON schema 稳定化，写文档

**工作量：** 小

---

## 中期（v2.0）

### 项目级 skill 管理

目前 SkillFS 只管全局 skill（`~/.agent/skills/`）。项目级 skill（`<project>/.claude/skills/`）是两个竞品都在做但都做得很重的事。

我们的方案：**不管理项目 skill，只做"发现和报告"。**

```bash
sk doctor --project     # 扫描当前目录及父目录的 .*/skills/
```

不做安装/去重（项目 skill 应该跟着 git 走），只告诉用户"你这个项目有 3 个本地 skill，跟全局的 X 和 Y 冲突了"。

**工作量：** 中

### `sk install <url>`

从 GitHub URL 或本地 zip 安装 skill：

```bash
sk install https://github.com/user/my-skill    # clone 到 ~/.skills/
sk install ./my-skill.skill                     # 从 .skill 归档安装
```

不建 marketplace，不建 registry。就用 GitHub 和本地文件——最简路径。

**工作量：** 中（需要 git clone + 解压逻辑）

---

## 远期想法（v3.0+）

| 功能 | 说明 | 优先级 |
|------|------|--------|
| `sk doctor --fix` | 非交互式修复（见 v1.4） | 高 |
| `sk share <name>` | 把 skill 打包推送到 GitHub Gist | 低 |
| `sk init --from <remote>` | 在新机器上从 git remote 一键恢复所有 skill | 低 |
| `sk doctor --watch` | 合并 doctor + watch，持续输出状态变化 | 低 |
| Windows 支持 | Junction 回退（参考 jiweiyeah 的实现） | 低 |
| MCP 集成 | 把 skill 暴露为 MCP 资源 | 远期 |

---

## 不会做的（Anti-Roadmap）

| 不做 | 理由 |
|------|------|
| **GUI** | 两个竞品已经在这个赛道了，我们不跟他们抢 |
| **Marketplace / Registry** | 太重，维护成本高。GitHub + 本地文件已经够用 |
| **Preset / Workspace / Tag** | 这是 GUI 管理仪表盘功能，CLI 不需要 |
| **Cloud Sync** | 用 `sk backup / sk restore` + 自己的 git remote 代替 |
| **Skill 编辑** | 用你已有的编辑器打开 `~/.skills/<name>/SKILL.md` |
| **多机实时同步** | 不在 scope 内，git 已经够用 |
| **npm 之外的分发** | brew 可以考虑，但不是现在 |

---

## 版本号约定

```
v<MAJOR>.<MINOR>.<PATCH>

MAJOR — 架构变化或破坏性 API 变更
MINOR — 新命令、新 flag、显著功能
PATCH — bug 修复、文档更新、测试补充
```

当前版本：**v1.3.0**
