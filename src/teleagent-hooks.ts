/**
 * TeleAgent post-install / post-remove hooks.
 *
 * TeleAgent requires skills to be explicitly whitelisted in
 * `~/.config/TeleAgent/TeleAgent.jsonc` under `permission.skill` before the
 * agent will load them. These hooks keep that whitelist in sync with the
 * skills CLI's install / remove lifecycle so a `skills add -g` is immediately
 * usable inside TeleAgent with no manual config editing.
 *
 * Additionally, TeleAgent maintains its own lock file at
 * `~/.config/TeleAgent/skills/.skills_store_lock.json` which the TeleAgent UI
 * reads to display installed skills. We sync this file too, so skills
 * installed via the skills CLI are visible in the TeleAgent skill manager.
 *
 * Beyond bookkeeping, TeleAgent requires SKILL.md frontmatter to follow a
 * strict schema (name, description, name_cn, description_cn, create_source,
 * license, allowed-tools, metadata). External skills (e.g. from
 * vercel-labs/agent-skills) frequently lack name_cn / description_cn or
 * carry non-standard fields that cause TeleAgent validation to fail. We
 * normalize frontmatter in-place so the installed skill loads on first try.
 *
 * Finally, we run a Windows compatibility check (warn on .sh scripts /
 * Unix-only commands) and remove unrelated doc files (README.md, CHANGELOG.md,
 * LICENSE) that TeleAgent's validator rejects.
 *
 * Only global installs touch these files; project-scoped installs are
 * expected to be governed by project-level configuration.
 */

import { join, basename } from 'path';
import { homedir } from 'os';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import { xdgConfig } from 'xdg-basedir';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { PostInstallContext, PostRemoveContext } from './types.ts';

const home = homedir();
const configHome = xdgConfig ?? join(home, '.config');
// Allow tests to redirect all TeleAgent paths to a temp directory without
// touching the real ~/.config/TeleAgent. In production this env var is unset.
const teleagentDir = process.env.SKILLS_TELEAGENT_TEST_DIR
  ? join(process.env.SKILLS_TELEAGENT_TEST_DIR, 'TeleAgent')
  : join(configHome, 'TeleAgent');
const teleagentConfigPath = join(teleagentDir, 'TeleAgent.jsonc');
const teleagentSkillsDir = join(teleagentDir, 'skills');
const teleagentLockPath = join(teleagentSkillsDir, '.skills_store_lock.json');

// ---------------------------------------------------------------------------
// JSONC parsing (handles // and /* */ comments + trailing commas safely)
// ---------------------------------------------------------------------------

/**
 * Strip JSONC comments and trailing commas from raw text.
 * String-aware: will not remove comment markers that appear inside string literals.
 * Handles line comments (double-slash) and block comments (slash-star ... star-slash).
 */
export function stripJsonComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = '';

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (inString) {
      result += char;
      // Handle escape sequences
      if (char === '\\' && i + 1 < text.length) {
        result += next;
        i += 2;
        continue;
      }
      // End of string
      if (char === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    // Start of string
    if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
      result += char;
      i++;
      continue;
    }

    // Remove line comments (double-slash to end of line)
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }

    // Remove block comments (slash-star to star-slash)
    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    result += char;
    i++;
  }

  // Remove trailing commas before } or ]
  return result.replace(/,(\s*[}\]])/g, '$1');
}

// ---------------------------------------------------------------------------
// TeleAgent.jsonc permission whitelist
// ---------------------------------------------------------------------------

