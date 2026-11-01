'use strict';
// lang.js — MCP 运行时类型识别与按语言分发（纯 Node，无第三方依赖）
//
// 设计目标：用户只需给"文件夹 / zip"，向导自动判断这个 MCP 是用什么语言实现的，
// 然后按该语言的方式：① 复制包 ② 装依赖/编译 ③ 找入口 ④ 生成 command ⑤ 给出握手验证命令。
// 这样无论 Node / Python / Go / Rust / Java / .NET，用户都不需要懂底层类型，体验一致。
//
// 支持的运行时类型（detectLang 通过"标记文件"识别）：
//   node    package.json
//   python  pyproject.toml / requirements.txt / setup.py
//   go      go.mod
//   rust    Cargo.toml
//   java    pom.xml / build.gradle
//   dotnet  *.csproj / *.sln
//   ruby    Gemfile / *.gemspec
//   php     composer.json
//   docker  Dockerfile / docker-compose.yml   （本地但走 HTTP，见 SKILL.md 说明）

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('./lib');

// 中文 Windows 上，宿主拉起 Python 子进程时 stdout/stderr 默认是 GBK(cp936)。
// 服务端只要往这两条流打印 emoji 或中文符号（启动 banner、日志前缀很常见），
// Python 立刻抛 UnicodeEncodeError 并退出 → 客户端只看到 "-32000: Connection closed"。
// 注意：在 Git Bash / Windows Terminal 里手工跑同一份代码通常不崩（终端是 UTF-8），
// 所以"我这儿能跑"完全不能证明宿主里没问题。
// 兜底办法就是这两条环境变量：强制两条流用 UTF-8，对所有 Python MCP 普适。
const PY_ENV = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

// 给非 IT 用户的"人话"说明：每种类型是什么、向导会怎么做。SKILL.md 直接引用这份表。
const LANG_GUIDE = {
  node: {
    label: 'Node.js（JavaScript/TypeScript）',
    what: '用 JavaScript 写的服务，最常见的 MCP 实现语言。',
    how: '复制包 → npm install 装依赖（缺则自动编译 tsc）→ 运行 node 入口文件。'
  },
  python: {
    label: 'Python',
    what: '用 Python 写的服务（生物医药领域很多官方数据源用 Python）。',
    how: '复制包 → uv sync 装依赖到本地 .venv → 运行 venv 里的 python 跑入口 .py 文件。'
  },
  go: {
    label: 'Go（预编译二进制）',
    what: '用 Go 写的服务，通常发布成一个独立可执行文件。',
    how: '若包里已带编译好的二进制直接用它；否则需要本机装 Go 工具链后自动 go build。'
  },
  rust: {
    label: 'Rust（预编译二进制）',
    what: '用 Rust 写的服务，同样通常发布成独立可执行文件。',
    how: '若包里已带编译好的二进制直接用它；否则需要本机装 Rust 工具链后自动 cargo build。'
  },
  java: {
    label: 'Java / Kotlin',
    what: '企业级服务常用（如 cBioPortal 后端就是 Java）。',
    how: '需要本机装 JDK + Maven/Gradle，自动打包成 .jar 后用 java -jar 运行。'
  },
  dotnet: {
    label: '.NET / C#',
    what: '微软生态的服务。',
    how: '需要本机装 .NET SDK，自动 dotnet build 后用 dotnet 运行。'
  },
  ruby: {
    label: 'Ruby',
    what: '少数 MCP 用 Ruby 写。',
    how: '需要本机装 Ruby + Bundler，自动 bundle install 后运行。'
  },
  php: {
    label: 'PHP',
    what: '极少数 MCP 用 PHP 写。',
    how: '需要本机装 PHP + Composer，自动 composer install 后运行。'
  },
  docker: {
    label: 'Docker（容器）',
    what: '服务打包在容器里，本地跑起来后通过网址（HTTP）连接，而非本机进程。',
    how: '需要本机装 Docker；docker run 起来后向导生成 streamableHttp / sse 的 localhost 网址条目。'
  }
};

