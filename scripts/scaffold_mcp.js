#!/usr/bin/env node
'use strict';
// scaffold_mcp.js — MCP 配置向导主脚本（纯 Node，无第三方依赖）
// 支持：云端 JSON/URL、本地包目录/zip、已有 index.js、自写骨架。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const lib = require('./lib');

function usage() {
  console.log(`MCP 配置向导 · scaffold_mcp.js

用法:
  node scaffold_mcp.js --name <服务名> <来源选项> [通用选项]

来源选项（五选一）:
  --from-url <url>          云端 MCP（streamableHttp），只给一个 URL
  --from-json <json|路径>   用户给的 JSON（含 mcpServers）或裸 URL 字符串
  --from-dir <目录>         本地 MCP 包目录（含 package.json），自动复制到安装目录
  --from-zip <zip>          本地 MCP 包 zip，解压后按目录处理
  --from-template           生成零依赖骨架（仅“自己新写 MCP”用；第三方服务禁用）
  --index <index.js路径>    已有 index.js

通用选项:
  --mcp-json <路径>         mcp.json 路径（默认 ~/.workbuddy/mcp.json）
  --api-key <key>           替换 URL/JSON 里的 {your_api_key} 等占位
  --env <json>              追加环境变量（如 '{"DB_USER":"u","DB_PASSWORD":"p"}'）
  --install-dir <目录>      本地包安装目录（默认 ~/.workbuddy/mcp-servers/<服务名>）
  --node <node路径>         command 用的 node（默认 "node"，可移植；仅当你确知目标机 PATH 无 node 时手动传绝对路径覆盖）
  --npm-install             本地包缺 node_modules 时执行 npm install（需联网）
  --overwrite               安装目录已存在时覆盖
  --dry-run                 只打印，不落盘（不复制、不安装）
  --self-check              写入后启动 MCP 做握手自检，检查服务器是否广播非标准 experimental 能力
  --harden                  自检发现非标准 experimental 广播时，自动剥离并重新编译（未知包可用；已知包已由 curated 补丁处理）

设计说明: 本地型 command 默认用可移植的裸 "node"（依赖宿主 PATH 解析）；
  脚本会识别目标平台（扩展点，当前支持 workbuddy）并预检 node 可达性，但不自动改写为绝对路径
  （以免跨机/跨平台分享失效）。如目标机 PATH 确无 node，请用 --node 手动指定绝对路径。
`);
}

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

const KEY_PATTERNS = [
  /\{your[_-]?api[_-]?key\}/gi,
  /<your[_-]?api[_-]?key>/gi,
  /\{\{?api[_-]?key\}?\}/gi,
  /__API_KEY__/g,
  /YOUR_API_KEY/g,
  /REPLACE_ME/g,
];
function subStr(s, key) { if (!key) return s; let r = s; for (const re of KEY_PATTERNS) r = r.replace(re, key); return r; }
function subDeep(v, key) {
  if (typeof v === 'string') return subStr(v, key);
  if (Array.isArray(v)) return v.map(x => subDeep(x, key));
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = subDeep(v[k], key); return o; }
  return v;
}
function hasPlaceholder(v) { return /(\{your[_-]?api[_-]?key\}|<your[_-]?api[_-]?key>|YOUR_API_KEY|__API_KEY__|REPLACE_ME)/i.test(JSON.stringify(v)); }

function defaultMcpJson() { return path.join(os.homedir(), '.workbuddy', 'mcp.json'); }
function defaultInstallDir(name) { return path.join(os.homedir(), '.workbuddy', 'mcp-servers', name); }