interface TeleAgentConfig {
  $schema?: string;
  mcp?: Record<string, unknown>;
  permission?: {
    skill?: Record<string, string>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Read & parse TeleAgent.jsonc.
 * Handles JSONC line comments and block comments, plus trailing commas.
 * Returns null if the file cannot be parsed (caller should skip the update
 * rather than risk corrupting the file).
 */
export function readConfig(): TeleAgentConfig | null {
  if (!existsSync(teleagentConfigPath)) {
    return { permission: { skill: {} } };
  }
  const raw = readFileSync(teleagentConfigPath, 'utf-8');
  try {
    const cleaned = stripJsonComments(raw);
    return JSON.parse(cleaned) as TeleAgentConfig;
  } catch {
    // Cannot parse — do not modify the file to avoid corruption.
    return null;
  }
}

/** Write config back with consistent 2-space formatting. */
export function writeConfig(config: TeleAgentConfig): void {
  mkdirSync(teleagentDir, { recursive: true });
  writeFileSync(teleagentConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// TeleAgent local lock file (~/.config/TeleAgent/skills/.skills_store_lock.json)
// ---------------------------------------------------------------------------

interface TeleAgentLock {
  version: number;
  skills: Record<string, TeleAgentLockEntry>;
}

interface TeleAgentLockEntry {
  name: string;
  zip_url: string;
  source: string;
  version: string;
  installedAt: string;
}

export function readLock(): TeleAgentLock {
  if (!existsSync(teleagentLockPath)) {
    return { version: 1, skills: {} };
  }
  try {
    const raw = readFileSync(teleagentLockPath, 'utf-8');
    const parsed = JSON.parse(raw) as TeleAgentLock;
    if (!parsed.skills) parsed.skills = {};
    return parsed;
  } catch {
    return { version: 1, skills: {} };
  }
}

export function writeLock(lock: TeleAgentLock): void {
  mkdirSync(teleagentSkillsDir, { recursive: true });
  writeFileSync(teleagentLockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// SKILL.md frontmatter normalization (issue #5)
// ---------------------------------------------------------------------------

/**
 * Fields TeleAgent recognizes in SKILL.md frontmatter.
 * Anything outside this set causes validation to fail and the skill to be
 * invisible in the skill manager UI.
 */
const FRONTMATTER_ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'name_cn',
  'description_cn',
  'create_source',
  'license',
  'allowed-tools',
  'metadata',
]);

/** Max length TeleAgent accepts for the description field. */
const DESCRIPTION_MAX_LENGTH = 1024;

/**
 * Normalize SKILL.md frontmatter to meet TeleAgent requirements:
 *  - Strip UTF-8 BOM if present (Windows editors often add it).
 *  - If no frontmatter block exists, synthesize one from the directory name
 *    and file content so the skill is not silently invisible in TeleAgent.
 *  - Ensure `name` matches the install directory name (lowercase + kebab-case).
 *  - Ensure `name_cn` and `description_cn` exist (fallback to name/description).
 *  - Inject `create_source: skillhub-import` when missing (TeleAgent UI maps
 *    this to the "本地导入" label — same as skills installed via SkillHub).
 *  - Remove non-standard fields (e.g. homepage, version at top-level, author).
 *  - Truncate `description` to <=1024 chars and strip angle brackets.
 *
 * The body of SKILL.md is preserved verbatim. Returns true if the file was
 * rewritten, false if no change was needed or the file could not be parsed.
 */
export function normalizeSkillFrontmatter(skillDir: string): boolean {
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) return false;

  // Strip BOM so the /^---/ anchor can match.
  const rawWithBom = readFileSync(skillMdPath, 'utf-8');
  const hadBom = rawWithBom.charCodeAt(0) === 0xfeff;
  const raw = hadBom ? rawWithBom.slice(1) : rawWithBom;
  const dirName = basename(skillDir);

  // Match frontmatter delimited by --- lines. Tolerate CRLF.
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  let data: Record<string, unknown>;
  let body: string;

  if (match) {
    // Existing frontmatter — parse it.
    try {
      data = (parseYaml(match[1]!) as Record<string, unknown>) ?? {};
    } catch {
      // Unparseable frontmatter — don't risk corrupting the file.
      return false;
    }
    body = match[2] ?? '';
  } else {
    // No frontmatter block — synthesize one from the directory name.
    // The entire file becomes the body.
    data = {};
    body = raw;
  }

  // BOM removal or frontmatter synthesis always requires a rewrite.
  let modified = hadBom || !match;

  // 1. Force name to match directory name.
  if (data.name !== dirName) {
    data.name = dirName;
    modified = true;
  }

  // 2. Ensure description exists and conforms.
  if (typeof data.description !== 'string' || data.description.length === 0) {
    data.description = dirName;
    modified = true;
  } else {
    let desc = data.description;
    if (desc.length > DESCRIPTION_MAX_LENGTH) {
      desc = desc.slice(0, DESCRIPTION_MAX_LENGTH - 3) + '...';
    }
    // TeleAgent rejects angle brackets in description.
    if (/[<>]/.test(desc)) {
      desc = desc.replace(/[<>]/g, '');
    }
    if (desc !== data.description) {
      data.description = desc;
      modified = true;
    }
  }

  // 3. name_cn fallback to name.
  if (typeof data.name_cn !== 'string' || data.name_cn.length === 0) {
    data.name_cn = data.name;
    modified = true;
  }

  // 4. description_cn fallback to description.
  if (typeof data.description_cn !== 'string' || data.description_cn.length === 0) {
    data.description_cn = data.description;
    modified = true;
  }

  // 5. Inject create_source if missing. Preserve existing values (e.g.
  //    super-agent-skill-creator) — only fill in when absent.
  if (typeof data.create_source !== 'string' || data.create_source.length === 0) {
    data.create_source = 'skillhub-import';
    modified = true;
  }

  // 6. Remove non-standard fields.
  for (const key of Object.keys(data)) {
    if (!FRONTMATTER_ALLOWED_FIELDS.has(key)) {
      delete data[key];
      modified = true;
    }
  }

  if (!modified) return false;

  // Reconstruct SKILL.md: frontmatter + blank line + original body.
  const newFrontmatter = stringifyYaml(data).trimEnd();
  const newRaw = `---\n${newFrontmatter}\n---\n\n${body}`;
  writeFileSync(skillMdPath, newRaw, 'utf-8');
  return true;
}

// ---------------------------------------------------------------------------
// Windows compatibility check (issue #6 / SkillHub Step 4)
// ---------------------------------------------------------------------------

/** Unix-only shell commands commonly referenced in skill docs. */
const UNIX_COMMANDS = [
  'curl ',
  'grep ',
  'sed ',
  'awk ',
  'bash ',
  '/bin/',
  'chmod ',
  'cat ',
  'find ',
  'tac ',
];

/** Files whose presence suggests a Unix-centric skill. */
const UNIX_SCRIPT_EXTENSIONS = ['.sh', '.bash', '.zsh'];

/**
 * Scan the skill directory for Windows-incompatible artifacts (.sh scripts,
 * Unix command references in SKILL.md). Emit console.warn for each finding
 * so the user is aware before trying to use the skill on Windows.
 *
 * Non-fatal: we only warn, never block the install.
 */
export function checkWindowsCompatibility(skillDir: string, skillName: string): void {
  const warnings: string[] = [];

  // Scan for .sh / .bash / .zsh scripts anywhere in the skill tree.
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(fullPath);
      } else if (UNIX_SCRIPT_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        warnings.push(`Unix shell script found: ${fullPath}`);
      }
    }
  }
  walk(skillDir);

