#!/usr/bin/env node

/* mcp-config-wizard · Copyright 2026 hupan · SPDX-License-Identifier: Apache-2.0
 * https://github.com/Philip0910732123/mcp-config-wizard
 * 再分发或更名分发须保留本声明与仓库地址（见 LICENSE.txt / NOTICE.txt）。
 * fingerprint: MCPWIZ-FP-2026-HUPAN-7C41 */
// spawn-safe.js — 跨平台启动 stdio MCP 子进程（纯 Node，无依赖）
//
// 为什么需要它：Windows 上 `npx` / `npm` / `bunx` 不是 exe，而是 .cmd 批处理垫片。
// 两条路都有坑：
//   a) 不开 shell：Node 直接 CreateProcess(".cmd") → ENOENT / EINVAL，压根起不来。
//   b) 开 shell：Node 把 [cmd, ...args] 用空格拼成一行交给 cmd.exe，**参数不再有边界**，
//      于是 "C:\Program Files\x.js" 被切成两段，`--with mcp<2.0` 里的 < 被当成重定向符
//      吞掉后面的参数（NCBI 这类必须带 `<` 的配置会静默失败）。
//
// 本模块的策略是「能不开 shell 就不开」：
//   1. 有 .exe 就用绝对路径直接起；
//   2. npx / npm 这类已知垫片，绕过 .cmd，直接用 process.execPath 跑它内部真正的
//      CLI 脚本（node_modules/npm/bin/npx-cli.js）——语义与垫片完全一致，但参数逐字保真；
//   3. 其余 .cmd / .bat 才退回 cmd.exe，并用「逐参数引号 + 元字符转义」把实参粘回去。
//
// 附带：parseArgList() 负责把命令行里的 --args 字符串解析成数组，
// 支持 JSON 数组写法（推荐，含空格/特殊字符时唯一可靠的写法）与带引号的空格分词。

const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';

// npm 垫片 → 真正的 CLI 入口（相对垫片所在目录的 node_modules）
const NPM_CLI = {
  npx: 'npx-cli.js',
  npm: 'npm-cli.js'
};

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * 在 PATH 里定位可执行文件（Windows 会按 PATHEXT 补扩展名）。
 * 找不到返回 null——调用方据此给出可诊断的错误，而不是抛一个裸 ENOENT。
 */
function whichSync(cmd) {
  if (!cmd) return null;
  const s = String(cmd);
  if (/[\\/]/.test(s)) return isFile(s) ? s : null;

  const dirs = String(process.env.PATH || process.env.Path || '')
    .split(path.delimiter).filter(Boolean);

  if (!IS_WIN) {
    for (const d of dirs) {
      const p = path.join(d, s);
      if (isFile(p)) return p;
    }
    return null;
  }

  const exts = String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';').map(x => x.trim()).filter(Boolean);
  const hasExt = ext => exts.some(e => s.toLowerCase().endsWith(e.toLowerCase()));

  for (const d of dirs) {
    // 已带扩展名（npx.cmd）时先原样试，避免拼成 npx.cmd.EXE
    if (hasExt(s) || path.extname(s)) {
      const p = path.join(d, s);
      if (isFile(p)) return p;
    }
    for (const e of exts) {
      const p = path.join(d, s + e);
      if (isFile(p)) return p;
    }
  }
  return null;
}

/**
 * 已知 npm 系垫片 → 它实际执行的那个 JS 文件。
 * 依据 npx.cmd 的实现：`"%~dp0\node.exe" "%~dp0\node_modules\npm\bin\npx-cli.js" %*`
 */