function readMcpJson(p) {
  if (!fs.existsSync(p)) return { mcpServers: {} };
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const j = JSON.parse(raw);
  if (!j.mcpServers) j.mcpServers = {};
  return j;
}
function writeMcpJson(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8'); }

function findPackageRoot(dir) {
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  let kids = []; try { kids = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of kids) {
    if (!e.isDirectory()) continue;
    const d1 = path.join(dir, e.name);
    if (fs.existsSync(path.join(d1, 'package.json'))) return d1;
    let k2 = []; try { k2 = fs.readdirSync(d1, { withFileTypes: true }); } catch { continue; }
    for (const e2 of k2) {
      if (!e2.isDirectory()) continue;
      const d2 = path.join(d1, e2.name);
      if (fs.existsSync(path.join(d2, 'package.json'))) return d2;
    }
  }
  return null;
}

function detectMain(root) {
  const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pj.main) return pj.main.replace(/^\.\//, '');
  for (const c of ['build/index.js', 'dist/index.js', 'index.js']) if (fs.existsSync(path.join(root, c))) return c;
  return 'index.js';
}

function resolveEnv(a) {
  let env = {};
  if (a.env) { try { env = JSON.parse(a.env); } catch (e) { throw new Error('--env JSON 解析失败: ' + e.message); } }
  return env;
}

// ——— 目标平台识别（扩展点）———
// 当前可识别 workbuddy / unknown。未来要支持 Codex / OpenCode / 豆包工作 等平台，
// 只需在此函数加分支（并可在对应分支里注入平台特有的配置策略）。
// 注意：本函数只做"识别 + 返回标签"，不直接决定 command 形态——
// command 默认统一用可移植的裸 "node"，以保证跨用户/跨平台分享最稳。
function detectTargetPlatform() {
  if (process.env.WORKBUDDY || process.env.WORKBUDDY_HOME) return 'workbuddy';
  try { if (fs.existsSync(path.join(os.homedir(), '.workbuddy'))) return 'workbuddy'; } catch { }
  return 'unknown';
}

// ——— node 预检（兜底，不改写 command）———
// 确认裸 "node" 在当前环境 PATH 可达。不可达时搜常见位置仅作"参考提示"，
// 默认仍输出裸 "node"（保持跨机/跨平台可移植）。绝对路径加固（--node 手动指定除外）
// 已按设计决定暂不自动执行，因为主流 AI 平台 spawn MCP 时基本都会提供 node。
function preflightNodeCheck() {
  const r = spawnSync('node', ['--version'], { encoding: 'utf8', shell: false });
  if (!r.error && r.status === 0) return { ok: true, version: (r.stdout || '').trim() || 'unknown' };
  const candidates = [];
  const home = os.homedir();
  const binName = process.platform === 'win32' ? 'node.exe' : 'node';
  const sub = process.platform === 'win32' ? (v => v) : (v => path.join('bin', 'node'));
  // WorkBuddy 托管 node
  try {
    const wb = path.join(home, '.workbuddy', 'binaries', 'node', 'versions');
    if (fs.existsSync(wb)) for (const v of fs.readdirSync(wb)) { const p = path.join(wb, v, sub(v)); if (fs.existsSync(p)) candidates.push(p); }
  } catch { }
  // nvm
  try {
    const nvm = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvm)) for (const v of fs.readdirSync(nvm)) { const p = path.join(nvm, v, sub(v)); if (fs.existsSync(p)) candidates.push(p); }
  } catch { }
  // 系统常见位置
  const sys = process.platform === 'win32'
    ? ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe']
    : ['/usr/local/bin/node', '/usr/bin/node', '/opt/node/bin/node'];
  for (const p of sys) { try { if (fs.existsSync(p)) candidates.push(p); } catch { } }
  return { ok: false, error: (r.error && r.error.message) || 'node --version 失败', candidates };
}

function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const r = spawnSync('unzip', ['-o', zip, '-d', dest], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    const cmd = `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`;
    const ps = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
    if (ps.error || ps.status !== 0) throw new Error('解压失败: ' + ((ps.stderr || r.stderr || '').toString().slice(0, 300)));
  }
}

