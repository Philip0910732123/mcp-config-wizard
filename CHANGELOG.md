# Changelog — mcp-config-wizard

版本号遵循语义化版本（SemVer：`MAJOR.MINOR.PATCH`）。

**权威版本源 = GitHub tag（`vX.Y.Z`）**。发布到 WorkBuddy 技能中心时，
**填写与 GitHub tag 完全相同的版本号**，以保证两边一致、便于后续维护。

每次发版三步：
1. 在本文档加一条对应版本的变更记录；
2. `git tag vX.Y.Z` 并 `git push --tags`；
3. 在 WorkBuddy 技能中心后台以同一 `X.Y.Z` 发布 / 更新。

---

## [1.4.5] — 2026-11-06

**修复 Windows 上 `npx` / `bunx` 类配置无法自动验收，以及 `--args` 被空格切碎**

- **新增 `scripts/spawn-safe.js`**：统一负责启动 stdio 子进程。此前 `verify_mcp.js` 直接 `spawn(command, args)`，而 Windows 上 `npx` / `npm` 是 `.cmd` 批处理垫片，Node 不开 shell 直接 CreateProcess 会报 `spawn npx ENOENT`，于是**所有用 npx 写的配置都验收不了**（实测复现：`--command npx` 直接失败）。现在按三级策略启动：真 `.exe` 走绝对路径 → 已知 npm 垫片改用 `node <npx-cli.js>`（语义与垫片一致） → 其余 `.cmd` 才退回 `cmd.exe` 并逐参数转义。
- **参数保真**：开 `shell:true` 那条「省事」的路被放弃——它会把 `[cmd, ...args]` 拼成一行，导致含空格的路径被切成两段、`--with mcp<2.0` 里的 `<` 被当成重定向符吞掉后续参数（NCBI 这类配置会静默失败）。现在含空格路径、`<` `>` `&` `|` 与引号均逐字传递，已用夹具实测。
- **`--args` 支持 JSON 数组**：`--args '["-y","@scope/pkg@1.2.3","--with","mcp<2.0"]'` 无损表达；旧的空格分词保留，但新增引号支持，并在疑似「空格切碎」时于报错里给出改法提示。
- **失败信息可诊断**：命令不在 PATH 时不再抛裸 `ENOENT`，改为中文说明（未安装 / 未进 PATH / 写成了别名）+ 当前 PATH 前三项。
- **回归压测扩充到 21 例**：新增含空格路径、`.cmd` 垫片兜底、未知命令、非法 JSON、引号未闭合五个用例。

---

## [1.4.4] — 2026-11-04

**发布通道对齐：SkillHub 首发副本内容与 GitHub 完全一致**

- **背景**：1.4.3 首次推送到 SkillHub 时，因平台类型白名单拒绝无扩展名文件，`LICENSE` / `NOTICE` 被临时改名为 `.txt` 才上传成功，导致该副本的 `SKILL.md`、`README` 仍写着不带扩展名的文件名。SkillHub 不允许覆盖已存在的版本号（`VERSION_EXISTS`），也无法通过 CLI 删除版本，故以 1.4.4 作为对齐后的最终版本。
- **内容变更**：仅版本号与上文所述的引用修正，功能代码与 1.4.3 无差异。`LICENSE.txt` / `NOTICE.txt` 现已在本仓库与 SkillHub 两侧同名同内容。
- **1.4.3 与 1.4.4 的关系**：两者授权条款相同（均为 Apache-2.0）。以任一版本获得的授权不受影响。

---

## [1.4.3] — 2026-11-04

**许可从 MIT 变更为 Apache-2.0；加入版权头、NOTICE 归属要求与文件指纹**

> 许可变更仅对 v1.4.3 起的版本生效。v1.4.2 及更早版本已按 MIT 授权发出的副本，其授权不可撤回。

