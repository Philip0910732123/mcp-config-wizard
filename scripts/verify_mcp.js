#!/usr/bin/env node
// verify_mcp.js — 对 stdio 型 MCP 做握手冒烟测试（纯 Node，无依赖）
// 用法见 SKILL.md。

const { spawn } = require('child_process');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      a[k] = v;
    }
  }
  return a;
}

function resolveFromMcpJson(name, mcpPath) {
  if (!fs.existsSync(mcpPath)) throw new Error(`mcp.json 不存在: ${mcpPath}`);
  // 剥掉可能的 UTF-8 BOM（﻿），否则 JSON.parse 会报错
  const raw = fs.readFileSync(mcpPath, 'utf8').replace(/^\uFEFF/, '');
  const data = JSON.parse(raw);
  const entry = data.mcpServers && data.mcpServers[name];
  if (!entry) throw new Error(`mcp.json 中找不到 "${name}"`);
  if (!entry.command) throw new Error(`"${name}" 不是 stdio 类型（无 command），无法做握手测试`);
  return entry;
}

// 中文 Windows 上宿主拉起 Python 子进程时，stdout/stderr 默认是 GBK(cp936)。
// 只要服务端往这两条流里打印 emoji 或无法编码成 GBK 的字符，Python 就会抛
// UnicodeEncodeError 并在握手完成前退出，客户端只看到 "-32000: Connection closed"。
// 手动在终端里跑通常不崩（终端是 UTF-8），所以最容易被误判成"配置没问题"。
const PY_ENV = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const GBK_ENV = { PYTHONIOENCODING: 'gbk', PYTHONUTF8: '0', PYTHONLEGACYWINDOWSSTDIO: '1' };

function looksPython(entry) {
  const c = String(entry.command || '').toLowerCase();
  if (c.includes('python') || c.includes('uv')) return true;
  const a0 = String((entry.args && entry.args[0]) || '');
  return /\.py$/i.test(a0);
}