  // Scan SKILL.md for Unix command references.
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (existsSync(skillMdPath)) {
    const content = readFileSync(skillMdPath, 'utf-8').replace(/^\uFEFF/, '');
    for (const cmd of UNIX_COMMANDS) {
      if (content.includes(cmd)) {
        warnings.push(`SKILL.md references Unix command "${cmd.trim()}"`);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn(
      `[skills] TeleAgent postInstall: "${skillName}" may not be Windows-compatible. ${warnings.length} finding(s):`
    );
    for (const w of warnings) {
      console.warn(`  - ${w}`);
    }
    console.warn('  Consider rewriting shell scripts as .ps1 or .py for Windows.');
  }
}

// ---------------------------------------------------------------------------
// Unrelated document cleanup (issue #6 / SkillHub Step 6)
// ---------------------------------------------------------------------------

/**
 * Files TeleAgent's skill validator rejects when present in a skill directory.
 * They are leftover documentation from upstream repos and are not needed for
 * the skill to function — removing them avoids validation failures.
 */
const UNRELATED_DOC_FILES = new Set([
  'README.md',
  'README.markdown',
  'README',
  'CHANGELOG.md',
  'CHANGELOG',
  'CHANGES.md',
  'HISTORY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'NOTICE',
  'NOTICE.md',
]);

/**
 * Remove unrelated documentation files from the skill directory root.
 * Only the root level is cleaned — nested docs in subdirectories are left
 * alone to avoid deleting reference material the skill itself may link to.
 */
export function cleanupUnrelatedDocs(skillDir: string): string[] {
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(skillDir);
  } catch {
    return removed;
  }
  for (const entry of entries) {
    if (UNRELATED_DOC_FILES.has(entry)) {
      const fullPath = join(skillDir, entry);
      try {
        const st = statSync(fullPath);
        if (st.isFile()) {
          unlinkSync(fullPath);
          removed.push(entry);
        }
      } catch {
        // Ignore — best-effort cleanup.
      }
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Hook implementations
// ---------------------------------------------------------------------------

export async function teleagentPostInstall(ctx: PostInstallContext): Promise<void> {
  // Only register for global installs.
  if (!ctx.isGlobal) return;

  // ctx.installPath points to the canonical skill directory. For TeleAgent
  // global installs the skills CLI copies files into teleagentSkillsDir/<name>
  // before this hook fires, so we normalize that copy in place.
  const skillDir = ctx.installPath ?? join(teleagentSkillsDir, ctx.skillName);

  // 1. Update permission whitelist in TeleAgent.jsonc
  const config = readConfig();
  if (config) {
    if (!config.permission) config.permission = {};
    if (!config.permission.skill) config.permission.skill = {};

    // Idempotent: skip the write when the skill is already whitelisted.
    if (config.permission.skill[ctx.skillName] !== 'allow') {
      config.permission.skill[ctx.skillName] = 'allow';
      writeConfig(config);
    }
  }

  // 2. Update local lock file so the skill appears in TeleAgent's skill manager.
  //    Always update installedAt so `skills update` refreshes the timestamp
  //    (update calls add internally, which re-triggers this hook).
  const lock = readLock();
  lock.skills[ctx.skillName] = {
    name: ctx.skillName,
    zip_url: '',
    source: 'skills-cli',
    version: '1.0.0',
    installedAt: new Date().toISOString(),
  };
  writeLock(lock);

  // 3. Normalize SKILL.md frontmatter so TeleAgent can load the skill.
  //    This fills in name_cn / description_cn, injects create_source, and
  //    strips non-standard fields — the most common reason a skill installs
  //    but does not show up in the TeleAgent UI.
  try {
    const changed = normalizeSkillFrontmatter(skillDir);
    if (changed) {
      console.warn(
        `[skills] TeleAgent postInstall: normalized frontmatter for "${ctx.skillName}".`
      );
    }
  } catch (e) {
    console.warn(
      `[skills] TeleAgent postInstall: frontmatter normalization failed for "${ctx.skillName}": ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // 4. Remove unrelated documentation files that TeleAgent's validator rejects.
  try {
    const removed = cleanupUnrelatedDocs(skillDir);
    if (removed.length > 0) {
      console.warn(
        `[skills] TeleAgent postInstall: removed ${removed.length} unrelated doc file(s) from "${ctx.skillName}": ${removed.join(', ')}`
      );
    }
  } catch (e) {
    console.warn(
      `[skills] TeleAgent postInstall: doc cleanup failed for "${ctx.skillName}": ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // 5. Windows compatibility check — warn-only, never blocks install.
  try {
    checkWindowsCompatibility(skillDir, ctx.skillName);
  } catch (e) {
    console.warn(
      `[skills] TeleAgent postInstall: Windows compatibility check failed for "${ctx.skillName}": ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export async function teleagentPostRemove(ctx: PostRemoveContext): Promise<void> {
  if (!ctx.isGlobal) return;

  // 1. Remove from permission whitelist
  const config = readConfig();
  if (config?.permission?.skill?.[ctx.skillName]) {
    delete config.permission.skill[ctx.skillName];
    writeConfig(config);
  }

  // 2. Remove from local lock file
  const lock = readLock();
  if (lock.skills[ctx.skillName]) {
    delete lock.skills[ctx.skillName];
    writeLock(lock);
  }
}