- **新增 `LICENSE.txt`**：Apache License 2.0 全文。此前仓库只有 `SKILL.md` frontmatter 里的 `license: MIT`，**没有 LICENSE 文件**——形式声明缺少可执行文本，维权时无法举证具体条款。
- **新增 `NOTICE.txt`**：按 Apache-2.0 §4(d) 明确三项必须保留的归属信息（著作权人、项目名、仓库地址），并说明更名后的衍生作品同样适用。附商标与第三方组件说明。
- **两文件带 `.txt` 扩展名**：SkillHub 的类型白名单拒绝无扩展名文件（`不允许的文件类型: .gitattributes` / `LICENSE`），带扩展名后 GitHub 仍自动识别为 Apache-2.0，两侧分发逐字节一致。发布时还需剔除 `.gitattributes`、`.gitignore` 等 VCS 元文件。
- **`SKILL.md` 新增 §11「来源与授权」**：把"允许什么 / 再分发必须做什么 / 更名场景怎么认定"写成可引用条款，并公布文件指纹 `MCPWIZ-FP-2026-HUPAN-7C41`。
- **9 个脚本与模板统一加版权头**：`scripts/` 下 8 个文件 + `templates/local-index.js`，每份含 `SPDX-License-Identifier`、仓库地址与指纹。全部通过 `node --check` / `bash -n` 语法校验。
- **原因**：MIT 仅要求保留版权声明，不禁止改名与商用，对本项目的实际风险（他人改名后作为自己的作品发布）几乎没有约束力。Apache-2.0 在两点上更强：§4(b) 要求修改过的文件显著标注"已被修改"（更名即修改），§4(d) 要求保留 NOTICE 归属；同时保留商用自由与专利授权，不影响 skill 的正常分发与客户使用。

**指纹设计说明**：`MCPWIZ-FP-2026-HUPAN-7C41` 分散在每份脚本头部与 `SKILL.md` §11。完整复制会连带带走指纹，直接暴露来源；逐个删除则构成"主动消除权利管理信息"的故意侵权证据。两种结果都对我方有利。

---

## [1.4.2] — 2026-11-02

**发行包剔除个人维护脚本；修正 manifest 排除项与压测脚本里写死的本机路径**

- **维护脚本不再随包分发**：`publish.js` / `release.sh` / `stress_test.sh` 收拢为 `MAINTAINER_FILES` 常量统一排除，发行包由 14 个文件降为 13 个；打包后新增断言，暂存目录里一旦出现维护者工具就清空暂存并中止发版（退出码 1），不再依赖"记得加排除项"这种人工约束。
- **`SKILL.md` §8 脚本清单收敛**：移除 `stress_test.sh` 一行，只保留用户真正会用的 4 个脚本与 2 个共享库。
- **`skill.manifest.json` 的 `exclude_paths` 修正**：原来声明排除 `templates`，而 `scaffold_mcp.js --from-template` 正要读 `templates/local-index.js` 生成骨架——声明与实现矛盾，若安装器按该声明剥离会直接 `ENOENT`。改为只排除三个维护者脚本，与打包规则保持一致。
- **`stress_test.sh` 夹具目录可移植**：原来写死本机用户目录下的临时路径，别人克隆仓库后跑不起来。改为取 Node 的 `os.tmpdir()` 并统一转正斜杠（反斜杠拼进 JSON 夹具会变成 `\U` 之类的非法转义），仍可用 `MCP_STRESS_ROOT` 覆盖；`/d/Git/usr/bin` 的 PATH 兜底改为该目录存在时才追加。
- **回归压测用例修正**：T3 因 1.4.1 的 dry-run 脱敏已改为断言输出为 `key=***`，并新增 T3b 验证落盘仍写明文 key（脱敏只作用于输出）；现为 16 / 16 通过。

**维护者工具（仓库内保留，不随包分发）**