// 编译源码包（如 TypeScript 的 tsc）：当入口文件不在 zip 内、但 package.json 有 build 脚本时调用
function buildIfNeeded(installDir, mainAbs, a) {
  if (fs.existsSync(mainAbs)) return true;
  const pjPath = path.join(installDir, 'package.json');
  let pj = {}; try { pj = JSON.parse(fs.readFileSync(pjPath, 'utf8')); } catch { }
  const buildScript = pj.scripts && pj.scripts.build;
  if (!buildScript) {
    console.warn('⚠️ 入口文件缺失且 package.json 无 build 脚本，MCP 将无法启动（请确认 main 指向正确，或提供含编译产物的包）。');
    return false;
  }
  console.log('🔧 检测到入口文件缺失但存在 build 脚本，开始编译源码包...');
  // 编译需要 typescript / esbuild 等 devDependencies
  if (!fs.existsSync(path.join(installDir, 'node_modules', 'typescript')) && !fs.existsSync(path.join(installDir, 'node_modules', 'esbuild'))) {
    console.log('执行 npm install（含 devDependencies，编译需要 typescript 等）...');
    const r = spawnSync('npm', ['install'], { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
    if (r.status !== 0) { console.warn('⚠️ npm install 失败，无法编译'); return false; }
  }
  console.log('执行 npm run build ...');
  const b = spawnSync('npm', ['run', 'build'], { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
  if (b.status !== 0) { console.warn('⚠️ npm run build 失败'); return false; }
  if (!fs.existsSync(mainAbs)) { console.warn('⚠️ 编译完成但入口文件仍未生成: ' + mainAbs); return false; }
  console.log('编译完成，入口已生成 ✅');
  return true;
}

// 安装本地包：复制到 installDir，检查/安装 node_modules，必要时编译
function installLocalPackage(root, name, a, dryRun) {
  const mainRel = detectMain(root);
  const mainAbs = path.join(root, mainRel);
  const installDir = a['install-dir'] || defaultInstallDir(name);
  const hasNM = fs.existsSync(path.join(root, 'node_modules'));
  // 判断是否需要编译：zip 内无入口文件、且 package.json 有 build 脚本
  let pj = {}; try { pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { }
  const needBuild = !fs.existsSync(mainAbs) && pj.scripts && pj.scripts.build;
  if (dryRun) {
    console.log(`[dry-run] 包根: ${root}`);
    console.log(`[dry-run] 将复制到: ${installDir}`);
    console.log(`[dry-run] 入口 main: ${mainRel}` + (needBuild ? '（zip 内缺失，将自动编译生成）' : ''));
    console.log(hasNM ? '[dry-run] 包内已含 node_modules ✅' : '[dry-run] ⚠️ 包内无 node_modules —— 运行前需 npm install（加 --npm-install）或提供含依赖的包');
    return { installDir, mainRel };
  }
  if (fs.existsSync(installDir) && !a.overwrite) throw new Error('安装目录已存在: ' + installDir + '（加 --overwrite 覆盖）');
  fs.mkdirSync(path.dirname(installDir), { recursive: true });
  fs.cpSync(root, installDir, { recursive: true });
  console.log('已复制包到:', installDir);
  // 应用 curated 补丁（preBuild：作用于源码，后续 build 会带上修复；幂等）
  let pkgName = null;
  try { pkgName = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf8')).name; } catch {}
  lib.applyPatches(installDir, pkgName, 'preBuild');
  if (!fs.existsSync(path.join(installDir, 'node_modules'))) {
    // 需要编译时即便用户没显式 --npm-install，也要装含 devDependencies 的完整依赖（typescript 等）
    if (a['npm-install'] || needBuild) {
      const args = needBuild ? ['install'] : ['install', '--omit=dev'];
      console.log(needBuild ? '缺 node_modules（且需编译），执行 npm install（含 devDependencies）...' : '缺 node_modules，执行 npm install --omit=dev ...');
      const r = spawnSync('npm', args, { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
      if (r.status !== 0) console.warn('⚠️ npm install 失败，请手动在该目录执行 npm install');
      else console.log('node_modules 安装完成 ✅');
    } else {
      console.warn('⚠️ 包内无 node_modules，MCP 将无法启动。加 --npm-install 允许安装，或提供含 node_modules 的完整包。');
    }
  } else {
    console.log('包内已含 node_modules ✅');
  }
  // 编译（如需要）
  buildIfNeeded(installDir, path.join(installDir, mainRel), a);
  // 应用 curated 补丁（postBuild：作用于 build 产物，如有需要）
  lib.applyPatches(installDir, pkgName, 'postBuild');
  return { installDir, mainRel, pkgName };
}

// 自检：启动 MCP，发 initialize，检查服务器返回的 capabilities（捕获非标准 experimental 广播）
function selfCheck(mainAbs, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(process.execPath, [mainAbs], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ ok: false, error: e.message }); }
    let buf = '', done = false;
    const timer = setTimeout(() => { if (done) return; done = true; try { child.kill(); } catch {} resolve({ ok: false, error: 'timeout' }); }, timeoutMs);
    child.stdout.on('data', d => {
      if (done) return; buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1 && m.result) {
          done = true; clearTimeout(timer); try { child.kill(); } catch {}
          resolve({ ok: true, capabilities: m.result.capabilities || null, serverInfo: m.result.serverInfo || null });
        } else if (m.id === 1 && m.error) {
          done = true; clearTimeout(timer); try { child.kill(); } catch {}
          resolve({ ok: false, error: JSON.stringify(m.error) });
        }
      }
    });
    child.on('error', e => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: e.message }); } });
    // 自检只探测「服务器是否在响应里广播 experimental」，因此客户端请求保持干净（capabilities:{}）。
    // 旧实现会在请求里塞 experimental 客户端能力（且值为布尔），新版 SDK(>=1.25) 服务器会严格校验
    // 客户端能力并拒绝非法值，导致对干净服务器产生假阴性。检测服务器广播应看「响应」而非「请求」。
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-config-wizard-selfcheck', version: '1.0' } } }) + '\n');
  });
}

