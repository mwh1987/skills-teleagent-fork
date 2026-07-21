---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'bcff41eb-d130-4fa2-828b-bb48e0a4e043'
  PropagateID: 'bcff41eb-d130-4fa2-828b-bb48e0a4e043'
  ReservedCode1: '27647a22-d273-45b6-a677-10ab5496b65c'
  ReservedCode2: '27647a22-d273-45b6-a677-10ab5496b65c'
---

# skills-teleagent-fork

**English** | [中文](./README.zh-CN.md)

A fork of [vercel-labs/skills](https://github.com/vercel-labs/skills) that adds **TeleAgent** as the 74th supported agent — with automatic post-install configuration so skills work on first try, no manual editing required.

## What This Fork Does

The upstream `skills` CLI installs skill files into agent directories and stops there. TeleAgent needs more: a permission whitelist entry, a lock-file record, and frontmatter that follows a strict schema. Without these, a skill installs silently but never shows up in the TeleAgent UI.

This fork adds a `postInstall`/`postRemove` hook pair that bridges that gap. When you run `skills add -a teleagent -g`, five steps happen automatically:

| Step | What | File touched |
|------|------|-------------|
| 1 | **Permission whitelist** — adds `allow` for the skill | `~/.config/TeleAgent/TeleAgent.jsonc` |
| 2 | **Lock sync** — writes a lock entry so the skill appears in the manager UI | `~/.config/TeleAgent/skills/.skills_store_lock.json` |
| 3 | **Frontmatter normalization** — strips BOM, fills `name_cn`/`description_cn`, injects `create_source`, removes non-standard fields, truncates description | `<skill-dir>/SKILL.md` |
| 4 | **Document cleanup** — removes `README.md`, `LICENSE`, etc. that TeleAgent's validator rejects | `<skill-dir>/` |
| 5 | **Windows compatibility check** — warns on `.sh` scripts and Unix-only commands | terminal output |

`skills remove -a teleagent -g` reverses steps 1 and 2.

> [!NOTE]
> TeleAgent scans the skills directory at startup. **Restart the TeleAgent client** after installing or removing a skill.

## Quick Start

### Prerequisites

- Node.js >= 20.18.0
- TeleAgent client installed on Windows

### Install the CLI

Since this is a fork (not published to npm), build and link locally:

```powershell
git clone https://github.com/mwh1987/skills-teleagent-fork.git
cd skills-teleagent-fork

$env:COREPACK_INTEGRITY_KEYS = "0"   # bypass corepack signature check
pnpm install
pnpm exec obuild
npm link                              # makes `skills` available globally
```

Verify: `skills --help` should print usage info.

### Install a Skill to TeleAgent

```bash
# From a GitHub repo
skills add vercel-labs/agent-skills -a teleagent -g

# A specific skill from a repo
skills add vercel-labs/agent-skills -s web-design-guidelines -a teleagent -g

# All skills in a repo
skills add vercel-labs/agent-skills --skill '*' -a teleagent -g

# From a local directory
skills add ./my-skill -a teleagent -g
```

Then **restart TeleAgent** — the skill appears in the skill manager.

### Manage Installed Skills

```bash
# List installed skills
skills list

# Update a skill
skills update my-skill -g

# Remove a skill (auto-cleans whitelist + lock)
skills remove my-skill -g
```

## Browse Skills

Discover skills at **[skills.sh](https://skills.sh)** — a community directory ranked by install count.

This fork also ships a built-in skill (`skills/find-skills`) that helps TeleAgent users search and install skills conversationally. Install it to your TeleAgent:

```bash
skills add ./skills/find-skills -a teleagent -g
```

## Supported Agents

This fork supports all 74 agents from the upstream CLI. TeleAgent is the 74th and the only one with post-install hooks; the other 73 behave exactly as upstream.

| Agent | `--agent` | Global path |
|-------|-----------|-------------|
| TeleAgent | `teleagent` | `~/.config/TeleAgent/skills/` |
| Claude Code | `claude-code` | `~/.claude/skills/` |
| Cursor | `cursor` | `~/.cursor/skills/` |
| Codex | `codex` | `~/.codex/skills/` |
| OpenCode | `opencode` | `~/.config/opencode/skills/` |
| ...and 69 more | | |

Run `skills list -a '*'` to see all agents, or check the [upstream README](https://github.com/vercel-labs/skills#supported-agents) for the full table.

### Installing to Multiple Agents

```bash
# TeleAgent + Claude Code
skills add vercel-labs/agent-skills -a teleagent -a claude-code -g

# All detected agents
skills add vercel-labs/agent-skills -a '*' -g
```

## TeleAgent Frontmatter Schema

TeleAgent requires `SKILL.md` frontmatter to follow a strict schema. The post-install normalizer enforces these rules automatically, but skill authors should aim for compliance upfront:

**Allowed fields** (any others are stripped):

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Lowercase + hyphens, must match directory name |
| `description` | Yes | <= 1024 chars, no angle brackets |
| `name_cn` | Yes | Chinese display name (falls back to `name`) |
| `description_cn` | Yes | Chinese description (falls back to `description`) |
| `create_source` | No | Auto-injected as `skillhub-import` if missing |
| `license` | No | SPDX identifier |
| `allowed-tools` | No | Tool restrictions |
| `metadata` | No | Arbitrary metadata object |

```yaml
---
name: my-skill
description: Brief description of what the skill does
name_cn: 我的技能
description_cn: 技能功能简介
create_source: skillhub-import
---
```

## Differences from Upstream

| Area | Upstream (`vercel-labs/skills`) | This fork |
|------|-------------------------------|-----------|
| Agents | 73 | 74 (adds `teleagent`) |
| Post-install hooks | Not supported | `postInstall`/`postRemove` hook system |
| TeleAgent config | Manual editing | Automatic whitelist + lock sync |
| Frontmatter | As-is | Auto-normalized to TeleAgent schema |
| Windows checks | None | Warns on `.sh` scripts & Unix commands |
| Node engine | `>=22` | `>=20.18.0` (TeleAgent runtime) |

All upstream commands (`add`, `remove`, `update`, `list`, `find`, `use`, `init`) work identically. The fork is additive — it never changes behavior for the other 73 agents.

## Project Layout

```
skills-teleagent-fork/
├── src/
│   ├── agents.ts              # Agent registry (teleagent entry + hook runners)
│   ├── teleagent-hooks.ts     # TeleAgent post-install/remove hook logic
│   ├── frontmatter.ts         # YAML frontmatter parser (BOM-safe)
│   ├── add.ts                 # `skills add` command
│   ├── remove.ts              # `skills remove` command
│   └── types.ts               # AgentType, PostInstallContext, etc.
├── tests/
│   └── teleagent-hooks.test.ts # 52 unit tests for hook logic
├── skills/
│   └── find-skills/           # Built-in skill for TeleAgent users
├── scripts/
│   └── sync-agents.ts         # README/keyword generator
└── package.json
```

## Development

```powershell
# Install dependencies
$env:COREPACK_INTEGRITY_KEYS = "0"
pnpm install

# Build
pnpm exec obuild

# Type-check
pnpm exec tsc --noEmit

# Run TeleAgent hook tests
pnpm exec vitest run tests/teleagent-hooks.test.ts

# Run all tests (note: some require network/git access)
pnpm exec vitest run
```

## Related Links

- [Upstream repo](https://github.com/vercel-labs/skills)
- [Agent Skills Specification](https://agentskills.io)
- [Skills Directory](https://skills.sh)
- [Vercel Agent Skills Repository](https://github.com/vercel-labs/agent-skills)

## License

MIT

> AI生成