// 标记文件（精确文件名）
const MARKER_FILES = {
  node: ['package.json'],
  python: ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg'],
  go: ['go.mod'],
  rust: ['Cargo.toml'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  docker: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']
};
// 标记文件（通配名）
const MARKER_GLOBS = {
  dotnet: [/\.csproj$/, /\.sln$/],
  ruby: [/\.gemspec$/]
};
// 仅作"存在即识别"的弱标记（不会单独决定语言，避免误判）
const WEAK_MARKERS = {
  php: ['composer.json']
};

function fileExistsInDir(dir, names) {
  for (const n of names) if (fs.existsSync(path.join(dir, n))) return n;
  return null;
}
function matchGlobInDir(dir, globs) {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of es) {
    if (e.isDirectory()) continue;
    for (const g of globs) if (g.test(e.name)) return e.name;
  }
  return null;
}

// 在 dir 内（含一层子目录）定位"包根 + 识别语言"。优先精确标记，其次通配，最后弱标记。
function detectLang(root) {
  let dirs = [root];
  try {
    const kids = fs.readdirSync(root, { withFileTypes: true });
    for (const k of kids) if (k.isDirectory()) dirs.push(path.join(root, k.name));
  } catch {}
  for (const dir of dirs) {
    for (const lang of ['node', 'python', 'go', 'rust', 'java', 'docker']) {
      if (fileExistsInDir(dir, MARKER_FILES[lang])) return { lang, dir, marker: fileExistsInDir(dir, MARKER_FILES[lang]) };
    }
    for (const lang of Object.keys(MARKER_GLOBS)) {
      const hit = matchGlobInDir(dir, MARKER_GLOBS[lang]);
      if (hit) return { lang, dir, marker: hit };
    }
  }
  for (const dir of dirs) {
    for (const lang of Object.keys(WEAK_MARKERS)) {
      if (fileExistsInDir(dir, WEAK_MARKERS[lang])) return { lang, dir, marker: fileExistsInDir(dir, WEAK_MARKERS[lang]) };
    }
  }
  return { lang: 'unknown', dir: root, marker: null };
}

// ---------- 各语言处理 ----------

function readProjectName(root) {
  for (const f of ['package.json', 'pyproject.toml']) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) {
      try {
        if (f === 'package.json') return JSON.parse(fs.readFileSync(p, 'utf8')).name || null;
        const t = fs.readFileSync(p, 'utf8');
        const m = t.match(/name\s*=\s*["']([^"']+)["']/);
        if (m) return m[1];
      } catch {}
    }
  }
  return null;
}

// 缓存已定位到的 uv 可执行文件（绝对路径或 'uv'），供后续 spawn 复用
let UV_BIN = null;