function doHardenAndRebuild(installDir) {
  const n = lib.hardenCapabilities(installDir);
  console.log(n ? `🔧 已剥离 ${n} 个文件中的 experimental 广播` : '（未找到可剥离的 experimental 广播）');
  let pj = {}; try { pj = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf8')); } catch {}
  if (pj.scripts && pj.scripts.build) {
    console.log('重新编译...');
    spawnSync('npm', ['run', 'build'], { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
  }
}

async function selfCheckAndHeal(installDir, mainRel, name, a) {
  console.log(`\n🔍 自检 ${name}：握手并检查服务器返回的 capabilities...`);
  const r = await selfCheck(path.join(installDir, mainRel));
  if (!r.ok) { console.warn(`⚠️ 自检握手失败：${r.error}（不影响写入，但请手动验证）`); return; }
  const exp = r.capabilities && r.capabilities.experimental;
  if (exp && Object.keys(exp).length) {
    console.warn(`⚠️ 服务器在 initialize 返回了非标准 capabilities.experimental: ${JSON.stringify(exp)}`);
    console.warn('   严格宿主（如 WorkBuddy）可能拒绝并报 Invalid input。');
    if (a.harden) {
      console.log('🔧 --harden：自动剥离服务器广播的 experimental 能力并重新编译...');
      doHardenAndRebuild(installDir);
    } else {
      console.log('   如需自动剥离，重跑时加 --harden（curated 补丁已处理已知包；未知包建议 --harden）。');
    }
  } else {
    console.log('✅ 自检通过：服务器未广播非标准 experimental 能力');
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || a.h) { usage(); process.exit(0); }
  const dryRun = !!a['dry-run'];
  const mcpPath = a['mcp-json'] || defaultMcpJson();
  const apiKey = a['api-key'];
  const nodeCmd = a.node || 'node';
  const env = resolveEnv(a);
  const entries = {};
  const localMeta = {};

  try {
    if (a['from-url']) {
      if (!a.name) throw new Error('--from-url 需要 --name');
      let ent = { type: 'streamableHttp', url: a['from-url'], disabled: false };
      if (hasPlaceholder(ent) && !apiKey) throw new Error('URL 含密钥占位符，请用 --api-key 提供真实 key');
      ent = subDeep(ent, apiKey);
      if (Object.keys(env).length) ent.env = env;
      entries[a.name] = ent;

    } else if (a['from-json']) {
      let text = a['from-json'];
      if (fs.existsSync(text)) text = fs.readFileSync(text, 'utf8');
      text = text.replace(/^\uFEFF/, '').trim();
      let parsed = null; try { parsed = JSON.parse(text); } catch { }
      if (parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        for (const [nm, e] of Object.entries(parsed.mcpServers)) {
          let ent = JSON.parse(JSON.stringify(e));
          if (ent.url && !ent.command) ent.type = ent.type || 'streamableHttp';
          else if (ent.command) { ent.type = ent.type || 'stdio'; console.warn(`⚠️ "${nm}" 含 command，属本地型 JSON；若 index.js 不在本机，请改用 --from-dir`); }
          if (hasPlaceholder(ent) && !apiKey) throw new Error(`"${nm}" 含密钥占位符，请用 --api-key 提供真实 key`);
          ent = subDeep(ent, apiKey);
          if (ent.disabled === undefined) ent.disabled = false;
          entries[nm] = ent;
        }
      } else {
        if (!a.name) throw new Error('--from-json 不是 mcpServers JSON；若是裸 URL 请加 --name');
        let ent = { type: 'streamableHttp', url: text, disabled: false };
        if (hasPlaceholder(ent) && !apiKey) throw new Error('URL 含密钥占位符，请用 --api-key');
        entries[a.name] = subDeep(ent, apiKey);
      }

    } else if (a['from-dir']) {
      if (!a.name) throw new Error('--from-dir 需要 --name');
      const root = findPackageRoot(a['from-dir']);
      if (!root) throw new Error('在 ' + a['from-dir'] + ' 找不到 package.json，不像可运行的 MCP 包');
      const { installDir, mainRel } = installLocalPackage(root, a.name, a, dryRun);
      let ent = { type: 'stdio', command: nodeCmd, args: [path.join(installDir, mainRel)], disabled: false };
      if (Object.keys(env).length) ent.env = env;
      entries[a.name] = ent;
      if (!dryRun) localMeta[a.name] = { installDir, mainRel };

    } else if (a['from-zip']) {
      if (!a.name) throw new Error('--from-zip 需要 --name');
      if (dryRun) {
        console.log('[dry-run] 将解压', a['from-zip'], '到临时目录后再按目录处理（dry-run 不解压）');
        const installDir = a['install-dir'] || defaultInstallDir(a.name);
        entries[a.name] = { type: 'stdio', command: nodeCmd, args: [path.join(installDir, '<解压后按 package.json main 解析>')], disabled: false };
      } else {
        const tmp = path.join(os.tmpdir(), 'mcp-zip-' + Date.now());
        extractZip(a['from-zip'], tmp);
        const root = findPackageRoot(tmp);
        if (!root) throw new Error('zip 解压后找不到 package.json');
        const { installDir, mainRel } = installLocalPackage(root, a.name, a, false);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
        let ent = { type: 'stdio', command: nodeCmd, args: [path.join(installDir, mainRel)], disabled: false };
        if (Object.keys(env).length) ent.env = env;
        entries[a.name] = ent;
        localMeta[a.name] = { installDir, mainRel };
      }

    } else if (a['from-template']) {
      if (!a.name) throw new Error('--from-template 需要 --name');
      console.warn('⚠️ --from-template 生成的是"零依赖占位骨架"，不含任何真实工具；仅用于你自己新写 MCP。第三方真实服务请用 --from-dir/--from-zip。');
      const installDir = a['install-dir'] || defaultInstallDir(a.name);
      if (dryRun) { console.log('[dry-run] 将生成骨架:', path.join(installDir, 'index.js')); }
      else {
        fs.mkdirSync(installDir, { recursive: true });
        fs.copyFileSync(path.join(__dirname, '..', 'templates', 'local-index.js'), path.join(installDir, 'index.js'));
        console.log('已生成骨架:', path.join(installDir, 'index.js'));
      }
      let ent = { type: 'stdio', command: nodeCmd, args: [path.join(installDir, 'index.js')], disabled: false };
      if (Object.keys(env).length) ent.env = env;
      entries[a.name] = ent;

    } else if (a.index) {
      if (!a.name) throw new Error('--index 需要 --name');
      const abs = path.resolve(a.index);
      if (!fs.existsSync(abs)) throw new Error('index.js 不存在: ' + abs);
      let d = path.dirname(abs), foundNM = false;
      for (let i = 0; i < 3 && d; i++) { if (fs.existsSync(path.join(d, 'node_modules'))) { foundNM = true; break; } const up = path.dirname(d); if (up === d) break; d = up; }
      if (!foundNM) console.warn('⚠️ index.js 附近无 node_modules；若它 import 了外部包，运行会失败（建议提供整个包用 --from-dir）');
      let ent = { type: 'stdio', command: nodeCmd, args: [abs], disabled: false };
      if (Object.keys(env).length) ent.env = env;
      entries[a.name] = ent;

    } else if (a.pkg) {
      if (!a.name) throw new Error('--pkg 需要 --name');
      let ent = { type: 'stdio', command: 'npx', args: ['-y', a.pkg], disabled: false };
      if (Object.keys(env).length) ent.env = env;
      entries[a.name] = ent;

    } else {
      usage(); process.exit(1);
    }
  } catch (e) {
    console.error('❌ ' + e.message);
    process.exit(1);
  }

  if (!Object.keys(entries).length) { console.error('没有可写入的条目'); process.exit(1); }

  // 平台识别 + node 预检（仅本地 stdio 条目需要 node；云端条目不需要）
  const hasLocal = Object.values(entries).some(e => e.type === 'stdio');
  if (hasLocal) {
    const platform = detectTargetPlatform();
    console.log(`🌐 目标平台识别: ${platform}`);
    if (a.node) {
      console.log(`🟡 使用用户指定的 node: ${a.node}（非默认可移植形态；分享前请确认目标机该路径有效）`);
    } else {
      const nodeCheck = preflightNodeCheck();
      if (nodeCheck.ok) {
        console.log(`🟢 node 可达 (${nodeCheck.version})；使用可移植的裸 "node" 作为 command（跨平台/跨用户分享最稳）`);
      } else {
        console.warn(`⚠️ 当前环境 PATH 未检测到 node：${nodeCheck.error}`);
        if (nodeCheck.candidates.length) {
          console.warn('   发现可参考的 node 位置（未自动改用，保持裸 "node" 以保可移植）：');
          nodeCheck.candidates.slice(0, 5).forEach(p => console.warn('   - ' + p));
        }
        console.warn('   若目标宿主 spawn MCP 时 PATH 无 node，请确认目标平台已提供 node（主流 AI 平台均自带/要求 node）。');
      }
    }
  }

  const data = readMcpJson(mcpPath);
  for (const [nm, ent] of Object.entries(entries)) {
    if (data.mcpServers[nm]) console.warn(`⚠️ 已存在 "${nm}"，将覆盖`);
    data.mcpServers[nm] = ent;
  }
  if (dryRun) {
    console.log('[dry-run] 合并结果:\n' + JSON.stringify(data, null, 2));
    process.exit(0);
  }
  writeMcpJson(mcpPath, data);
  console.log('✅ 已写入', mcpPath);
  for (const [nm, ent] of Object.entries(entries)) console.log('条目:', nm, JSON.stringify(ent));
  console.log('⚠️ 新 MCP 不会自动生效：请在连接器管理页右上角「自定义连接器」入口点「信任」启用。');

  // 自检 + 自愈（仅本地 stdio 包；--self-check 开启）
  if (a['self-check']) {
    for (const [nm, meta] of Object.entries(localMeta)) {
      await selfCheckAndHeal(meta.installDir, meta.mainRel, nm, a);
    }
  }
}
main().catch(e => { console.error('❌ ' + (e && e.message ? e.message : e)); process.exit(1); });
