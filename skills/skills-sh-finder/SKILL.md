---
name: skills-sh-finder
description: Search and install agent skills from skills.sh. Use when the user asks to find, search, discover, browse, or install skills, or says "is there a skill for X", "find a skill", "帮我找技能", "搜索技能", "安装技能", or wants to extend TeleAgent capabilities with new tools.
name_cn: 技能搜索安装助手
description_cn: 在 skills.sh 搜索和安装智能体技能，帮助 TeleAgent 用户发现和扩展能力。
create_source: super-agent-skill-creator
---

# Skills Finder

Search and install skills from the [skills.sh](https://skills.sh) ecosystem directly into TeleAgent.

> **安全原则**：本技能不自动修改系统配置、不创建命令包装器、不添加持久化环境变量。
> 所有涉及技能安装的操作均需向用户说明并获得确认后执行。本技能仅提供搜索建议和安装命令指引，实际安装由用户自主执行。

## Prerequisites: Install the skills CLI

This skill uses the `skills` command-line tool. TeleAgent users need the **fork version** from `mwh1987/skills-teleagent-fork` (not the upstream npm package), because only the fork supports `-a teleagent` and its post-install hooks.

### One-time installation

Refer to the [project README](https://github.com/mwh1987/skills-teleagent-fork#readme) for detailed setup. The key steps are:

1. Clone the fork repository from `https://github.com/mwh1987/skills-teleagent-fork`
2. Install dependencies with pnpm (requires Node >= 20.18)
3. Build the project with the obuild tool
4. Register the `skills` command globally
5. Verify with `skills --version`

For pnpm installation, see the [pnpm official guide](https://pnpm.io/installation). If you encounter corepack signature errors, consult the project README for troubleshooting.

> **安全说明**：CLI 的下载、构建和全局注册由用户自主完成。本技能不自动执行任何远程代码拉取或全局命令注册操作，仅在 CLI 已就绪后提供搜索和安装指引。

Once installed, the `skills` command is available system-wide. You only need to restart TeleAgent after **installing new skills**, not after installing the CLI itself.

## Workflow

### 1. Understand the Need

Identify the domain (React, testing, deployment, etc.) and the specific task (writing tests, PR review, generating docs). If the request is vague, ask one clarifying question before searching.

### 2. Search

Use the `skills find` command to search the skills.sh directory. Common usage:

- `skills find` — interactive search (fzf-style), lets user browse and select
- `skills find <keyword>` — search by keyword, e.g. `skills find react performance` or `skills find pr review`
- `skills find <keyword> --owner <owner>` — scope to a specific GitHub owner, e.g. `skills find react --owner vercel`

Browse the leaderboard at https://skills.sh/ for popular skills ranked by install count.

### 3. Verify Quality Before Recommending

Before recommending a skill, check:

- **Install count** — prefer 1K+. Be cautious under 100.
- **Source reputation** — `vercel-labs`, `anthropics`, `microsoft` are trustworthy. Unknown authors need scrutiny.
- **GitHub stars** — a repo with <100 stars warrants skepticism.

### 4. Recommend Installation

After verifying quality, recommend the skill to the user and provide the install command. **Do not execute the install command automatically** — present it to the user and let them decide whether to proceed.

The install command format is:

- Install a specific skill: `skills add <owner/repo> -s <skill-name> -a teleagent -g`
- Install all skills from a repo: pass each skill name individually with the `-s` flag, or use the `--skill` flag as described in `skills add --help`
- Non-interactive batch mode: append `-y` flag

The `-a teleagent -g` flags are essential — they trigger the post-install hook that auto-configures TeleAgent (permission whitelist, lock sync, frontmatter normalization).

> **安全提示**：安装命令中的 `-g` 标志表示全局安装，会将技能文件写入 TeleAgent 的全局 skills 目录。请向用户说明此影响，由用户确认后自主执行安装命令。本技能不自动执行安装操作。

### 5. Restart TeleAgent

After installation, tell the user to **restart the TeleAgent client** so the new skill appears in the skill manager.

## Presenting Results

When presenting a found skill, include:

1. Skill name and what it does (in Chinese if the user speaks Chinese)
2. Install count and source repo
3. The install command (for the user to run, not auto-executed)
4. A link to the skill page on skills.sh

Example presentation:

找到 "web-design-guidelines" 技能，来自 vercel-labs/agent-skills 仓库。
提供前端设计指导，包括排版、配色、组件设计等。（18 万次安装）

建议安装命令（请确认后自行执行）：
`skills add vercel-labs/agent-skills -s web-design-guidelines -a teleagent -g`

详情：https://skills.sh/vercel-labs/agent-skills/web-design-guidelines
安装后请重启 TeleAgent 客户端。

## Common Skill Categories

| Category | Keywords |
|----------|----------|
| Web 开发 | react, nextjs, typescript, css, tailwind |
| 测试 | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| 文档 | docs, readme, changelog, api-docs |
| 代码质量 | review, lint, refactor, best-practices |
| 设计 | ui, ux, design-system, accessibility |

## When No Skills Found

1. Acknowledge no match was found
2. Offer to help with the task directly
3. Suggest creating a skill with the skill-creator workflow

## Key Sources

- [skills.sh](https://skills.sh) — skill directory, ranked by installs
- [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) — React, Next.js, web design (100K+ installs each)
- [anthropics/skills](https://github.com/anthropics/skills) — frontend design, document processing