- `scripts/publish.js`：打包到临时暂存目录（源目录零改动）→ 版本三处校验 → 调 skillhub CLI；changelog 不手填时从本文件对应段落按整节累积提取，默认 400 字并在要点边界截断。
- `scripts/release.sh`：一键完成"发布平台 → 提交 → 打 tag → 推送 → 建 Release → 回验"。顺序是先发布成功再动 git，平台失败时 git 零改动、可直接重跑；内含六道前置校验，并补齐嵌套调用时丢失的 `USERPROFILE` / `TEMP` / `APPDATA` / `LOCALAPPDATA`（Windows 版 Python 取家目录只认 `USERPROFILE`，`gh` 把凭据存在 `%APPDATA%\GitHub CLI`，缺了会被误判"未登录"从而跳过 Release 创建）。
- `.gitattributes`：强制 `*.sh` / `*.js` 用 LF，避免 `core.autocrlf` 把脚本换成 CRLF 后在 Git Bash 里报 `bad interpreter`。

## [1.4.1] — 2026-11-02

**补齐 uvx 类 MCP 的启动失败根因、服务名合法性与 dry-run 脱敏**

- **`--uvx-python <版本>`（新增参数）**：uvx 类 MCP 启动失败的**头号原因**是 uvx 默认用「最新 Python」——新版刚发布时 `pydantic-core` / `onnxruntime` / `tokenizers` 没有预编译 wheel，uvx 退化成拉 sdist 现场编译 Rust/C++，在宿主启动预算内必然超时，表现为 `Failed to connect` / `Connection closed`，日志里有 `cargo rustc` / `maturin failed`。钉扎 3.12 即可绕开。
  本机实测 `uv python list` 默认已是 **3.14.7**，正踩在这个组合上，不是纸上风险。生成的 args 顺序有讲究：`["--python","3.12","--with",…,"<包名>"]`（选项必须在包名之前）。
- **`onnxruntime` DLL 依赖坑**（排错表）：缺 VC++ 2015-2022 Redistributable 会报 `ImportError: DLL load failed ... onnxruntime_pybind11_state`，与 mcp.json 无关。
- **「配置刚改」vs「连接器已掉线」二分法**（交付清单 + 排错表）：原文档一律叫人重启 WorkBuddy。实际应区分——**配置改过** → 重启重读；**配置没动、只是某个连接器掉线** → 连接器页点「重新连接」重生进程，不必重启整个应用。
- **服务名合法性校验 + 「新服务必须是独立键」铁律**：`scaffold_mcp.js` 新增 `sanitizeName` / `assertName`，显式 `--name` 含非法字符直接拒绝并给建议名（未写入任何文件）；从路径推断的名称自动规范化。现有 24 个条目实测全部合规。铁律新增第 7、8 条（不要塞进已有条目的 `env`；名称字符集限制）。
- **`--dry-run` 输出脱敏（顺手修的自身漏洞）**：原 dry-run 会把整份 mcp.json 打进终端，含 5 个明文 apikey，粘贴进聊天/工单即泄露。新增 `maskDeep()`：URL 里的凭据参数换成 `***`、`env`/`headers` 里的 `*_KEY`/`*_TOKEN`/`*_PASSWORD` 只留首尾与长度；「条目:」回显同样脱敏。**落盘仍写原值**（已实测文件未被改动）。
- **新增 §9「把这份配置搬到别的 Agent」**：Claude Code / Cursor / Antigravity 的路径、字段、生效方式对照。其中最有价值的硬事实是 **Claude Code 必须用 `claude mcp add` 注册，手改 `.mcp.json` 不被识别**；Antigravity 用 `transport: "stdio"` 而 WorkBuddy 用 `type: "stdio"`。注明"发给客户前先脱敏"。