function resolveNpmCli(shimPath) {
  const base = path.basename(shimPath).toLowerCase().replace(/\.(cmd|bat|exe)$/, '');
  const cli = NPM_CLI[base];
  if (!cli) return null;
  const dir = path.dirname(shimPath);
  const cands = [
    path.join(dir, 'node_modules', 'npm', 'bin', cli),
    path.join(dir, '..', 'node_modules', 'npm', 'bin', cli),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', cli) // *nix 全局布局，兜底
  ];
  if (process.execPath) {
    cands.push(path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', cli));
  }
  return cands.find(isFile) || null;
}

/**
 * 为 cmd.exe 转义单个参数：包引号 + 转义内部引号与结尾反斜杠。
 * 关键点：**不能**再转义 & | < > ^ —— 这些在双引号内本来就是字面量，
 * 多补一个 ^ 反而会把 ^ 写进实参（实测：mcp<2.0 会变成 mcp^<2.0）。
 * 只在走 cmd.exe 兜底路径时使用。
 */
function quoteForCmd(arg) {
  let s = String(arg);
  // 内部引号：前置反斜杠加倍，再补一个 \" 
  s = s.replace(/(\\*)"/g, '$1$1\\"');
  // 结尾反斜杠：加倍，避免吃掉闭合引号
  s = s.replace(/(\\*)$/, '$1$1');
  return '"' + s + '"';
}

/**
 * 计算启动方式。返回可直接喂给 child_process.spawn 的三元组。
 * @param {string} command  例如 "npx" / "node" / "C:\\...\\uv.exe"
 * @param {string[]} args
 * @returns {{command:string,args:string[],options:object,via:string,note?:string}}
 */
function buildSpawn(command, args) {
  const argv = (args || []).map(a => String(a));

  if (!IS_WIN) {
    return { command, args: argv, options: {}, via: 'direct' };
  }

  const resolved = whichSync(command);

  if (!resolved) {
    const err = new Error(
      `找不到可执行文件：${command}\n` +
      `   已按 PATH + PATHEXT 查找，未命中。常见原因：\n` +
      `   a) 该命令没装（npx 随 Node 安装，uvx 随 uv 安装）；\n` +
      `   b) 装了但没进 PATH（刚装完需要重开终端）；\n` +
      `   c) 配置里写的是别名（如 "python" 实际只有 "py"）。\n` +
      `   当前 PATH 前 3 项：${String(process.env.PATH || '').split(path.delimiter).slice(0, 3).join(' | ')}`
    );
    err.code = 'COMMAND_NOT_FOUND';
    throw err;
  }

  // 1) 真 exe：直接用绝对路径，参数逐字传递
  if (/\.exe$/i.test(resolved) || !/\.(cmd|bat)$/i.test(resolved)) {
    return { command: resolved, args: argv, options: {}, via: 'direct' };
  }

  // 2) npm 系垫片：绕过 .cmd，用当前 node 跑它的 CLI 脚本
  const cli = resolveNpmCli(resolved);
  if (cli) {
    return {
      command: process.execPath,
      args: [cli, ...argv],
      options: {},
      via: 'npm-cli',
      note: `${path.basename(resolved)} → node ${path.basename(cli)}`
    };
  }

  // 3) 其他 .cmd / .bat：交给 cmd.exe，逐参数转义
  //    /s 会剥掉整行最外层的一对引号，所以整行必须再包一层引号，否则第一条命令的引号会被吃掉。
  const line = [quoteForCmd(resolved), ...argv.map(quoteForCmd)].join(' ');
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true },
    via: 'cmd',
    note: `${path.basename(resolved)} 只能通过 cmd.exe 启动，参数已逐项转义`
  };
}

/**
 * 把 --args 的字符串解析成参数数组。
 * 优先按 JSON 数组解析（唯一能无损表达含空格、引号、<>&| 的写法）；
 * 否则按 shell 习惯分词（支持单/双引号，反斜杠转义引号）。
 */
function parseArgList(raw) {
  if (raw === undefined || raw === null || raw === true) return [];
  const s = String(raw).trim();
  if (!s) return [];

  if (s.startsWith('[')) {
    let v;
    try {
      v = JSON.parse(s);
    } catch (e) {
      throw new Error(
        `--args 看起来是 JSON 数组但解析失败：${e.message}\n` +
        `   正确写法：--args '["-y","@scope/pkg@1.2.3","--flag","值 带空格"]'\n` +
        `   注意外层用单引号，内部一律双引号，不要写成对象。`
      );
    }
    if (!Array.isArray(v)) throw new Error('--args 的 JSON 必须是数组，例如 ["-y","pkg"]');
    return v.map(String);
  }

  // 带引号的分词
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && (s[i + 1] === quote || s[i + 1] === '\\')) { cur += s[++i]; continue; }
      if (c === quote) { quote = null; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (/\s/.test(c)) {
      if (has || cur) { out.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += c;
    has = true;
  }
  if (quote) throw new Error(`--args 的引号没有闭合：${s}\n   含空格的值建议改用 JSON 数组写法。`);
  if (has || cur) out.push(cur);
  return out;
}

module.exports = { buildSpawn, whichSync, parseArgList, quoteForCmd, IS_WIN };
