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

function run(entry, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(entry.command, entry.args || [], {
        env: { ...process.env, ...(entry.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      return reject(e);
    }

    let errBuf = '';
    let buf = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch {}
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
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1 && m.result) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (m.id === 2 && m.result && m.result.tools) {
          done = true; clearTimeout(timer);
          try { child.kill(); } catch {}
          resolve({ serverInfo: m.result.serverInfo || null, tools: (m.result.tools || []).map(t => t.name), capabilities: m.result.capabilities || null });
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
    const exp = r.capabilities && r.capabilities.experimental;
    if (exp && Object.keys(exp).length) {
      console.warn('⚠️ 服务器广播了非标准 capabilities.experimental:', JSON.stringify(exp));
      console.warn('   严格宿主（如 WorkBuddy）可能拒绝并报 Invalid input（路径 capabilities.experimental.*）。');
      if (a.harden) {
        const installDir = entry.args && entry.args[0] ? path.dirname(entry.args[0]) : null;
        if (!installDir || !fs.existsSync(path.join(installDir, 'package.json'))) {
          console.warn('⚠️ 无法从 entry.args 定位安装目录，跳过自动剥离');
        } else {
          const n = lib.hardenCapabilities(installDir);
          console.log(n ? `🔧 已剥离 ${n} 个文件中的 experimental 广播` : '（未找到可剥离的 experimental 广播）');
          let pj = {}; try { pj = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf8')); } catch {}
          if (pj.scripts && pj.scripts.build) { console.log('重新编译...'); spawnSync('npm', ['run', 'build'], { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' }); }
          console.log('重新握手验证...');
          const r2 = await run(entry, timeoutMs);
          if (r2.capabilities && r2.capabilities.experimental && Object.keys(r2.capabilities.experimental).length) console.warn('⚠️ 剥离后仍有 experimental，请手动排查');
          else console.log('✅ 剥离后自检通过');
        }
      } else {
        console.log('   如需自动剥离，加 --harden 重跑本命令（已知包也可走 scaffold 的 curated 补丁）。');
      }
    }
  } catch (e) {
    console.error('❌ 握手失败:', e.message);
    process.exit(1);
  }
}
main();