**本轮评估过、决定暂不支持的做法（附理由，避免以后反复纠结）**
- **scope 体系（local / user / project）**：WorkBuddy 只有 `~/.workbuddy/mcp.json` 单文件、用户级；工作区内实测无项目级配置。强行引入只会让 agent 多问一轮无用的问题。
- **多配置文件排查清单、热重载命令（`/reload-plugins` / `/mcp` / `/doctor`）、UTCP / code-mode / isolated-vm**：均属其它宿主专属，WorkBuddy 无对应物。
- **`${VAR}` 环境变量插值**：概念对我们有用（mcp.json 里 key 是明文），但**在 WorkBuddy 上是否支持未能验证**（官方文档 MCP 页 404、站内搜索无结果），不写入文档以免造成"以为支持"的错误预期；待验证后再补。
- **预置"常用服务清单"**：不可靠。实测 `npm view @anthropics/mcp-playwright` → **不存在**（真包名是 `@playwright/mcp` 0.0.84）。**带错误的包名清单不能写进文档**，本技能继续坚持"包名必须来自用户或官方来源，绝不猜"。

## [1.4.0] — 2026-11-02

**补齐远端验证的短板：新增 `probe_mcp_http.js`；修掉 `verify_mcp.js` 让 experimental 自愈长期失效的取值 bug**

背景：对验证能力做了一次全量自检并拿本机 24 个真实 MCP 交叉实测，发现两个实质缺口——
① 远端（streamableHttp）验证只有 `curl -I`，答不了"凭据是否有效、工具是否真能调"；
② `verify_mcp.js` 从 `tools/list` 的响应里取 `serverInfo` / `capabilities`，而这两个字段只在 `initialize` 响应里存在，
导致 `serverInfo` 恒为 `null`、`capabilities` 永远取不到，**`capabilities.experimental` 检测与 `--harden` 自愈在验收入口上是死代码**。

- **修 `verify_mcp.js` 取值 bug（核心）**：把 `serverInfo` / `capabilities` / `protocolVersion` 的捕获挪到 `id===1`（initialize）分支，
  再随结果返回。修复后用带非空 `experimental` 的 mock 服务端实测：检测告警 → `--harden` 剥离 → 复验通过，链路完整走通。
- **`verify_mcp.js` 新增 `initialize` 报错直报**：服务端明确拒绝初始化时（如协议版本不兼容），原先会被忽略并最终报成"超时"，
  把人引向"缺依赖 / 路径错"的错误方向；现在直接报协议层错误并提示可用 `--harden`。
- **`verify_mcp.js` 输出与措辞校准**：打印 `serverInfo` 名称+版本、`protocolVersion`、工具数与清单；GBK 探测结论由
  "源码本身 UTF-8 安全，无隐患"（过乐观）改为"协议流不受编码影响"，并新增 stderr 日志乱码提示（实测中确有服务端 stdout 正常、stderr 乱码）。
- **新增 `scripts/probe_mcp_http.js`（远端四步实测）**：
  - **四种鉴权形态自动识别**：`url`（`?apikey=`）/ `bearer`（Authorization 头）/ `header`（自定义头）/ `env`（宿主转发成同名头）；
  - **真对照按形态剥**：URL-key 型删 URL 参数、头型删头。修掉"只删 Authorization 就去断言鉴权未生效"的经典误判；
  - **结论措辞对齐证据强度**：凭据"必需"= 无凭据被 401/403；凭据"有效"只认"无凭据被拒 + 真实 `tools/call` 成功"，握手成功只算"没被拒"；
  - **识别 `result.isError`**：MCP 把业务错误包在 `result.isError` 里、HTTP 仍 200，只看 `error` 字段会把执行失败误判成成功（实测踩到，已单独判定并给退出码 2）；
  - **会话失效旁路**：每次运行重新握手，宿主 session 过期时可直接 `--call` 继续干活；区分"从没成功过（缺 initialized）"与"先成功后全挂（会话过期）"；
  - 支持 `--name` 直读 `mcp.json`（验宿主实际会用的配置，含注入 env）、`--url` 直连、`--no-contrast`、`--timeout`、`--protocol`；
  - 输出**凭据脱敏**（`apikey=***`、令牌只留首尾），避免把 key 贴进聊天记录。