function run(entry, timeoutMs, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(entry.command, entry.args || [], {
        env: { ...process.env, ...(entry.env || {}), ...(opts.envOverride || {}) },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      return reject(e);
    }

    let errBuf = '';
    let buf = '';
    let done = false;
    // stdout 里不符合 JSON-RPC 的行 = 协议流被污染（例如启动横幅打到了 stdout）
    const polluted = [];

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch {}
      if (/UnicodeEncodeError/i.test(errBuf)) {
        const m = errBuf.match(/UnicodeEncodeError.*$/m);
        return reject(new Error(
          `进程在握手前崩溃：Windows 编码问题（GBK 无法打印 emoji / 中文符号）。\n` +
          `   报错：${(m ? m[0] : errBuf).slice(0, 220)}\n` +
          `   修法（任一即可）：\n` +
          `     a) 在 mcp.json 该条目的 env 里加 "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"\n` +
          `     b) 改源码：把启动时 print 到 stdout 的 emoji/中文改成纯 ASCII，并输出到 sys.stderr\n` +
          `   注意：在 Git Bash / 终端里手动跑同一份代码通常不报错（终端是 UTF-8），这不代表宿主里没问题。`
        ));
      }
      reject(new Error(`超时（${timeoutMs}ms 无响应）。可能原因：包名错/缺 bin/env 没配/node 不在 PATH。stderr: ${errBuf.slice(-500)}`));
    }, timeoutMs);

    child.stderr.on('data', d => { errBuf += d.toString(); });
    child.on('error', e => { if (!done) { done = true; clearTimeout(timer); reject(e); } });

    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');

    child.stdout.on('data', d => {
      if (done) return;
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { polluted.push(line); continue; }
        if (m.id === 1 && m.result) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (m.id === 2 && m.result && m.result.tools) {
          done = true; clearTimeout(timer);
          try { child.kill(); } catch {}
          resolve({ serverInfo: m.result.serverInfo || null, tools: (m.result.tools || []).map(t => t.name), capabilities: m.result.capabilities || null, polluted, stderr: errBuf });
        }
      }
    });

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-config-wizard-verify', version: '1.0' }
    }});
  });
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const timeoutMs = a.timeout ? parseInt(a.timeout, 10) : 30000;
  let entry;
  try {
    if (a.name) {
      const mcpPath = a['mcp-json'] || path.join(os.homedir(), '.workbuddy', 'mcp.json');
      entry = resolveFromMcpJson(a.name, mcpPath);
    } else if (a.command) {
      entry = { command: a.command, args: a.args ? a.args.split(/\s+/) : [], env: a.env ? JSON.parse(a.env) : {} };
    } else {
      console.error('用法: --name <serverName> [--mcp-json <p>] | --command <cmd> [--args <a>] [--env <json>]');
      process.exit(1);
    }
    const r = await run(entry, timeoutMs);
    console.log('✅ 握手成功');
    console.log('serverInfo:', JSON.stringify(r.serverInfo));
    console.log('tools:', r.tools.join(', ') || '(无工具)');
    if (r.capabilities) console.log('capabilities:', JSON.stringify(r.capabilities));
    if (r.polluted && r.polluted.length) {
      console.warn(`⚠️ stdout 被 ${r.polluted.length} 行非协议内容污染（协议流要求每行都是 JSON-RPC）：`);
      r.polluted.slice(0, 2).forEach(l => console.warn('   ' + l.slice(0, 120)));
      console.warn('   严格宿主可能因此解析失败或断连。应把这类输出改到 sys.stderr / console.error。');
    }
    const exp = r.capabilities && r.capabilities.experimental;
    if (exp && Object.keys(exp).length) {
      console.warn('⚠️ 服务器广播了非标准 capabilities.experimental:', JSON.stringify(exp));
      console.warn('   严格宿主（如 WorkBuddy）可能拒绝并报 Invalid input（路径 capabilities.experimental.*）。');
      if (a.harden) {
        const installDir = entry.args && entry.args[0] ? path.dirname(entry.args[0]) : null;
        const isPython = installDir && fs.existsSync(path.join(installDir, 'pyproject.toml'));
        const isNode = installDir && fs.existsSync(path.join(installDir, 'package.json'));
        if (!installDir || (!isPython && !isNode)) {
          console.warn('⚠️ 无法从 entry.args 定位安装目录（或既非 Node 也非 Python 包），跳过自动剥离');
        } else {
          const n = lib.hardenCapabilities(installDir);
          console.log(n ? `🔧 已剥离 ${n} 个文件中的 experimental 广播` : '（未找到可剥离的 experimental 广播）');
          if (isNode) {
            let pj = {}; try { pj = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf8')); } catch {}
            if (pj.scripts && pj.scripts.build) { console.log('重新编译...'); spawnSync('npm', ['run', 'build'], { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' }); }
          } else {
            console.log('（Python 包无需重新编译）');
          }
          console.log('重新握手验证...');
          const r2 = await run(entry, timeoutMs);
          if (r2.capabilities && r2.capabilities.experimental && Object.keys(r2.capabilities.experimental).length) console.warn('⚠️ 剥离后仍有 experimental，请手动排查');
          else console.log('✅ 剥离后自检通过');
        }
      } else {
        console.log('   如需自动剥离，加 --harden 重跑本命令（已知包也可走 scaffold 的 curated 补丁）。');
      }
    }
    // ---- Python 专项：GBK 模拟探测 ----
    // 目的是回答一个问题：这份源码在"别人机器上"能不能活。
    // 本机终端是 UTF-8，手工跑通不构成证据；必须强制 GBK 再握一次手。
    if (looksPython(entry) && !a['no-gbk']) {
      const probeMs = Math.min(timeoutMs, 20000);
      console.log('--- Python 编码探测（强制 GBK，模拟中文 Windows 宿主的最恶劣情况）---');
      const hasEnv = !!(entry.env && entry.env.PYTHONIOENCODING);
      if (!hasEnv) {
        console.warn('⚠️ 该条目没有注入 PYTHONIOENCODING=utf-8。若服务端打印非 GBK 字符（emoji/中文符号），');
        console.warn('   在实际宿主里会崩在握手前。建议补上 env: ' + JSON.stringify(PY_ENV));
      }
      try {
        await run(entry, probeMs, { envOverride: GBK_ENV });
        console.log('✅ 强制 GBK 仍能握手：源码本身 UTF-8 安全，无隐患');
      } catch (e2) {
        const msg = String((e2 && e2.message) || '');
        if (/UnicodeEncodeError/.test(msg)) {
          console.warn('⚠️ 源码在纯 GBK 环境会崩（UnicodeEncodeError），只能靠 env 兜底才能用。');
          console.warn('   本机配置带 env → 当前可用；但别人若照抄源码却漏配 env，就会看到 -32000: Connection closed。');
          console.warn('   彻底修法：把启动 banner / 日志里的 emoji 和中文改成纯 ASCII，并写到 sys.stderr。');
        } else {
          console.log('（GBK 模拟探测未完成：' + msg.split('\n')[0].slice(0, 90) + ' —— 不影响上面的结论）');
        }
      }
    }
  } catch (e) {
    console.error('❌ 握手失败:', e.message);
    process.exit(1);
  }
}
main();
