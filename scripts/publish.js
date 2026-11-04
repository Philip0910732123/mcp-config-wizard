#!/usr/bin/env node

/* mcp-config-wizard · Copyright 2026 hupan · SPDX-License-Identifier: Apache-2.0
 * https://github.com/Philip0910732123/mcp-config-wizard
 * 再分发或更名分发须保留本声明与仓库地址（见 LICENSE.txt / NOTICE.txt）。
 * fingerprint: MCPWIZ-FP-2026-HUPAN-7C41 */
'use strict';
/**
 * publish.js — 维护者发版工具（不随技能分发：打包时自动排除自身）
 *
 * 作用：把「本地技能目录」打成干净副本后发布到 skillhub.cn。核心是解决两个反复出现的问题：
 *   1) 平台拒收 .gitignore（400: 不允许的文件类型）——原来要手动临时移出再移回，容易忘。
 *      这里改成复制到临时目录时直接排除，源目录一个字节都不动。
 *   2) 版本号漂移——SKILL.md / skill.manifest.json / git tag 三处不一致时，先报错再发。
 *
 * 用法：
 *   node scripts/publish.js                       # 用当前版本，changelog 自动从 CHANGELOG.md 抽取
 *   node scripts/publish.js --dry-run             # 只在本地预检 + 打印将要上传的文件清单
 *   node scripts/publish.js --changelog "手动写的更新说明"
 *   node scripts/publish.js --keep                # 保留临时暂存目录，便于人工核对
 *
 * 参数：
 *   --version <x.y.z>   仅允许「与文件内版本一致」；不一致直接失败（防漂移，--force 可绕过）
 *   --changelog <文本>   不传则从 CHANGELOG.md 的 ## [<版本>] 段落自动提取
 *   --max-chars <n>     自动提取的 changelog 截断长度，默认 400（平台列表页展示，不宜过长）
 *   --dry-run           透传给 CLI：只做本地校验与打包，不发 HTTP
 *   --json              透传给 CLI：JSON 输出
 *   --keep              保留暂存目录
 *   --force             跳过版本一致性校验
 *   --python <path>     指定 python（默认探测 WorkBuddy 自带 env）
 *   --cli <path>        指定 skills_store_cli.py
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SKILL_DIR = path.resolve(__dirname, '..');

// 维护者工具：只在本机用，绝不随包分发（用户拿了用不上，且含本机专属路径）
const MAINTAINER_FILES = new Set(['publish.js', 'release.sh', 'stress_test.sh']);

// 打包时排除：开发期文件、版本控制产物、维护者工具
const EXCLUDE_DIRS = new Set(['.git', '.github', 'node_modules', '__pycache__', '.idea', '.vscode']);
const EXCLUDE_FILES = new Set([
  '.gitignore',
  '.gitattributes',
  '.DS_Store',
  'Thumbs.db',
  ...MAINTAINER_FILES
]);
const EXCLUDE_SUFFIX = ['.log', '.tmp', '.bak', '.pyc'];

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`
};

function die(msg) {
  console.error(C.red('✗ ') + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { a[key] = next; i++; } else { a[key] = true; }
  }
  return a;
}

/** 读 SKILL.md front matter 里的 version: */
function readSkillVersion() {
  const p = path.join(SKILL_DIR, 'SKILL.md');
  if (!fs.existsSync(p)) die('找不到 SKILL.md（发布根目录必须是技能目录）');
  const head = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').slice(0, 4000);
  const m = head.match(/^version:\s*["']?([0-9]+\.[0-9]+\.[0-9]+[^"'\s]*)["']?\s*$/m);
  return m ? m[1] : null;
}

function readManifestVersion() {
  const p = path.join(SKILL_DIR, 'skill.manifest.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')).version || null;
  } catch {
    die('skill.manifest.json 不是合法 JSON，先修好再发版');
  }
}