- **SKILL.md 重构验证章节**：新增 §0.1「唯一入口 + 验证器按传输形态分工」；§5 拆成 5.1 stdio / 5.2 远端四步；
  方案一不再用 `curl -I` 交付；排错表新增 7 行（URL-key 误判、401 字段名、403 scope、会话过期、`isError` 藏 200、冷启动等）；
  新增 §8 脚本清单与退出码，§9 边界说明。
- **实测**：`probe_mcp_http.js` 对 `patsnap-patent-legal`（URL-key 型）→ 剥 apikey 得 **401 + WWW-Authenticate(scope=mcp:read)**，
  真实调用 `legal_data` 成功；伪造工具名 → 正确判为 `isError` 失败并给退出码 2；`string`（公开端点）→ 正确判定"未发现凭据、跳过对照"；
  Bearer / 自定义头两种形态用合成参数各跑一遍，均正确给出"该端点未校验此凭据"而非"令牌有效"。
- **定位说明**：本技能是 MCP 配置的唯一入口，验证按传输形态分工——`command`（本地 stdio）用 `verify_mcp.js`，
  `url`（远端）用 `probe_mcp_http.js`，两者都支持 `--name` 直读 `mcp.json`，不必手敲命令。

## [1.3.1] — 2026-11-01

**去掉"缺 uv 就报错"的门槛：向导自动补装 uv；并更正 1.3.0 的一处归因错误**

- **`lang.js` 新增 `ensureUv()` 自动补装**：原先检测不到 `uv` 就直接抛错停下，让用户自己去装（对一个"配置 MCP"的助手来说，这一步足以劝退非 IT 背景的研发同事）。现在改为分三段走：
  1. `tryUvBin()` 依次试 `uv`（PATH）、`~/.local/bin`、`~/.cargo/bin`、`%APPDATA%\Python\Python3xx\Scripts`；
  2. 都没有 → `findPythonForPip()` 优先用 **WorkBuddy 自带的 `binaries/python/envs/default`**（一定存在，不依赖用户自己装过 Python），执行 `pip install --user uv`，失败再试直装；
  3. 装完重新定位并缓存到 `UV_BIN`，后续 `uv sync` 与 `--uv` 模式统一复用该绝对路径。
  最终仍失败才抛错，且文案给三条出路（安装包 / `pip install uv` / `winget`）+ 明确"这一步只需做一次"。
- **`handlePython` 改用 `UV_BIN`**：`uv sync` 与 `--uv` 模式不再写死字符串 `'uv'`，避免"uv 装在非 PATH 目录时找不到"。
- **SKILL.md 三处表述同步更新**：暂停规则、失败处理、语言速查表里"需本机装 uv"统一改为"缺失时向导自动补装，用户无需手动操作"。
- **更正 1.3.0 的一处归因错误**（见下条注记）：这不是功能改动，但它会导致误判，必须留档纠正。
- **实测**：`findPythonForPip` → 命中 WorkBuddy 自带 python 3.13；`findUvCandidate` → 命中 PATH 的 `uv`；`handlePython` 默认模式与 `--uv` 模式均正常生成条目并带 env；`--from-zip` 全流程（解压 → uv sync → 定位 venv → 生成条目 → 自检）真实跑通。

> **对 1.3.0 的更正**：1.3.0 里写的"在 Git Bash 里手工跑同一份代码一直是成功的（终端是 UTF-8）"**不准确**。2026-11-01 二次实测：本机 Git Bash 中该 Python 的 `sys.stdout.encoding` 默认就是 `gbk`（系统 code page 936），不设任何 `PYTHON*` 变量跑旧版 gdc 源码，同样抛 `UnicodeEncodeError`。能否复现取决于终端与 Python codepage 的组合，**不能靠"我这儿能跑"下结论**。同时确认更本质的判据：`sys.stdout.errors = strict`（无法编码即崩）、`sys.stderr.errors = backslashreplace`（转义成 `\uXXXX` 照常输出）——**只有 stdout 会崩，stderr 不会**，所以 `print(..., file=sys.stderr)` 和默认走 stderr 的 `logging` 都安全。