function tryUvBin(bin) {
  try {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

function findUvCandidate() {
  const home = os.homedir();
  const cands = ['uv'];
  if (process.platform === 'win32') {
    cands.push(path.join(home, '.local', 'bin', 'uv.exe'));
    cands.push(path.join(home, '.cargo', 'bin', 'uv.exe'));
    cands.push(path.join(home, 'AppData', 'Roaming', 'Python', 'Python313', 'Scripts', 'uv.exe'));
    cands.push(path.join(home, 'AppData', 'Roaming', 'Python', 'Python312', 'Scripts', 'uv.exe'));
    cands.push(path.join(home, 'AppData', 'Roaming', 'Python', 'Python311', 'Scripts', 'uv.exe'));
  } else {
    cands.push(path.join(home, '.local', 'bin', 'uv'));
    cands.push(path.join(home, '.cargo', 'bin', 'uv'));
  }
  for (const c of cands) {
    if (c !== 'uv' && !fs.existsSync(c)) continue;
    if (tryUvBin(c)) return c;
  }
  return null;
}

// 找可用的 python 解释器（用于 pip 安装 uv）
function findPythonForPip() {
  const home = os.homedir();
  const cands = [];
  if (process.platform === 'win32') {
    // WorkBuddy 自带 python 优先（一定存在，不依赖用户自己装）
    cands.push(path.join(home, '.workbuddy', 'binaries', 'python', 'envs', 'default', 'Scripts', 'python.exe'));
  }
  cands.push(process.platform === 'win32' ? 'python' : 'python3', 'python');
  for (const c of cands) {
    try {
      const r = spawnSync(c, ['-m', 'pip', '--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
      if (!r.error && r.status === 0) return c;
    } catch {}
  }
  return null;
}

function ensureUv() {
  if (UV_BIN && tryUvBin(UV_BIN)) return UV_BIN;

  const found = findUvCandidate();
  if (found) {
    UV_BIN = found;
    return UV_BIN;
  }

  // 自动补装：用户不需要自己折腾环境
  console.log('⚙️  未检测到 uv（Python 环境管理工具），正在自动安装（约 30~60 秒）...');
  const py = findPythonForPip();
  if (py) {
    // 先试 --user（权限更稳），失败再试直装
    for (const extra of [['--user'], []]) {
      try {
        const r = spawnSync(py, ['-m', 'pip', 'install', '--quiet', ...extra, 'uv'], {
          encoding: 'utf8',
          shell: process.platform === 'win32',
          stdio: 'pipe',
          timeout: 300000
        });
        if (r.status === 0) break;
      } catch {}
    }
    // 装完重新定位（可能落在 user Scripts 或 python 自带 Scripts）
    let scriptsDir = '';
    try {
      const r = spawnSync(py, ['-c', 'import sysconfig;print(sysconfig.get_path("scripts", scheme="nt_user"))'], { encoding: 'utf8', shell: process.platform === 'win32' });
      if (r.status === 0 && r.stdout) scriptsDir = r.stdout.trim();
    } catch {}
    const after = [scriptsDir && path.join(scriptsDir, 'uv.exe'), findUvCandidate()];
    for (const c of after) {
      if (c && fs.existsSync(c) && tryUvBin(c)) {
        UV_BIN = c;
        console.log(`✅ uv 安装完成：${c}`);
        return UV_BIN;
      }
    }
  }

  throw new Error(
    '未能自动安装 uv。请选一种方式手动装（任选其一，装完重跑本命令即可）：\n' +
    '  ① 直接下载安装包（最简单）：https://docs.astral.sh/uv/getting-started/installation/\n' +
    '  ② 命令行：pip install uv\n' +
    '  ③ Windows 包管理器：winget install --id astral-sh.uv\n' +
    '这一步只需做一次，之后所有 Python 类 MCP 都不用再管。'
  );
}

function pythonEntry(root, a) {
  if (a.entry) return { file: a.entry, isScript: false };
  const pj = path.join(root, 'pyproject.toml');
  if (fs.existsSync(pj)) {
    const t = fs.readFileSync(pj, 'utf8');
    // [project.scripts] 里定义的 console 脚本名
    const s = t.match(/\[project\.scripts\][^\[]*?(\w[\w.-]*)\s*=/);
    if (s) return { file: s[1], isScript: true };
    // tool.setuptools.py-modules = ["gdc_mcp_server", ...]
    const pm = t.match(/py-modules\s*=\s*\[([^\]]+)\]/);
    if (pm) {
      const mods = pm[1].split(',').map(x => x.trim().replace(/["']/g, '')).filter(Boolean);
      if (mods.length) return { file: mods[0] + '.py', isScript: false };
    }
  }
  for (const cand of ['server.py', 'main.py', 'app.py', 'index.py', 'mcp_server.py', 'run.py']) {
    if (fs.existsSync(path.join(root, cand))) return { file: cand, isScript: false };
  }
  // 退路：找含 mcp.run() 的 .py
  let es; try { es = fs.readdirSync(root, { withFileTypes: true }); } catch { es = []; }
  for (const e of es) {
    if (e.isFile() && e.name.endsWith('.py')) {
      try {
        const c = fs.readFileSync(path.join(root, e.name), 'utf8');
        if (/mcp\s*\.\s*run\s*\(/.test(c) || /run\s*\(\s*transport/.test(c)) return { file: e.name, isScript: false };
      } catch {}
    }
  }
  throw new Error('无法自动识别 Python 入口文件（没找到 server.py / 含 mcp.run() 的 .py，也没在 pyproject.toml 里定义 [project.scripts]）。请用 --entry 指定入口 .py，例如 --entry server.py');
}

function venvPython(installDir) {
  return process.platform === 'win32'
    ? path.join(installDir, '.venv', 'Scripts', 'python.exe')
    : path.join(installDir, '.venv', 'bin', 'python');
}
function venvScript(installDir, script) {
  return process.platform === 'win32'
    ? path.join(installDir, '.venv', 'Scripts', script + '.exe')
    : path.join(installDir, '.venv', 'bin', script);
}

// 通用：在 installDir 复制好后，按语言安装依赖 / 编译 / 找入口 / 生成 command
function handleLang(lang, installDir, a) {
  if (lang === 'node') return handleNode(installDir, a);
  if (lang === 'python') return handlePython(installDir, a);
  // 其余语言：预编译二进制直用 + 缺工具链时给清晰指引（预案）
  return handleCompiled(lang, installDir, a);
}

function handleNode(installDir, a) {
  // 入口
  const pjPath = path.join(installDir, 'package.json');
  let mainRel = 'index.js';
  try {
    const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
    if (pj.main) mainRel = pj.main.replace(/^\.\//, '');
    else for (const c of ['build/index.js', 'dist/index.js', 'index.js']) if (fs.existsSync(path.join(installDir, c))) { mainRel = c; break; }
  } catch {}
  const mainAbs = path.join(installDir, mainRel);
  const nodeCmd = a.node || 'node';
  // 依赖 / 编译
  if (!fs.existsSync(path.join(installDir, 'node_modules'))) {
    const needBuild = !fs.existsSync(mainAbs) && (() => { try { return JSON.parse(fs.readFileSync(pjPath, 'utf8')).scripts && JSON.parse(fs.readFileSync(pjPath, 'utf8')).scripts.build; } catch { return false; } })();
    if (a['npm-install'] || needBuild) {
      const args = needBuild ? ['install'] : ['install', '--omit=dev'];
      console.log(needBuild ? '缺 node_modules（且需编译），执行 npm install（含 devDependencies）...' : '缺 node_modules，执行 npm install --omit=dev ...');
      const r = spawnSync('npm', args, { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
      if (r.status !== 0) console.warn('⚠️ npm install 失败，请手动在该目录执行 npm install');
      else console.log('node_modules 安装完成 ✅');
    } else {
      console.warn('⚠️ 包内无 node_modules，MCP 可能无法启动。加 --npm-install 允许安装，或提供含 node_modules 的完整包。');
    }
  } else console.log('包内已含 node_modules ✅');
  // 编译（缺入口但存在 build 脚本）
  if (!fs.existsSync(mainAbs)) {
    let pj = {}; try { pj = JSON.parse(fs.readFileSync(pjPath, 'utf8')); } catch {}
    if (pj.scripts && pj.scripts.build) {
      console.log('🔧 检测到入口缺失但有 build 脚本，开始编译...');
      if (!fs.existsSync(path.join(installDir, 'node_modules', 'typescript')) && !fs.existsSync(path.join(installDir, 'node_modules', 'esbuild'))) {
        spawnSync('npm', ['install'], { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
      }
      const b = spawnSync('npm', ['run', 'build'], { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
      if (b.status !== 0) console.warn('⚠️ npm run build 失败');
      else if (!fs.existsSync(mainAbs)) console.warn('⚠️ 编译完成但入口仍缺失: ' + mainAbs);
      else console.log('编译完成，入口已生成 ✅');
    } else {
      console.warn('⚠️ 入口文件缺失且 package.json 无 build 脚本，MCP 将无法启动');
    }
  }
  const entry = { type: 'stdio', command: nodeCmd, args: [path.join(installDir, mainRel)], disabled: false };
  const verifyCmd = [nodeCmd, path.join(installDir, mainRel)];
  return { entry, verifyCmd, mainRel };
}

// 预检：dry-run / 正式安装前都给出"缺依赖"预告，避免用户配完才发现起不来。
// 仅做只读检查 + 提示，不执行任何安装；正式安装路径里 handleNode 仍会真正处理依赖。
function preflightDepWarning(lang, root) {
  if (lang === 'node') {
    if (!fs.existsSync(path.join(root, 'node_modules'))) {
      console.warn('⚠️ 包内无 node_modules，MCP 可能无法启动。加 --npm-install 允许安装，或提供含 node_modules 的完整包。');
    } else {
      console.log('包内已含 node_modules ✅');
    }
  } else if (lang === 'python') {
    if (!fs.existsSync(path.join(root, 'pyproject.toml')) && !fs.existsSync(path.join(root, 'requirements.txt')) && !fs.existsSync(path.join(root, 'setup.py'))) {
      console.warn('⚠️ 未识别到 Python 依赖声明（pyproject.toml / requirements.txt / setup.py），uv sync 可能无法装齐依赖。');
    }
  }
}

function handlePython(installDir, a) {
  // 依赖：uv sync 生成 .venv
  if (!fs.existsSync(path.join(installDir, '.venv'))) {
    const uvBin = ensureUv();
    console.log('执行 uv sync（安装 Python 依赖到本地 .venv）...');
    const r = spawnSync(uvBin || 'uv', ['sync'], { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('uv sync 失败。请检查网络与 pyproject.toml 依赖；或手动在该目录执行 uv sync。');
    console.log('Python 依赖安装完成 ✅');
  } else {
    console.log('已存在 .venv，跳过 uv sync（如需重装依赖可手动 uv sync）');
  }
  const ent = pythonEntry(installDir, a);
  let command, args, verifyCmd;
  if (a.uv) {
    // 可移植写法：uv --directory run（依赖目标机 PATH 有 uv）
    const uvBin = UV_BIN || 'uv';
    command = uvBin;
    args = ['--directory', installDir, 'run', ent.isScript ? ent.file : path.join(installDir, ent.file)];
    verifyCmd = [uvBin, '--directory', installDir, 'run', ent.isScript ? ent.file : path.join(installDir, ent.file)];
  } else {
    // 默认：venv 绝对路径（运行时不再依赖 PATH 有 uv，最稳；消除"Connection closed"类问题）
    if (ent.isScript) {
      command = venvScript(installDir, ent.file);
      args = [];
      verifyCmd = [command];
    } else {
      command = venvPython(installDir);
      args = [path.join(installDir, ent.file)];
      verifyCmd = [command, path.join(installDir, ent.file)];
    }
  }
  // 无论走 venv 绝对路径还是 uv run，都要带 UTF-8 env 兜底：
  // 这是"同一个包在别人电脑上必崩、在这台机器上碰巧能跑"的唯一可靠解法。
  const entry = { type: 'stdio', command, args, disabled: false, env: { ...PY_ENV } };
  return { entry, verifyCmd, mainRel: ent.file };
}

function findPrebuiltBinary(installDir) {
  let es; try { es = fs.readdirSync(installDir, { withFileTypes: true }); } catch { return null; }
  const skip = new Set(['node_modules', '.venv', 'dist', 'build', 'target', 'bin', 'obj', '__pycache__', '.git']);
  for (const e of es) {
    if (e.isDirectory() || skip.has(e.name)) continue;
    if (process.platform === 'win32') {
      if (e.name.endsWith('.exe')) return path.join(installDir, e.name);
    } else {
      try { const st = fs.statSync(path.join(installDir, e.name)); if (st.mode & 0o111) return path.join(installDir, e.name); } catch {}
    }
  }
  return null;
}

// 缺工具链时给"不吓人"的说明：先讲清不是用户的错，再给三条按成功率排序的出路，
// 且第 1 条完全不需要装任何环境（作者发的现成程序 / AI 去 Releases 找）。
// 面向研发用户：禁止第一句就是"请安装 Go"，那等于劝退。
function toolchainMissingMsg(lang, tool, installDir, a) {
  const name = a.name || path.basename(installDir);
  const itRef = {
    go: '安装 Go（https://go.dev/dl/），向导将自动执行 go build 生成可执行文件',
    rust: '安装 Rust（https://rustup.rs/），向导将自动执行 cargo build --release',
    java: '安装 JDK + Maven（https://adoptium.net/），向导将自动执行 mvn package 生成 .jar',
    dotnet: '安装 .NET SDK（https://dot.net），向导将自动执行 dotnet build'
  }[lang] || `安装 ${tool}`;
  return [
    `这一条没能自动配好——但问题不在你的操作，也不是配置写错。`,
    ``,
    `原因：这个 MCP 是 ${tool} 写的，作者只给了源码，没附带"能直接运行的程序"；`,
    `本机缺少把它变成可运行程序所需的环境，所以向导自动流程走不下去。`,
    ``,
    `你的其它 MCP 完全不受影响，mcp.json 没有被改动。`,
    ``,
    `【三条出路，按顺序试，通常第 1 条就够】`,
    `  1) 用作者发布的现成程序（不需要在本机装任何环境，最省事）`,
    `     让 AI 去该项目的 GitHub「Releases」页下载 Windows 版可执行文件，`,
    `     下载后执行：node scripts/scaffold_mcp.js --bin "<那个文件的完整路径>" --name ${name}`,
    `  2) 换成云端托管版（如果有）：给个网址 + 密钥就能用，同样不用装环境`,
    `     可以问一句「这个 MCP 有没有官方托管版 / 在线 API 版」`,
    `  3) 确实只能在本地跑：请 IT / 开发同学装一次 ${tool}，装完重跑原命令即可（向导会自动编译）`,
    `     IT 参考：${itRef}`,
    ``,
    `（本次失败已记入安装台账 ~/.workbuddy/mcp-servers/.install-log.jsonl）`
  ].join('\n');
}

function handleCompiled(lang, installDir, a) {
  // 0) 用户/AI 已拿到现成可执行文件 → 直接注册（--bin）
  if (a.bin) {
    const b = path.resolve(a.bin);
    if (!fs.existsSync(b)) throw new Error('--bin 指定的文件不存在: ' + b);
    console.log('使用指定的可执行文件：' + b);
    const entry = { type: 'stdio', command: b, args: a['bin-args'] ? String(a['bin-args']).split(/\s+/).filter(Boolean) : [], disabled: false };
    return { entry, verifyCmd: [b], mainRel: path.basename(b) };
  }
  // 1) 已带预编译二进制 → 直接用它（Go / Rust 服务常见的分发方式）
  const bin = findPrebuiltBinary(installDir);
  if (bin) {
    console.log(`检测到预编译二进制，直接使用：${bin}`);
    const entry = { type: 'stdio', command: bin, args: [], disabled: false };
    return { entry, verifyCmd: [bin], mainRel: path.basename(bin) };
  }
  // 2) 尝试用工具链编译；缺工具链则给清晰指引
  const guide = {
    go: { tool: 'Go', check: ['go', 'version'], build: ['go', 'build', '-o', path.join(installDir, '_mcp_bin'), '.'], bin: path.join(installDir, '_mcp_bin') },
    rust: { tool: 'Rust', check: ['cargo', '--version'], build: ['cargo', 'build', '--release'], bin: null },
    java: { tool: 'JDK + Maven/Gradle', check: ['mvn', '-v'], build: ['mvn', '-q', '-DskipTests', 'package'], bin: null },
    dotnet: { tool: '.NET SDK', check: ['dotnet', '--version'], build: ['dotnet', 'build', '-c', 'Release'], bin: null }
  }[lang];
  if (!guide) {
    throw new Error([
      `检测到 ${lang} 类型的 MCP，但向导暂未内置这类语言的自动安装流程。`,
      `这不算配置失败——只是这个语言比较少见于 MCP。`,
      `建议：① 问 AI「这个 MCP 有没有现成的可执行程序 / 云端版」；`,
      `      ② 若已拿到可执行文件，用 --bin "<文件路径>" --name ${a.name || '服务名'} 直接注册。`
    ].join('\n'));
  }
  const chk = spawnSync(guide.check[0], [guide.check[1]], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (chk.error || chk.status !== 0) {
    throw new Error(toolchainMissingMsg(lang, guide.tool, installDir, a));
  }
  console.log(`检测到 ${guide.tool}，执行编译：${guide.build.join(' ')} ...`);
  const b = spawnSync(guide.build[0], guide.build.slice(1), { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
  if (b.status !== 0) throw new Error(`${guide.tool} 编译失败，请检查该 MCP 源码。`);
  let outBin = guide.bin;
  if (lang === 'rust') {
    const name = readProjectName(installDir) || path.basename(installDir);
    outBin = path.join(installDir, 'target', 'release', process.platform === 'win32' ? name + '.exe' : name);
  } else if (lang === 'java') {
    // 找 target/*.jar 或 build/libs/*.jar
    outBin = findFirstJar(installDir);
  } else if (lang === 'dotnet') {
    outBin = findFirstDll(installDir);
  }
  if (!outBin || !fs.existsSync(outBin)) throw new Error('编译成功但未定位到产物文件，请手动指定入口。');
  const entry = lang === 'java'
    ? { type: 'stdio', command: 'java', args: ['-jar', outBin], disabled: false }
    : { type: 'stdio', command: outBin, args: [], disabled: false };
  const verifyCmd = lang === 'java' ? ['java', '-jar', outBin] : [outBin];
  return { entry, verifyCmd, mainRel: path.basename(outBin) };
}

function findFirstJar(dir) {
  let out = null;
  const walk = (d, depth) => {
    if (out || depth > 4) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', '.git', 'target'].includes(e.name)) walk(fp, depth + 1); }
      else if (e.name.endsWith('.jar') && !e.name.endsWith('-sources.jar') && !e.name.endsWith('-javadoc.jar')) { out = fp; return; }
    }
  };
  walk(dir, 0);
  return out;
}
function findFirstDll(dir) {
  let out = null;
  const walk = (d, depth) => {
    if (out || depth > 4) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', '.git', 'bin', 'obj'].includes(e.name)) walk(fp, depth + 1); }
      else if (e.name.endsWith('.dll')) { out = fp; return; }
    }
  };
  walk(dir, 0);
  return out;
}

// 主入口：把用户给的 root 目录（可能是源码包根或含一层嵌套）安装到 installDir 并解析出 mcp.json 条目。
// 返回 { lang, installDir, entry, verifyCmd, mainRel, pkgName }
function resolveLocalPackage(userDir, name, a, dryRun) {
  const det = detectLang(userDir);
  const root = det.dir;
  const lang = a.lang || det.lang;
  if (lang === 'unknown') throw new Error(`在 ${userDir} 找不到任何可识别的 MCP 包标记（package.json / pyproject.toml / go.mod / Cargo.toml / pom.xml / Dockerfile 等）。请确认给的是完整源码包。`);
  if (lang === 'docker') throw new Error('检测到 Docker 类型：请用 --from-docker 分支（docker run 后生成 HTTP 端点），或参考 SKILL.md 的 Docker 处理说明。');
  const guide = LANG_GUIDE[lang];
  console.log(`🌐 识别到运行时类型：${guide ? guide.label : lang}` + (guide ? `（${guide.what}）` : ''));
  const installDir = a['install-dir'] || path.join(os.homedir(), '.workbuddy', 'mcp-servers', name);
  const pkgName = readProjectName(root);

  if (dryRun) {
    console.log(`[dry-run] 包根: ${root}（语言 ${lang}）`);
    console.log(`[dry-run] 将复制到: ${installDir}`);
    console.log(`[dry-run] 流程: ${guide ? guide.how : lang}`);
    preflightDepWarning(lang, root);
    return { lang, installDir, entry: { type: 'stdio', command: '<按语言生成>', args: ['<入口>'], disabled: false }, verifyCmd: [], mainRel: '?', pkgName };
  }

  if (fs.existsSync(installDir) && !a.overwrite) throw new Error('安装目录已存在: ' + installDir + '（加 --overwrite 覆盖）');
  fs.mkdirSync(path.dirname(installDir), { recursive: true });
  fs.cpSync(root, installDir, { recursive: true });
  console.log('已复制包到:', installDir);

  // 应用 curated 补丁（preBuild，Node 专用；其余语言无影响）
  lib.applyPatches(installDir, pkgName, 'preBuild');
  let res;
  try {
    res = handleLang(lang, installDir, a);
  } catch (e) {
    // 失败即回滚本次复制：否则用户按提示装好工具链后重跑，会撞上"安装目录已存在"，二次劝退。
    try {
      fs.rmSync(installDir, { recursive: true, force: true });
      console.log('已清理本次的临时复制（不影响任何已配好的 MCP）');
    } catch { }
    throw e;
  }
  // 应用 curated 补丁（postBuild）
  lib.applyPatches(installDir, pkgName, 'postBuild');

  res.lang = lang;
  res.installDir = installDir;
  res.pkgName = pkgName;
  return res;
}

module.exports = { detectLang, LANG_GUIDE, resolveLocalPackage, venvPython, ensureUv };