/** 从 CHANGELOG.md 抽取某个版本的正文，压成一段平台可读的 changelog */
function extractChangelog(version, maxChars) {
  const p = path.join(SKILL_DIR, 'CHANGELOG.md');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const startIdx = lines.findIndex((l) => new RegExp(`^##\\s*\\[${version.replace(/\./g, '\\.')}\\]`).test(l));
  if (startIdx < 0) return null;
  const body = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }

  const clean = (s) =>
    s
      .replace(/\*\*/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

  // 逐行切成块：bullet（含其续行）/ para（独立段落，常是本版摘要或分区标题）
  const blocks = [];
  let prevBlank = true;
  for (const raw of body) {
    const line = raw.trim();
    if (!line) { prevBlank = true; continue; }
    const isBullet = /^[-*]\s+/.test(line);
    if (isBullet) {
      blocks.push({ type: 'bullet', text: clean(line.replace(/^[-*]\s+/, '')) });
    } else if (!prevBlank && blocks.length && blocks[blocks.length - 1].type === 'bullet') {
      // 紧跟要点、无空行的普通行 = 该要点的续行
      blocks[blocks.length - 1].text += clean(line);
    } else {
      blocks.push({ type: 'para', text: clean(line) });
    }
    prevBlank = false;
  }

  const trimEnd = (s) => s.replace(/[。；;：]\s*$/, '');
  // 每个块变成「完整带标点的一节」，按整节累积，避免截断切在句子中间
  const chunks = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    const nextIsBullet = !!(next && next.type === 'bullet');
    if (b.type === 'para') {
      chunks.push(trimEnd(b.text) + (nextIsBullet ? '：' : '。'));
    } else {
      chunks.push(trimEnd(b.text) + (nextIsBullet ? '；' : '。'));
    }
  }

  let text = '';
  let truncated = false;
  for (const c of chunks) {
    // 软上限：至少收一节（哪怕它自己就超长），之后只要已超预算就停
    if (text && text.length >= maxChars) { truncated = true; break; }
    text += c;
  }
  if (!text) return null;
  if (truncated) text = trimEnd(text) + '…';
  return text.trim();
}

function git(args) {
  const r = spawnSync('git', args, { cwd: SKILL_DIR, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

/** 选一个真的能写的暂存根目录：环境变量被裁剪时 os.tmpdir() 可能指向不可写的 C:\WINDOWS\temp */
function resolveStageRoot() {
  const candidates = [os.tmpdir(), path.join(os.homedir(), '.cache', 'mw-publish'), SKILL_DIR];
  for (const c of candidates) {
    try {
      fs.mkdirSync(c, { recursive: true });
      fs.accessSync(c, fs.constants.W_OK);
      return c;
    } catch {
      /* 换下一个 */
    }
  }
  die('找不到可写的临时目录，可用 TMPDIR 指定');
}

/** 探测 python：显式参数 > 环境变量 > WorkBuddy 自带 env > PATH */
function resolvePython(explicit) {
  if (explicit) return explicit;
  if (process.env.SKILLHUB_PYTHON) return process.env.SKILLHUB_PYTHON;
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'envs', 'default', 'Scripts', 'python.exe'));
  } else {
    candidates.push(path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'envs', 'default', 'bin', 'python'));
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function resolveCli(explicit) {
  if (explicit) return explicit;
  if (process.env.SKILLHUB_CLI) return process.env.SKILLHUB_CLI;
  const p = path.join(os.homedir(), '.skillhub', 'skills_store_cli.py');
  if (!fs.existsSync(p)) die(`找不到 skillhub CLI：${p}\n  用 --cli <path> 指定，或先安装 skillhub CLI。`);
  return p;
}

/** 把技能目录复制到临时暂存目录，排除开发期文件 */
function stage(stageDir) {
  fs.mkdirSync(stageDir, { recursive: true });
  fs.cpSync(SKILL_DIR, stageDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(SKILL_DIR, src);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      if (parts.some((p) => EXCLUDE_DIRS.has(p))) return false;
      const base = parts[parts.length - 1];
      if (EXCLUDE_FILES.has(base)) return false;
      if (EXCLUDE_SUFFIX.some((suf) => base.endsWith(suf))) return false;
      return true;
    }
  });
  const list = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else list.push(path.relative(stageDir, full).split(path.sep).join('/'));
    }
  })(stageDir);

  // 兜底断言：维护者工具漏进包就中止发版，宁可发不出去也不要分发给用户
  const leaked = list.filter((f) => MAINTAINER_FILES.has(path.basename(f)));
  if (leaked.length) {
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch {}
    die(`维护者工具混进了发布包：${leaked.join(', ')}\n    → 检查 EXCLUDE_FILES 是否漏了它（${path.join(SKILL_DIR, 'scripts', path.basename(leaked[0]))}）`);
  }

  return list.sort();
}