## [1.3.0] — 2026-11-01

**Python 类 MCP 在中文 Windows 上的"必崩陷阱"：默认注入 UTF-8 兜底 + GBK 模拟冒烟测试**

背景（真实故障，非假设）：某个 Python 写的 MCP（`nci-gdc-mcp-server`）在 WorkBuddy 里反复报 `-32000: Connection closed`，同一批 20+ 个 MCP 全部正常。根因是服务端源码第 123 行往 stdout 打印了一段带 emoji 的启动横幅，而宿主拉起子进程时 Python 的 stdout 编码是 **GBK(cp936)**，`UnicodeEncodeError: 'gbk' codec can't encode character '\U0001f50d'` → 进程在 `initialize` 之前 exit(1)。最坑的是：在 Git Bash 里手工跑同一份代码**一直是成功的**（终端是 UTF-8），所以极易误判成"配置没问题"。

- **`lang.js` 新增 `PY_ENV`，所有 Python 条目默认注入** `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1`（venv 绝对路径与 `uv run` 两种模式都覆盖）。这是对**任何**会输出非 GBK 字符的 Python MCP 都成立的通用兜底。
- **`scaffold_mcp.js` 改 `--env` 为合并**：原先是 `ent.env = env` 直接覆盖，用户一旦传 `--env`（例如带 API key）就会把编码兜底冲掉。现改为 `{ ...ent.env, ...env }`，8 处入口统一。
- **`selfCheck` 带上条目真实 env**：原先只用 `process.env`，自检环境与宿主实际环境不一致，会给出假阴性/假阳性。现签名扩展为 `selfCheck(cmd, timeout, extraEnv)`，并在超时时识别 `UnicodeEncodeError` 给出人话解释。
- **`verify_mcp.js` 新增两项检查**：
  - **GBK 编码探测**（Python 条目自动触发）：握手成功后再用强制 GBK 环境握一次手。通过 = 源码本身安全；失败 = 依赖 env 兜底，并提示"别人照抄源码漏配 env 就会复现"。`--no-gbk` 可跳过。
  - **stdout 污染检测**：收集 stdout 里非 JSON-RPC 的行，协议流被横幅污染时单独告警。
- **失败报错重写**：握手期崩溃若命中 `UnicodeEncodeError`，直接给出根因 + 两条修法（加 env / 改源码输出到 stderr）+ 那句最关键的提醒「终端里手跑通常不报错，不代表宿主里没问题」。
- **SKILL.md**：握手验证节新增「Python 类：编码探测」小节；排错速查表新增 `-32000: Connection closed` 专项行。全文仍控制在 500 行内。
- **实测覆盖**（4 组，全部真实跑通）：①已修源码 + 强制 GBK → PASS 16 工具；②未修源码 + 强制 GBK → 精确检出 `UnicodeEncodeError`；③未修源码 + 无 env + GBK 宿主 → 走专项报错文案；④`handlePython` 两种模式返回条目均含 env。

## [1.2.2] — 2026-11-01

**编译型语言（Go/Rust/Java/.NET）不再"劝退"——改为给出口而不是给命令**

背景：识别能力保留（不改动任何检测逻辑），但原先把"本机未安装 Go"直接抛给用户、让用户装完重跑，对非 IT 的研发同事等于当场宣告失败，且会让他认为 skill 不好用。

