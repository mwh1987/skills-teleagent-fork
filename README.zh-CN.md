---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '843731d4-c806-4a63-b69a-089ee7daaed4'
  PropagateID: '843731d4-c806-4a63-b69a-089ee7daaed4'
  ReservedCode1: '6e5b9c45-7dd4-44a1-b56b-583f6fe7f542'
  ReservedCode2: '6e5b9c45-7dd4-44a1-b56b-583f6fe7f542'
---

# skills-teleagent-fork

[English](./README.md) | **中文**

[vercel-labs/skills](https://github.com/vercel-labs/skills) 的 fork 版本，新增 **TeleAgent** 作为第 74 个受支持的智能体——安装后自动完成配置，技能首次即可使用，无需手动编辑任何文件。

## 这个 Fork 做了什么

上游 `skills` CLI 把技能文件复制到智能体目录后就此止步。TeleAgent 需要更多：权限白名单条目、lock 文件记录、符合严格规范的 frontmatter。缺少这些，技能虽然安装了但不会出现在 TeleAgent 界面中。

这个 fork 新增了 `postInstall`/`postRemove` 钩子对来填补这一差距。执行 `skills add -a teleagent -g` 时，以下 5 步自动完成：

| 步骤 | 做了什么 | 涉及文件 |
|------|---------|---------|
| 1 | **权限白名单** — 为技能添加 `allow` 权限 | `~/.config/TeleAgent/TeleAgent.jsonc` |
| 2 | **Lock 同步** — 写入 lock 条目，使技能出现在管理界面 | `~/.config/TeleAgent/skills/.skills_store_lock.json` |
| 3 | **Frontmatter 规范化** — 剥离 BOM、补全 `name_cn`/`description_cn`、注入 `create_source`、移除非标准字段、截断描述 | `<技能目录>/SKILL.md` |
| 4 | **文档清理** — 删除 `README.md`、`LICENSE` 等验证器拒绝的文件 | `<技能目录>/` |
| 5 | **Windows 兼容性检查** — 发现 `.sh` 脚本和 Unix 专有命令时发出警告 | 终端输出 |

`skills remove -a teleagent -g` 会逆向执行第 1 步和第 2 步。

> [!NOTE]
> TeleAgent 在启动时扫描技能目录。安装或移除技能后，请**重启 TeleAgent 客户端**。

## 快速开始

### 前提条件

- Node.js >= 20.18.0
- Windows 上已安装 TeleAgent 客户端

### 安装 CLI

这是 fork 版（未发布到 npm），需本地构建并链接：

```powershell
git clone https://github.com/mwh1987/skills-teleagent-fork.git
cd skills-teleagent-fork

$env:COREPACK_INTEGRITY_KEYS = "0"   # 绕过 corepack 签名验证
pnpm install
pnpm exec obuild
npm link                              # 将 skills 命令注册为全局可用
```

验证：`skills --help` 应输出帮助信息。

### 安装技能到 TeleAgent

```bash
# 从 GitHub 仓库安装
skills add vercel-labs/agent-skills -a teleagent -g

# 安装仓库中的指定技能
skills add vercel-labs/agent-skills -s web-design-guidelines -a teleagent -g

# 安装仓库中所有技能
skills add vercel-labs/agent-skills --skill '*' -a teleagent -g

# 从本地目录安装
skills add ./my-skill -a teleagent -g
```

然后**重启 TeleAgent**——技能就会出现在技能管理界面中。

### 管理已安装的技能

```bash
# 列出已安装的技能
skills list

# 更新技能
skills update my-skill -g

# 移除技能（自动清理白名单和 lock 条目）
skills remove my-skill -g
```

## 浏览技能

在 **[skills.sh](https://skills.sh)** 发现技能——一个按安装量排名的社区目录。

本 fork 还内置了一个技能（`skills/find-skills`），帮助 TeleAgent 用户以对话方式搜索和安装技能。安装到 TeleAgent：

```bash
skills add ./skills/find-skills -a teleagent -g
```

## 支持的智能体

本 fork 支持上游 CLI 的全部 74 个智能体。TeleAgent 是第 74 个，也是唯一带有安装后钩子的；其余 73 个行为与上游完全一致。

| 智能体 | `--agent` | 全局路径 |
|-------|-----------|----------|
| TeleAgent | `teleagent` | `~/.config/TeleAgent/skills/` |
| Claude Code | `claude-code` | `~/.claude/skills/` |
| Cursor | `cursor` | `~/.cursor/skills/` |
| Codex | `codex` | `~/.codex/skills/` |
| OpenCode | `opencode` | `~/.config/opencode/skills/` |
| ...及其他 69 个 | | |

运行 `skills list -a '*'` 查看所有智能体，或查阅[上游 README](https://github.com/vercel-labs/skills#supported-agents) 获取完整表格。

### 同时安装到多个智能体

```bash
# TeleAgent + Claude Code
skills add vercel-labs/agent-skills -a teleagent -a claude-code -g

# 所有已检测到的智能体
skills add vercel-labs/agent-skills -a '*' -g
```

## TeleAgent Frontmatter 规范

TeleAgent 要求 `SKILL.md` 的 frontmatter 遵循严格规范。安装后规范化器会自动执行这些规则，但技能作者应尽量提前合规：

**允许的字段**（其他字段会被移除）：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 小写 + 连字符，须与目录名一致 |
| `description` | 是 | 不超过 1024 字符，不能有尖括号 |
| `name_cn` | 是 | 中文显示名（回退使用 `name`） |
| `description_cn` | 是 | 中文描述（回退使用 `description`） |
| `create_source` | 否 | 缺失时自动注入为 `skillhub-import` |
| `license` | 否 | SPDX 标识符 |
| `allowed-tools` | 否 | 工具限制 |
| `metadata` | 否 | 任意元数据对象 |

```yaml
---
name: my-skill
description: 技能功能简介
name_cn: 我的技能
description_cn: 技能功能简介
create_source: skillhub-import
---
```

## 与上游的差异

| 方面 | 上游（`vercel-labs/skills`） | 本 fork |
|------|----------------------------|---------|
| 智能体数量 | 73 | 74（新增 `teleagent`） |
| 安装后钩子 | 不支持 | `postInstall`/`postRemove` 钩子系统 |
| TeleAgent 配置 | 手动编辑 | 自动白名单 + lock 同步 |
| Frontmatter | 原样保留 | 自动规范化为 TeleAgent 规范 |
| Windows 检查 | 无 | 对 `.sh` 脚本和 Unix 命令发出警告 |
| Node 引擎 | `>=22` | `>=20.18.0`（TeleAgent 运行时） |

所有上游命令（`add`、`remove`、`update`、`list`、`find`、`use`、`init`）工作方式完全相同。本 fork 是增量式的——绝不改变其余 73 个智能体的行为。

## 项目结构

```
skills-teleagent-fork/
├── src/
│   ├── agents.ts              # 智能体注册表（teleagent 条目 + 钩子运行器）
│   ├── teleagent-hooks.ts     # TeleAgent 安装后/移除后钩子逻辑
│   ├── frontmatter.ts         # YAML frontmatter 解析器（BOM 安全）
│   ├── add.ts                 # `skills add` 命令
│   ├── remove.ts              # `skills remove` 命令
│   └── types.ts               # AgentType、PostInstallContext 等
├── tests/
│   └── teleagent-hooks.test.ts # 钩子逻辑的 52 个单元测试
├── skills/
│   └── find-skills/           # 面向 TeleAgent 用户的内置技能
├── scripts/
│   └── sync-agents.ts         # README/关键词生成器
└── package.json
```

## 开发

```powershell
# 安装依赖
$env:COREPACK_INTEGRITY_KEYS = "0"
pnpm install

# 构建
pnpm exec obuild

# 类型检查
pnpm exec tsc --noEmit

# 运行 TeleAgent 钩子测试
pnpm exec vitest run tests/teleagent-hooks.test.ts

# 运行所有测试（注意：部分测试需要网络/git 访问）
pnpm exec vitest run
```

## 相关链接

- [上游仓库](https://github.com/vercel-labs/skills)
- [Agent Skills 规范](https://agentskills.io)
- [技能目录](https://skills.sh)
- [Vercel Agent Skills 仓库](https://github.com/vercel-labs/agent-skills)

## 许可证

MIT

> AI生成