function main() {
  const a = parseArgs(process.argv.slice(2));

  const fileVer = readSkillVersion();
  const manVer = readManifestVersion();
  if (!fileVer) die('SKILL.md front matter 里没有 version:，先补上再发版');

  const version = a.version || fileVer;
  let failed = false;

  console.log(C.bold('\n=== 发版前校验 ==='));
  console.log(`  SKILL.md        ${fileVer}`);
  console.log(`  manifest.json   ${manVer || C.dim('(无)')}`);
  console.log(`  本次发布         ${version}`);

  if (!a.force) {
    if (manVer && manVer !== fileVer) {
      console.error(C.red('✗ ') + `版本不一致：SKILL.md=${fileVer}，skill.manifest.json=${manVer}`);
      failed = true;
    }
    if (a.version && a.version !== fileVer) {
      console.error(C.red('✗ ') + `--version ${a.version} 与文件内版本 ${fileVer} 不一致（防版本漂移；确需强制用 --force）`);
      failed = true;
    }
  }
  if (failed) process.exit(1);

  // git tag 是版本权威源：缺 tag 只告警，不阻断（可能先发平台再补 tag）
  const localTag = git(['rev-parse', '--verify', '--quiet', `v${version}`]);
  const remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/v${version}`]);
  if (!localTag) {
    console.log(C.yellow('  ⚠ 本地无 tag v' + version) + C.dim('（发完记得 git tag + push）'));
  } else if (!remoteTag) {
    console.log(C.yellow('  ⚠ tag v' + version + ' 尚未推到远端'));
  } else {
    console.log(C.green('  ✓ tag v' + version + ' 已在本地与远端'));
  }
  const dirty = git(['status', '--porcelain']);
  if (dirty) console.log(C.yellow('  ⚠ 工作区有未提交改动') + C.dim('（发布的是磁盘上的当前内容）'));

  // changelog
  let changelog = a.changelog;
  if (!changelog || changelog === 'auto') {
    const maxChars = Number(a['max-chars'] || 400);
    changelog = extractChangelog(version, maxChars);
    if (!changelog) {
      console.log(C.yellow(`  ⚠ CHANGELOG.md 里没找到 [${version}] 段落，平台将不带更新说明`) );
    } else {
      console.log(C.dim(`  changelog（自动提取 ${changelog.length} 字）：${changelog}`));
    }
  } else {
    console.log(C.dim(`  changelog（手填 ${changelog.length} 字）`));
  }

  // 暂存打包（源目录不改动，.gitignore 在此被排除）
  const stageDir = path.join(resolveStageRoot(), `mw-publish-${version}-${Date.now()}`);
  const files = stage(stageDir);
  console.log(C.bold(`\n=== 待上传文件（${files.length}）===`));
  for (const f of files) console.log('  ' + f);
  console.log(C.dim(`  已排除维护者工具：${[...MAINTAINER_FILES].join(', ')}（仅本机使用，不随包分发）`));

  const py = resolvePython(a.python);
  const cli = resolveCli(a.cli);
  const cliArgs = [cli, 'publish', stageDir, '--version', version];
  if (changelog) cliArgs.push('--changelog', changelog);
  if (a['dry-run']) cliArgs.push('--dry-run');
  if (a.json) cliArgs.push('--json');

  console.log(C.bold('\n=== 调用 skillhub CLI ==='));
  console.log(C.dim(`  ${py} ${cliArgs.slice(0, 3).join(' ')} …`));
  const r = spawnSync(py, cliArgs, {
    stdio: 'inherit',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  });

  if (!a.keep) {
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch {}
  } else {
    console.log(C.dim(`\n暂存目录保留：${stageDir}`));
  }

  if (r.status !== 0) {
    console.error(C.red(`\n✗ 发布失败（退出码 ${r.status}）`));
    process.exit(r.status || 1);
  }

  console.log(C.green('\n✓ 发布命令执行成功'));
  if (!a['dry-run']) {
    console.log(C.dim('  下一步：确认平台审核通过后，线上 latestVersion 才会更新；'));
    console.log(C.dim('  若本次是提交后才发布，别忘了 git push 与 GitHub Release。'));
  }
}

main();