- **重写缺工具链的提示文案**：第一句先交代"不是你的操作问题、其它 MCP 不受影响、mcp.json 未被改动"，再给**三条按成功率排序的出路**。其中第 1 条（用作者发布的现成可执行文件）**完全不需要装任何环境**；第 3 条才是装工具链，并明确标注"需 IT/开发同学出手"。
- **新增 `--bin` / `--bin-args` 参数**：可直接注册作者发布的现成可执行程序（`.exe`/`.jar` 等），不复制源码、不装工具链。这是"AI 去 GitHub Releases 下载 → `--bin` 注册"这条免环境路径的落地实现。已用真实 MCP 程序实测：注册 + `--self-check` 握手通过。
- **失败自动回滚复制**：编译型语言在复制后失败时，自动删除本次复制的安装目录。此前失败会留下半装目录，用户按提示装好工具链重跑时会撞上"安装目录已存在"，造成二次劝退。实测确认目录与 `mcp.json` 均无残留。
- **`--harden` 对二进制如实说明**：编译好的可执行文件无法就地剥离 `experimental` 广播，改为明确提示"找作者新版本 / 换云端版 / 联系作者"，不再假装能自动修。
- **SKILL.md**：新增小节「编译型语言缺工具链时——禁止劝退式回复」（三条出路表 + 文案铁律）；参数纠正表新增 3 行（禁止直接叫用户装 Go、已有 .exe 不必再走 `--from-dir`、`--bin` 必配 `--self-check`）。

## [1.2.1] — 2026-11-01

**稳定性加固（基于一次完整审计，全部经实测复现 + 回归验证）**

- **写入安全（P0）**：`writeMcpJson` 改为「序列化自校验 → 备份 `<配置文件名>.bak` → 临时文件 + 原子改名替换」。此前是直接 `writeFileSync` 整份覆盖，若写入中途断电/被杀/磁盘满，会留下半截 JSON 导致**全部 MCP 配置不可用**且无备份。
- **同名重配不再丢凭据（P1）**：覆盖已存在的同名 server 时，**保留原条目 `env`**（token/key 不再被抹掉），并明确提示会备份。此前实测 `env.MY_TOKEN` 会被静默清除。
- **解压失败给出可读原因（P1）**：`extractZip` 在 `unzip` 与系统解压都不可用时，原先抛 `❌ 解压失败: `（错误信息为空、用户无从下手）；现输出真实原因（如 `spawnSync powershell ENOENT`）+ 两条解决建议（手动解压改 `--from-dir`）。
- **自检失败给出回滚路径（P2）**：握手失败时提示可用 `.bak` 撤销本次写入。
- **SKILL.md 补「参数纠正表」**：覆盖 7 类常见命令参数误用（如对 Python 包传 `--npm-install`、`--from-dir` 指向 zip、猜 `npx` 包名），减少 AI 误用导致的配置失败。
- **SKILL.md 铁律新增第 6 条**：写明写入即备份 / 原子替换 / 保留 env 的保证。
- **新增「暂停规则」（硬门禁，5 种必须停下）**：缺凭据 / 包标记无法识别 / 缺运行时 / 自检握手失败 / 包与需求不匹配 —— 命中即停并用人话说明，明确禁止"先配了再说"、猜占位符、擅自降级方案。
- **新增执行台账（落盘）**：每次配置成功或失败都追加一行到 `~/.workbuddy/mcp-servers/.install-log.jsonl`（时间/服务名/语言/command/失败原因），批量配多个 MCP 时用它核对进度、中断后不必凭记忆重跑。
- **修复内层 catch 绕过统一错误处理**：入口构建段的 `try/catch` 原先直接 `process.exit(1)`，绕过外层 `main().catch`，导致最常见的失败（包不对 / 缺运行时 / 参数错）既不落盘也无统一处理。现已补齐落盘。
- **新增 `skill.manifest.json`**：声明运行时（Node ≥18、零第三方依赖）与产出路径，便于技能中心与审计工具识别。
- 注：`skill-auditor` 的 prescreen 把 `has_scripts` 判为 false 是因其只统计 `scripts/*.py`，与本 skill 全 JS 实现无关；补 manifest 不改变该判定，此处如实记录以免误判为缺陷。
- 审计工具复核：prescreen v3.5.0 自动 fail 由 4 项降为 **0 项**（自动 pass 2 → 6）；SKILL.md **338 行**（< 500 上限）。
- 回归实测通过：含空格路径 zip、`unzip` 失败回退系统解压、无任何解压工具时的报错、非法 JSON 的 fail-closed（原文件不被改、不产生 `.bak`/`.tmp` 残留）、同名覆盖保留 env 且备份内容正确。
- 对应 GitHub tag：`v1.2.1`
- 对应技能中心版本：`1.2.1`

