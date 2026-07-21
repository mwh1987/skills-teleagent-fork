/**
 * Unit tests for TeleAgent post-install / post-remove hooks.
 *
 * Covers:
 *  - stripJsonComments (JSONC parsing: comments, trailing commas, strings)
 *  - normalizeSkillFrontmatter (BOM, missing frontmatter, missing fields,
 *    non-standard fields, long description, angle brackets, idempotency)
 *  - cleanupUnrelatedDocs (removes known doc files, preserves others)
 *  - checkWindowsCompatibility (warns on .sh scripts & Unix commands)
 *  - readConfig / writeConfig (missing file, JSONC, corrupted, round-trip)
 *  - readLock / writeLock (missing file, corrupted, empty skills)
 *  - teleagentPostInstall (whitelist + lock + frontmatter, idempotency)
 *  - teleagentPostRemove (cleans config + lock)
 *
 * All TeleAgent paths are redirected to a temp directory via the
 * SKILLS_TELEAGENT_TEST_DIR env var so tests never touch the real
 * ~/.config/TeleAgent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

type TeleAgentModule = typeof import('../src/teleagent-hooks.ts');

let tmpDir: string;
let mod: TeleAgentModule;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'teleagent-test-'));
  vi.stubEnv('SKILLS_TELEAGENT_TEST_DIR', tmpDir);
  vi.resetModules();
  mod = await import('../src/teleagent-hooks.ts');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(tmpDir, { recursive: true, force: true });
});

function configPath(): string {
  return join(tmpDir, 'TeleAgent', 'TeleAgent.jsonc');
}
function lockPath(): string {
  return join(tmpDir, 'TeleAgent', 'skills', '.skills_store_lock.json');
}

// ---------------------------------------------------------------------------

describe('stripJsonComments', () => {
  it('removes line comments', () => {
    const input = '{\n  "a": 1 // comment\n}';
    expect(JSON.parse(mod.stripJsonComments(input))).toEqual({ a: 1 });
  });

  it('removes block comments', () => {
    const input = '{\n  /* block */ "a": 1\n}';
    expect(JSON.parse(mod.stripJsonComments(input))).toEqual({ a: 1 });
  });

  it('removes multi-line block comments', () => {
    const input = '{\n  /*\n   * multi\n   * line\n   */\n  "a": 1\n}';
    expect(JSON.parse(mod.stripJsonComments(input))).toEqual({ a: 1 });
  });

  it('does not remove comment markers inside string literals', () => {
    const input = '{"url": "https://example.com/path /* not a comment */"}';
    expect(JSON.parse(mod.stripJsonComments(input))).toEqual({
      url: 'https://example.com/path /* not a comment */',
    });
  });

  it('handles double-slash inside strings', () => {
    const input = '{"path": "a//b"}';
    expect(JSON.parse(mod.stripJsonComments(input))).toEqual({ path: 'a//b' });
  });

  it('removes trailing commas before } and ]', () => {
    const input = '{"a": 1, "b": [1, 2, 3,],}';
    expect(JSON.parse(mod.stripJsonComments(input))).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it('handles escaped quotes in strings', () => {
    const input = '{"msg": "she said \\"hi\\" // not comment"}';
    expect(JSON.parse(mod.stripJsonComments(input))).toEqual({
      msg: 'she said "hi" // not comment',
    });
  });

  it('handles single-quoted strings', () => {
    const input = "{'a': 'b//c'}";
    const result = mod.stripJsonComments(input);
    // Single-quoted string content is preserved — // must not be treated as a comment.
    expect(result).toContain('b//c');
  });

  it('returns plain text unchanged when no comments', () => {
    const input = '{"a": 1}';
    expect(JSON.parse(mod.stripJsonComments(input))).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------

describe('normalizeSkillFrontmatter', () => {
  async function setupSkill(content: string): Promise<string> {
    const skillDir = join(tmpDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), content, 'utf-8');
    return skillDir;
  }

  async function readSkill(skillDir: string): Promise<string> {
    return readFile(join(skillDir, 'SKILL.md'), 'utf-8');
  }

  it('synthesizes frontmatter when none exists', async () => {
    const skillDir = await setupSkill('# My Skill\n\nSome content.');
    const changed = mod.normalizeSkillFrontmatter(skillDir);
    expect(changed).toBe(true);

    const result = await readSkill(skillDir);
    expect(result.startsWith('---\n')).toBe(true);
    expect(result).toContain('name: my-skill');
    expect(result).toContain('name_cn: my-skill');
    expect(result).toContain('create_source: skillhub-import');
    expect(result).toContain('# My Skill\n\nSome content.');
  });

  it('strips UTF-8 BOM and normalizes', async () => {
    const bom = '\uFEFF';
    const content = bom + '---\nname: my-skill\ndescription: A skill\n---\n# Body\n';
    const skillDir = await setupSkill(content);
    const changed = mod.normalizeSkillFrontmatter(skillDir);
    expect(changed).toBe(true);

    const result = await readSkill(skillDir);
    expect(result.charCodeAt(0)).not.toBe(0xfeff);
    expect(result.startsWith('---\n')).toBe(true);
  });

  it('fills missing name_cn and description_cn', async () => {
    const content = '---\nname: my-skill\ndescription: Test skill\n---\n# Body\n';
    const skillDir = await setupSkill(content);
    mod.normalizeSkillFrontmatter(skillDir);

    const result = await readSkill(skillDir);
    expect(result).toContain('name_cn: my-skill');
    expect(result).toContain('description_cn: Test skill');
  });

  it('injects create_source when missing', async () => {
    const content =
      '---\nname: my-skill\ndescription: Test\nname_cn: 技能\ndescription_cn: 测试\n---\n# Body\n';
    const skillDir = await setupSkill(content);
    mod.normalizeSkillFrontmatter(skillDir);

    const result = await readSkill(skillDir);
    expect(result).toContain('create_source: skillhub-import');
  });

  it('preserves existing create_source', async () => {
    const content =
      '---\nname: my-skill\ndescription: Test\nname_cn: 技能\ndescription_cn: 测试\ncreate_source: super-agent-skill-creator\n---\n# Body\n';
    const skillDir = await setupSkill(content);
    mod.normalizeSkillFrontmatter(skillDir);

    const result = await readSkill(skillDir);
    expect(result).toContain('create_source: super-agent-skill-creator');
    expect(result).not.toContain('create_source: skillhub-import');
  });

  it('removes non-standard fields', async () => {
    const content =
      '---\nname: my-skill\ndescription: Test\nname_cn: 技能\ndescription_cn: 测试\nhomepage: https://example.com\nauthor: someone\nversion: 1.0\n---\n# Body\n';
    const skillDir = await setupSkill(content);
    mod.normalizeSkillFrontmatter(skillDir);

    const result = await readSkill(skillDir);
    expect(result).not.toContain('homepage');
    expect(result).not.toContain('author');
    expect(result).not.toContain('version:');
  });

  it('truncates description exceeding 1024 chars', async () => {
    const longDesc = 'x'.repeat(1200);
    const content = `---\nname: my-skill\ndescription: ${longDesc}\n---\n# Body\n`;
    const skillDir = await setupSkill(content);
    mod.normalizeSkillFrontmatter(skillDir);

    const result = await readSkill(skillDir);
    // Find the description line and check length (excluding "..." suffix, <= 1024)
    const match = result.match(/^description: (.+)$/m);
    expect(match).not.toBeNull();
    const desc = match![1];
    expect(desc.length).toBeLessThanOrEqual(1024);
    expect(desc.endsWith('...')).toBe(true);
  });

  it('strips angle brackets from description', async () => {
    const content = '---\nname: my-skill\ndescription: Use <script> and <div> tags\n---\n# Body\n';
    const skillDir = await setupSkill(content);
    mod.normalizeSkillFrontmatter(skillDir);

    const result = await readSkill(skillDir);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('<div>');
  });

  it('forces name to match directory name', async () => {
    const content = '---\nname: wrong-name\ndescription: Test\n---\n# Body\n';
    const skillDir = await setupSkill(content);
    mod.normalizeSkillFrontmatter(skillDir);

    const result = await readSkill(skillDir);
    expect(result).toContain('name: my-skill');
    expect(result).not.toContain('name: wrong-name');
  });

  it('returns false when frontmatter is already valid', async () => {
    const content =
      '---\nname: my-skill\ndescription: Test\nname_cn: 技能\ndescription_cn: 测试\ncreate_source: skillhub-import\n---\n# Body\n';
    const skillDir = await setupSkill(content);
    const changed = mod.normalizeSkillFrontmatter(skillDir);
    expect(changed).toBe(false);
  });

  it('is idempotent: second call returns false', async () => {
    const content = '# My Skill\n\nNo frontmatter.';
    const skillDir = await setupSkill(content);
    expect(mod.normalizeSkillFrontmatter(skillDir)).toBe(true);
    expect(mod.normalizeSkillFrontmatter(skillDir)).toBe(false);
  });

  it('returns false when SKILL.md does not exist', () => {
    const skillDir = join(tmpDir, 'nonexistent');
    expect(mod.normalizeSkillFrontmatter(skillDir)).toBe(false);
  });

  it('returns false for unparseable frontmatter', async () => {
    // Invalid YAML: tab indentation + malformed mapping
    const content = '---\nname: my-skill\n\tbad: : :\n---\n# Body\n';
    const skillDir = await setupSkill(content);
    const changed = mod.normalizeSkillFrontmatter(skillDir);
    expect(changed).toBe(false);
  });

  it('preserves body content verbatim', async () => {
    const body = '# Title\n\n## Section\n\n- item 1\n- item 2\n\n```js\nconst x = 1;\n```\n';
    const content = '---\nname: my-skill\ndescription: Test\n---\n' + body;
    const skillDir = await setupSkill(content);
    mod.normalizeSkillFrontmatter(skillDir);

    const result = await readSkill(skillDir);
    expect(result).toContain(body);
  });
});

// ---------------------------------------------------------------------------

describe('cleanupUnrelatedDocs', () => {
  it('removes known documentation files', async () => {
    const skillDir = join(tmpDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# Skill', 'utf-8');
    await writeFile(join(skillDir, 'README.md'), 'readme', 'utf-8');
    await writeFile(join(skillDir, 'LICENSE'), 'license', 'utf-8');
    await writeFile(join(skillDir, 'CHANGELOG.md'), 'changelog', 'utf-8');

    const removed = mod.cleanupUnrelatedDocs(skillDir);
    expect(removed).toContain('README.md');
    expect(removed).toContain('LICENSE');
    expect(removed).toContain('CHANGELOG.md');
    expect(existsSync(join(skillDir, 'README.md'))).toBe(false);
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
  });

  it('preserves non-doc files', async () => {
    const skillDir = join(tmpDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# Skill', 'utf-8');
    await writeFile(join(skillDir, 'script.js'), 'code', 'utf-8');
    await writeFile(join(skillDir, 'data.json'), '{}', 'utf-8');

    const removed = mod.cleanupUnrelatedDocs(skillDir);
    expect(removed).toEqual([]);
    expect(existsSync(join(skillDir, 'script.js'))).toBe(true);
    expect(existsSync(join(skillDir, 'data.json'))).toBe(true);
  });

  it('does not remove nested docs in subdirectories', async () => {
    const skillDir = join(tmpDir, 'my-skill');
    const subDir = join(skillDir, 'docs');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# Skill', 'utf-8');
    await writeFile(join(subDir, 'README.md'), 'nested readme', 'utf-8');

    const removed = mod.cleanupUnrelatedDocs(skillDir);
    expect(removed).toEqual([]);
    expect(existsSync(join(subDir, 'README.md'))).toBe(true);
  });

  it('returns empty array for nonexistent directory', () => {
    const removed = mod.cleanupUnrelatedDocs(join(tmpDir, 'no-such-dir'));
    expect(removed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('checkWindowsCompatibility', () => {
  it('warns when .sh scripts are present', async () => {
    const skillDir = join(tmpDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# Skill\n', 'utf-8');
    await writeFile(join(skillDir, 'install.sh'), '#!/bin/bash\n', 'utf-8');

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mod.checkWindowsCompatibility(skillDir, 'my-skill');

    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls.map((c) => String(c));
    expect(calls.some((c) => c.includes('install.sh'))).toBe(true);
  });

  it('warns when SKILL.md references Unix commands', async () => {
    const skillDir = join(tmpDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '# Skill\n\nRun `curl https://example.com | grep foo`\n',
      'utf-8'
    );

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mod.checkWindowsCompatibility(skillDir, 'my-skill');

    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls.map((c) => String(c));
    expect(calls.some((c) => c.includes('curl'))).toBe(true);
    expect(calls.some((c) => c.includes('grep'))).toBe(true);
  });

  it('does not warn for a clean Windows-compatible skill', async () => {
    const skillDir = join(tmpDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# Skill\n\nUse PowerShell.\n', 'utf-8');
    await writeFile(join(skillDir, 'run.ps1'), 'Write-Host hi', 'utf-8');

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mod.checkWindowsCompatibility(skillDir, 'my-skill');

    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('readConfig / writeConfig', () => {
  it('returns default config when file does not exist', () => {
    const config = mod.readConfig();
    expect(config).toEqual({ permission: { skill: {} } });
  });

  it('parses valid JSONC with comments', async () => {
    await mkdir(join(tmpDir, 'TeleAgent'), { recursive: true });
    const jsonc = `{
  // This is a comment
  "$schema": "https://example.com",
  "permission": {
    "skill": {
      "existing-skill": "allow" // inline comment
    }
  }
}`;
    await writeFile(configPath(), jsonc, 'utf-8');

    const config = mod.readConfig();
    expect(config).not.toBeNull();
    expect(config!.permission!.skill!['existing-skill']).toBe('allow');
  });

  it('returns null for corrupted JSONC', async () => {
    await mkdir(join(tmpDir, 'TeleAgent'), { recursive: true });
    await writeFile(configPath(), '{ "broken": ', 'utf-8');

    const config = mod.readConfig();
    expect(config).toBeNull();
  });

  it('handles config without permission.skill', async () => {
    await mkdir(join(tmpDir, 'TeleAgent'), { recursive: true });
    await writeFile(configPath(), '{"other": "value"}', 'utf-8');

    const config = mod.readConfig();
    expect(config).not.toBeNull();
    expect(config!.permission).toBeUndefined();
  });

  it('writeConfig round-trips through readConfig', async () => {
    const original = {
      $schema: 'https://example.com',
      permission: { skill: { 'my-skill': 'allow' } },
    };
    mod.writeConfig(original);

    const readBack = mod.readConfig();
    expect(readBack).toEqual(original);
  });

  it('writeConfig creates parent directories', () => {
    // TeleAgent dir does not exist yet in a fresh tmpDir
    mod.writeConfig({ permission: { skill: { 'new-skill': 'allow' } } });
    expect(existsSync(configPath())).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('readLock / writeLock', () => {
  it('returns empty lock when file does not exist', () => {
    const lock = mod.readLock();
    expect(lock).toEqual({ version: 1, skills: {} });
  });

  it('parses a valid lock file', async () => {
    await mkdir(join(tmpDir, 'TeleAgent', 'skills'), { recursive: true });
    const lockContent = {
      version: 1,
      skills: {
        'my-skill': {
          name: 'my-skill',
          zip_url: '',
          source: 'skills-cli',
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    };
    await writeFile(lockPath(), JSON.stringify(lockContent), 'utf-8');

    const lock = mod.readLock();
    expect(lock.skills['my-skill']).toBeDefined();
    expect(lock.skills['my-skill'].installedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns empty lock for corrupted JSON', async () => {
    await mkdir(join(tmpDir, 'TeleAgent', 'skills'), { recursive: true });
    await writeFile(lockPath(), '{"broken": ', 'utf-8');

    const lock = mod.readLock();
    expect(lock).toEqual({ version: 1, skills: {} });
  });

  it('handles lock missing skills key', async () => {
    await mkdir(join(tmpDir, 'TeleAgent', 'skills'), { recursive: true });
    await writeFile(lockPath(), '{"version": 1}', 'utf-8');

    const lock = mod.readLock();
    expect(lock.skills).toEqual({});
  });

  it('writeLock round-trips through readLock', () => {
    const original = {
      version: 1,
      skills: {
        'test-skill': {
          name: 'test-skill',
          zip_url: '',
          source: 'skills-cli',
          version: '1.0.0',
          installedAt: '2026-07-21T00:00:00.000Z',
        },
      },
    };
    mod.writeLock(original);

    const readBack = mod.readLock();
    expect(readBack).toEqual(original);
  });

  it('writeLock creates parent directories', () => {
    mod.writeLock({ version: 1, skills: {} });
    expect(existsSync(lockPath())).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('teleagentPostInstall', () => {
  async function setupSkill(name: string, skillContent: string): Promise<string> {
    const skillDir = join(tmpDir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
    return skillDir;
  }

  it('does nothing for non-global installs', async () => {
    const skillDir = await setupSkill('my-skill', '# Skill');
    await mod.teleagentPostInstall({
      skillName: 'my-skill',
      isGlobal: false,
      installPath: skillDir,
    });

    expect(existsSync(configPath())).toBe(false);
    expect(existsSync(lockPath())).toBe(false);
  });

  it('whitelists skill in config and writes lock entry', async () => {
    const skillDir = await setupSkill('my-skill', '# My Skill\n\nNo frontmatter.');
    await mod.teleagentPostInstall({
      skillName: 'my-skill',
      isGlobal: true,
      installPath: skillDir,
    });

    const config = JSON.parse(await readFile(configPath(), 'utf-8'));
    expect(config.permission.skill['my-skill']).toBe('allow');

    const lock = JSON.parse(await readFile(lockPath(), 'utf-8'));
    expect(lock.skills['my-skill']).toBeDefined();
    expect(lock.skills['my-skill'].installedAt).toBeTruthy();
  });

  it('normalizes SKILL.md frontmatter on install', async () => {
    const skillDir = await setupSkill('my-skill', '# My Skill\n\nNo frontmatter.');
    await mod.teleagentPostInstall({
      skillName: 'my-skill',
      isGlobal: true,
      installPath: skillDir,
    });

    const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
    expect(skillMd.startsWith('---\n')).toBe(true);
    expect(skillMd).toContain('create_source: skillhub-import');
  });

  it('removes unrelated docs on install', async () => {
    const skillDir = await setupSkill('my-skill', '# My Skill');
    await writeFile(join(skillDir, 'README.md'), 'readme', 'utf-8');
    await writeFile(join(skillDir, 'LICENSE'), 'license', 'utf-8');

    await mod.teleagentPostInstall({
      skillName: 'my-skill',
      isGlobal: true,
      installPath: skillDir,
    });

    expect(existsSync(join(skillDir, 'README.md'))).toBe(false);
    expect(existsSync(join(skillDir, 'LICENSE'))).toBe(false);
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
  });

  it('is idempotent: multiple installs do not create duplicate entries', async () => {
    const skillDir = await setupSkill('my-skill', '# My Skill');
    const ctx = { skillName: 'my-skill', isGlobal: true, installPath: skillDir };

    for (let i = 0; i < 3; i++) {
      await mod.teleagentPostInstall(ctx);
    }

    const config = JSON.parse(await readFile(configPath(), 'utf-8'));
    expect(Object.keys(config.permission.skill)).toEqual(['my-skill']);

    const lock = JSON.parse(await readFile(lockPath(), 'utf-8'));
    expect(Object.keys(lock.skills)).toEqual(['my-skill']);
  });

  it('refreshes installedAt on re-install', async () => {
    const skillDir = await setupSkill('my-skill', '# My Skill');
    const ctx = { skillName: 'my-skill', isGlobal: true, installPath: skillDir };

    await mod.teleagentPostInstall(ctx);
    const lock1 = JSON.parse(await readFile(lockPath(), 'utf-8'));
    const ts1 = lock1.skills['my-skill'].installedAt;

    // Small delay to ensure timestamp differs if it refreshes.
    await new Promise((r) => setTimeout(r, 50));
    await mod.teleagentPostInstall(ctx);
    const lock2 = JSON.parse(await readFile(lockPath(), 'utf-8'));
    const ts2 = lock2.skills['my-skill'].installedAt;

    expect(ts2).not.toBe(ts1);
  });

  it('preserves other skills in config and lock', async () => {
    // Pre-populate config with an existing skill.
    await mkdir(join(tmpDir, 'TeleAgent'), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        permission: { skill: { 'existing-skill': 'allow' } },
      }),
      'utf-8'
    );
    await mkdir(join(tmpDir, 'TeleAgent', 'skills'), { recursive: true });
    await writeFile(
      lockPath(),
      JSON.stringify({
        version: 1,
        skills: {
          'existing-skill': {
            name: 'existing-skill',
            zip_url: '',
            source: 'skills-cli',
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      'utf-8'
    );

    const skillDir = await setupSkill('new-skill', '# New Skill');
    await mod.teleagentPostInstall({
      skillName: 'new-skill',
      isGlobal: true,
      installPath: skillDir,
    });

    const config = JSON.parse(await readFile(configPath(), 'utf-8'));
    expect(config.permission.skill['existing-skill']).toBe('allow');
    expect(config.permission.skill['new-skill']).toBe('allow');

    const lock = JSON.parse(await readFile(lockPath(), 'utf-8'));
    expect(lock.skills['existing-skill']).toBeDefined();
    expect(lock.skills['new-skill']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe('teleagentPostRemove', () => {
  it('does nothing for non-global removes', async () => {
    // Pre-populate config & lock.
    await mkdir(join(tmpDir, 'TeleAgent', 'skills'), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({ permission: { skill: { 'my-skill': 'allow' } } }),
      'utf-8'
    );
    await writeFile(
      lockPath(),
      JSON.stringify({
        version: 1,
        skills: {
          'my-skill': {
            name: 'my-skill',
            zip_url: '',
            source: 'skills-cli',
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      'utf-8'
    );

    await mod.teleagentPostRemove({ skillName: 'my-skill', isGlobal: false });

    const config = JSON.parse(await readFile(configPath(), 'utf-8'));
    expect(config.permission.skill['my-skill']).toBe('allow');
  });

  it('removes skill from config and lock', async () => {
    await mkdir(join(tmpDir, 'TeleAgent', 'skills'), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        permission: { skill: { 'my-skill': 'allow', 'other-skill': 'allow' } },
      }),
      'utf-8'
    );
    await writeFile(
      lockPath(),
      JSON.stringify({
        version: 1,
        skills: {
          'my-skill': {
            name: 'my-skill',
            zip_url: '',
            source: 'skills-cli',
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
          },
          'other-skill': {
            name: 'other-skill',
            zip_url: '',
            source: 'skills-cli',
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      'utf-8'
    );

    await mod.teleagentPostRemove({ skillName: 'my-skill', isGlobal: true });

    const config = JSON.parse(await readFile(configPath(), 'utf-8'));
    expect(config.permission.skill['my-skill']).toBeUndefined();
    expect(config.permission.skill['other-skill']).toBe('allow');

    const lock = JSON.parse(await readFile(lockPath(), 'utf-8'));
    expect(lock.skills['my-skill']).toBeUndefined();
    expect(lock.skills['other-skill']).toBeDefined();
  });

  it('handles removing a skill that does not exist', async () => {
    await mkdir(join(tmpDir, 'TeleAgent', 'skills'), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({ permission: { skill: { 'other-skill': 'allow' } } }),
      'utf-8'
    );
    await writeFile(
      lockPath(),
      JSON.stringify({
        version: 1,
        skills: {
          'other-skill': {
            name: 'other-skill',
            zip_url: '',
            source: 'skills-cli',
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      'utf-8'
    );

    // Should not throw.
    await mod.teleagentPostRemove({ skillName: 'nonexistent-skill', isGlobal: true });

    const config = JSON.parse(await readFile(configPath(), 'utf-8'));
    expect(config.permission.skill['other-skill']).toBe('allow');
  });
});