---

## [1.2.0] — 2026-11-01

- **极简模式（面向非技术用户一句话配置）**：新增 5.0 节，明确当用户用大白话提出「配置 XX mcp，zip 在 YY」／「配置 XX mcp，这是源码包（附附件）」等请求时，AI 直接全自动执行——不反问命令行参数、不要求用户背命令。Python 与 Node 走同一条 `--from-zip` / `--from-dir` 命令，语言由脚本自动识别。
- **`--name` 可省略（自动推断）**：`--from-dir` / `--from-zip` 不再强制要求 `--name`；未提供时从目录名 / zip 文件名自动推断服务名（如 `gdc-mcp-server-source.zip` → `gdc-mcp-server`），进一步降低对非 IT 用户的门槛。
- 实测：仅用 `--from-zip "<zip>" --self-check`（无 `--name`）即可完成「识别 Python → uv sync 装依赖 → 生成 venv 绝对路径条目 → 握手自检通过」的完整链路。
- 对应 GitHub tag：`v1.2.0`
- 对应技能中心版本：`1.2.0`

---

## [1.1.0] — 2026-11-01

- **运行时类型自动识别（多语言一致体验）**：本地包（文件夹/zip）现在按"标记文件"自动识别语言，无需用户判断 Node / Python / Go / Rust / Java / .NET / Ruby / PHP / Docker。
- **Python 本地包完整自动化**（原 1.0.0 仅描述、未实装，本次补齐）：`--from-dir` / `--from-zip` 对 Python 包自动 `uv sync` 装依赖到 `.venv`、识别入口（`pyproject.toml` 的 `[project.scripts]` / `py-modules` / 常见 `server.py` 等，或 `--entry` 手动指定）、生成配置并握手验证。
  - 默认生成 **venv 绝对路径** command（运行时不再依赖 PATH 中有 uv，消除 `Connection closed` 类启动崩溃）；支持 `--uv` 改用可移植的 `uv --directory run`。
  - 新增 `--uvx-pkg`：Python 包已发布到 PyPI/uv 源时，直接 `uvx` 拉取（无本地路径，等同 npx）；可配 `--uvx-with`。
- **verify_mcp.js 兼容 Python 条目**：直接 spawn venv python 做握手，并对 `--harden` 区分 Node / Python（Python 剥离 `.py` 里的 experimental 广播，无需重编译）。
- **预案**：Go / Rust 识别后若包含预编译二进制直接采用；Java / .NET 识别后在装有工具链时自动编译，缺工具链给出清晰安装指引。Docker 类型识别后提示走 HTTP 端点（后续可加 `--from-docker`）。
- **架构**：抽离 `scripts/lang.js`（detectLang / resolveLocalPackage / 各语言 handler），新增语言只需在其 `handleLang` 加一个分支，无需改动 `scaffold_mcp.js`。
- 对应 GitHub tag：`v1.1.0`
- 对应技能中心版本：`1.1.0`

---

## [1.0.0] — 2026-10-31

- 首个公开发布版本。
- 能力范围：
  - 从**本地 zip / npm 包 / 远端 git URL** 生成 `~/.workbuddy/mcp.json` 条目；
  - Node 包自动 `npm install` + 编译；Python / FastMCP 包用 `uv` 处理；
  - stdio **握手自检**（`initialize` / `tools/list`），对干净服务器不误报；
  - 远端 streamableHttp **鉴权字段**（env / headers / url）识别与排错；
  - **跨平台可移植**：默认裸 `node`（PATH 解析），可选绝对路径单机加固；
  - curated 补丁注册表（如 openpharma fda-mcp-server 的 experimental 广播修复）。
- 对应 GitHub tag：`v1.0.0`
- 对应技能中心版本：`1.0.0`（发布时填写）
