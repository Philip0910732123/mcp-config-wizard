---
name: mcp-config-wizard
description: 面向生物医药研发场景，把"选什么/审什么"（决策）与"怎么装进 WorkBuddy / 装完到底通不通"（执行+验证）合二为一。覆盖：按需选型清单（商业 SaaS 情报类 + 化学/靶点/临床/结构等科学数据 MCP，几十个也能管）、安装前安全审查、配置进 WorkBuddy（云端 streamableHttp / 本地 stdio 自动脚手架）、**远端协议级深验（鉴权形态自动识别 → 真对照 → 会话 → tools/list → 真实调用）**、多 MCP 治理与排错。触发词：配置 MCP、加一个 MCP 服务、MCP 选型、MCP 安全吗、MCP 配不上、MCP 连不上、工具没出现、这个连接器正常吗、令牌是不是有效、工具中文乱码、Connection closed、Unknown or missing Mcp-Session-Id、MCP 太多怎么管、配置 PDB/ChEMBL/智慧芽、给 AI 接数据源/API。不适用于：MCP 服务端源码开发/从零编写（本 skill 只做接入与治理，不写服务本身）、非 WorkBuddy 平台的 MCP 配置（路径与入口不同）、纯理论科普而不落地配置。
slug: mcp-config-wizard
displayName: MCP 选型与配置向导
version: 1.4.3
summary: 生物医药研发场景的 MCP 选型、安全审查、一键配置与协议级实测验证；覆盖 stdio / streamableHttp 接入、四种鉴权形态的真对照、多 MCP 治理排错。
license: Apache-2.0
---

# MCP 选型与配置向导

## 0. 定位与何时使用

你是用户的「MCP 装备顾问 + 装机工程师」：**先帮用户想清楚要哪个、安不安全，再帮他把服务真正配进 WorkBuddy 并验证能跑**。

适用场景（命中即触发）：
- 「有哪些 MCP 值得装 / 我该选哪个？」「这个 MCP 安全吗？」
- 「帮我把 XX 数据源 / API / MCP 配进 WorkBuddy」「配置 PDB / ChEMBL / 智慧芽 / Open Targets」
- 「MCP 配不上 / 配不进去 / 配了不生效」「我装了几十个 MCP，怎么管？」

一句话决策流：**需求驱动 → 安全审查 → 按需启用 → 配置验证 → 持续治理**。

### 0.1 本技能是唯一入口，验证器按传输形态分工

用户说「配不上 / 连不上 / 工具没出现 / 令牌有效吗」时，**不要转去别的技能**——选型、安装、协议级验证、排错全在本技能内闭环。验证按传输形态分两个脚本，别用错：

| 条目形态 | 判断依据 | 用哪个脚本 | 验的是什么 |
|---|---|---|---|
| **stdio 本地** | `mcp.json` 里是 `command` + `args` | `verify_mcp.js` | spawn 进程 → initialize → tools/list + 编码探测 |
| **streamableHttp 远端** | 有 `url`（无 `command`） | `probe_mcp_http.js` | 鉴权真对照 → initialize → session → tools/list → 可选真实调用 |

两者都支持 `--name <名字>` 直读 `~/.workbuddy/mcp.json`，**验的就是宿主实际会用的那份配置（含注入的 env）**，而不是你手敲的近似命令。

> 只做「HTTP 200 / 能握手」就交付，是这个领域最常见的假阳性。**远端要能说清三件事：凭据是不是必需、凭据是不是有效、工具是不是真能调**（详见 5.2）。

---

## 1. 价值观与规模观（核心，先立）

1. **按需启用，不限定数量**。MCP 总数没有上限——生物医药研发场景常需几十个（专利、文献、化学、靶点、临床、结构、办公协同各取所需）。**关键不是"装几个"，而是"当前用几个"**：把当下任务不用的服务器在连接器页关掉（不点「信任」或关闭开关），避免全部常驻导致工具过多、模型选错工具、上下文臃肿、权限面过大。
2. **先审后装**。MCP 拥有你授予的真实系统权限，来源不明 = 开后门。任何新服务落地前过一遍第 4 节的审查。
3. **需求驱动**。从「我要 AI 帮我查什么、干什么」出发选服务，不从「有什么酷的」出发。

---

## 2. 一分钟理解 MCP（科普）

类比：**MCP 是 AI 助手的「USB 接口标准」**。AI 本体只会对话；插上「专利读卡器」能查专利，插上「化学数据库读卡器」能拉化合物活性。MCP 统一了插口规范，任何工具按规范实现，任何支持 MCP 的 AI 都能用。

三个关键角色：**宿主**（你的 AI 应用，如 WorkBuddy）→ **MCP 服务器**（能力提供方）→ **实际资源**（文件 / 数据库 / API）。

---

## 3. 生物医药研发场景：MCP 选型清单

按真实工作流分类。**这是"类别框架"，不是固定清单**——具体装哪些由你的实际数据源决定；下表实例仅为举例，重点在于每行都标了「配置归口」（走方案一云端，还是方案二本地）。风险级参考第 4 节审查。**不强制"只装几个"——列全你需要的，再按频率决定常驻还是按需启用。**

| 需求 | 服务器类型 | 配置归口 | 风险级 |
|---|---|---|---|
| 专利 / 文献 / 医药情报 | 商业 SaaS 情报类（如智慧芽系列，付费） | **方案一·云端**：给 JSON + API key 即可，无需本地文件 | 中（付费 key 管理） |
| 化合物 / 活性 / 靶点 / 临床 / 结构 | 公开科学数据库类（机构官方维护） | 多为**方案一·云端**（官方 API + key/token）；少数提供本地包的走方案二 | 低 |
| 通用联网搜索 | 搜索类 | 方案一·云端 | 低（关注配额） |
| 本地项目文档 / 笔记 | 文件系统类 | 方案二·本地（限定目录白名单） | 中 |
| 办公协同（邮件/日历/IM） | SaaS 集成类 | 依提供方（云端或连接器接入） | 高（"发送"类权限最谨慎） |

> 关键点：**凡"给一段 JSON + API key 就能配"的商业 / SaaS 类 MCP（智慧芽付费 MCP 即典型代表），一律走方案一云端，不需要任何本地文件或 `npm install`**；只有"下载下来的包 / zip / 文件夹"才走方案二。选型时先判断归口，再按对应方案执行。

**分层建议**（非数量上限，只是告诉你哪类该常驻）：
- **常驻（高频）**：你每天必用的 1–3 个核心源（如商业情报 SaaS + 主力科学数据库）。
- **按需启用（低频）**：结构、临床、靶点、文件系统、办公协同等——用到时再去连接器页开启，用完可关。

---

## 4. 安装前安全审查（五步法 + 生物医药注记）

1. **查来源**：官方组织 / 知名机构出品优先（智慧芽官方、EMBL-EBI、RCSB、Open Targets 等都算可信源）；个人仓库看 star、更新频率、issue 响应。三无仓库不装。
2. **读权限**：它要什么权限？文件类看目录范围，API 类看 token 范围。**要的权限超过功能所需 = 红旗**。
3. **看配置**：密钥是放环境变量（`env`）还是明文写死？支持只读模式吗？
4. **扫行为**：装前浏览源码入口——有没有向陌生域名上报数据、有没有动态下载执行代码。
5. **最小授权试运行**：先用测试目录 / 只读账号跑通，确认行为干净再给正式权限。

**高危信号（任一即弃）**：要求关闭安全确认、混淆代码、安装脚本要 sudo、README 与实际行为不符。

**生物医药场景额外注记**：
- **商业 SaaS / 付费 MCP 的 key 管理**：付费 / 商业 SaaS 类 MCP（如智慧芽系列）的 API key 以明文存在 `~/.workbuddy/mcp.json`，提醒用户**勿外泄、勿截图外传**；团队共用配置模板时密钥各自注入，模板不含任何真实凭证。
- **科学数据源可信度**：优先选官方 / 学术机构维护的（带机构域名、有 DOI / 引用、更新活跃）。对长期不更新的个人镜像保持警惕，数据可能过期。

---

## 5. 执行：配置进 WorkBuddy

> 全程不要手写 mcp.json，用本 skill 的脚本（`scripts/scaffold_mcp.js` 写入 / `scripts/verify_mcp.js` 验 stdio / `scripts/probe_mcp_http.js` 验远端）。核心只让用户提供：**配置来源（JSON/URL 或本地文件）** 与 **凭据（API key / 用户名密码）**。

### 铁律（强制执行层：先读，违反即失败）
1. **绝不上网搜索 / 下载 MCP 源码**。源码只能来自：用户给的 JSON、用户给的 URL、用户给的本地文件 / 文件夹 / zip。找不到就让用户提供。
2. **单份 `index.js` 几乎都不够**（Node 同理：单份 `.py` 也不够）。Node 的 `.js` 通常 `import` 外部包（如 `@modelcontextprotocol/sdk`、`axios`），必须有 `node_modules`；Python 的 `.py` 需要 `uv sync` 生成的 `.venv` 依赖。所以本地型要让用户提供"整个包"，或允许 `npm install` / `uv sync`——**这些向导都会自动处理**。
3. 本地包**统一放到 `~/.workbuddy/mcp-servers/<服务名>/`**（脚本自动复制；也可让用户自己放）。
4. WorkBuddy 的 mcp.json 每条**必须带 `type`**：本地 `stdio`，远程 `streamableHttp`。脚本已自动处理。
5. 第三方真实服务**禁止用 `--from-template`**（那只是「hello」占位骨架，握手能过但根本不是真服务）。
6. **写入即备份**：脚本在改写 `mcp.json` 前会自动存一份同名 `.bak`，并用「临时文件 + 原子改名」替换，避免半截写入毁掉全部 MCP 配置。重配同名服务时，**原条目的 `env` 凭据会被保留**（不会被新条目抹掉）。
7. **新增服务必须是 `mcpServers` 下的独立键**。不要把它塞进某个已有条目的 `env` 或 args 里——宿主只会按顶层键注册服务，塞进去等于没配。
8. **服务名只用字母、数字、点、下划线、连字符**。带空格 / 中文 / 斜杠的名字会让连接器页显示与工具路由出问题，脚本会直接拒绝并给建议名。

### 暂停规则（必须暂停的 5 种情况）

以下是**必须暂停**的硬门禁：命中任一条就停下手，用人话把情况告诉用户，**不得"先配了再说"、不得猜、不得擅自降级方案**。

| 情况 | 停下来做什么 |
|---|---|
| 需要凭据（key / 账号）但用户没给 | 直接问用户要真实值。**绝不编造、绝不先用占位符写进去** |
| 包里找不到任何可识别标记（`package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` …） | 告诉用户"这不像完整源码包"，请其确认或补发完整包；**不要试图自己拼一个** |
| 本机缺运行时（`uv` / `npm` / `go` / `java`） | **`uv` 自动补装**（向导会用本机 python 执行 `pip install uv`，用户无需任何操作）；`npm` / `go` / `java` 给安装指引后停。**不要偷偷换成猜的绝对路径**或改别的运行时 |
| 自检握手失败 | 只能报「已写入但未通过验证」，**不得说"配好了"**；同时给出 `.bak` 回滚路径 |
| 包与需求不匹配（如要查 TCGA 却给了通用 HTTP 工具） | 先说清不匹配点，让用户决定，不要闷头配完 |

## 5.0 极简模式（非技术用户：一句话就能配，无需懂命令行）

本 skill 支持「用户只说大白话，AI 全自动配好」的体验。**当用户的请求符合下面任一类时，AI 直接执行，不要反问命令行参数、不要列出命令让用户选、不要要求用户背命令**：

- 「配置 GDC mcp，zip 在 `D:\共享\gdc-mcp-server-source.zip`」
- 「配置 XX mcp，这是源码包（附 zip 附件）」
- 「帮我加一下这个 MCP，文件夹在 `YY` 路径」

**AI 应执行的固定动作（不变量）**：
1. 从用户的话里提取服务名（如「GDC」→ `gdc`）；提取 zip / 文件夹路径（若用户上传了附件，取附件的绝对路径）。
2. 若用户没明说名字，**不要问**——脚本已支持 `--name` 省略，会自动从路径文件名推断（如 `gdc-mcp-server-source.zip` → `gdc-mcp-server`）。
3. 直接执行（Python / Node 等任意类型都一样，脚本自动识别语言）：
   - 给的是 zip：  `node scripts/scaffold_mcp.js --from-zip "<zip路径>" --self-check`
   - 给的是文件夹：`node scripts/scaffold_mcp.js --from-dir "<文件夹路径>" --self-check`
4. 把结果翻译成大白话回用户：
   - 成功：「✅ 已帮你把 `<name>` 配好并验证通过（N 个工具可用）。请**重启 WorkBuddy** → 连接器页右上角「自定义连接器」→ 找到 `<name>` → 点「信任」即可使用。」
   - 失败（如 `uv sync` 网络问题）：把报错翻成人话告诉用户该怎么处理，**不要直接甩 stderr**。缺 `uv` 本身不算失败——向导会自动 `pip install uv` 补装。
5. 始终保留「重启 + 信任」两步提醒（见交付清单）。

> **核心原则**：用户永远只说「配置 XX，给包 / 给路径」这一句话；其余的「识别语言、装依赖、配本机路径、握手验证」全部由 AI + 脚本完成，这才算「丝滑」。面向药企研发等非 IT 用户时，**默认走极简模式**。

### 第 0 步：判断来源（非必须问答）
> 若用户在请求里已经给出配置来源（JSON/URL 或 文件/zip/路径），直接进入对应方案即可，**不必反复问答**（也契合 5.0 极简模式）。只有当用户完全没给来源时，才问一句：**「你手上有这个 MCP 的配置吗？是①一段 JSON / 一个 URL，还是②本地文件（index.js）/ 文件夹 / zip？」**
- 有 JSON 或 URL → 走 **方案一**
- 有本地文件 / 文件夹 / zip → 走 **方案二**
- 都没有 → 停下，请用户提供；**不要上网找**。

**判断归口（也可对照第 3 节选型清单的「配置归口」列）：**

```
用户有配置来源？ ──否──→ 停下，请用户提供；不要上网找
       │是
       ├─ JSON / URL / 裸 URL 字符串 ─────→ 方案一·云端（streamableHttp + key）
       ├─ 文件夹 / zip（完整包）──────────→ 方案二·本地（--from-dir / --from-zip，向导自动识别 Node / Python / Go / Rust / Java 等语言）
       ├─ 单个 index.js ────────────────→ 查依赖；缺则让用户给整个包或加 --npm-install（见方案二）
       ├─ npm 包名（如 @scope/server-xxx）→ 方案二·npx（--pkg，无需下载）
       └─ Python 包名（如 kegg-mcp-server）→ 方案二·uvx（--uvx-pkg，无需下载；需 --with 依赖时加 --uvx-with）
```

### 方案一：云端 MCP（JSON / URL）
**识别**：JSON 里有 `url` 没有 `command`，或用户直接给 `http(s)://...` 链接 → 云端。（若 JSON 里有 `command`，说明其实是本地型，转方案二。）

```
# 用户给的是完整 JSON（含 mcpServers）
node scripts/scaffold_mcp.js --name <服务名> --from-json '<JSON字符串或文件路径>' --api-key <真实key>

# 用户只给了一个 URL
node scripts/scaffold_mcp.js --name <服务名> --from-url '<url>' --api-key <真实key>
```
- **密钥占位**：URL/JSON 里出现 `{your_api_key}`、`<your_api_key>`、`YOUR_API_KEY`、`REPLACE_ME` 等 → 先问用户要真实 key，用 `--api-key` 传入，脚本自动替换。
- 若没给 `--api-key` 但存在占位，脚本会报错提醒——此时回去问用户要 key。
- 验证：**不要用 `curl -I` 交付**——它只能证明端口活着，证明不了鉴权形态、也证明不了工具能调。用真探针：
  ```
  node scripts/probe_mcp_http.js --name <服务名>
  # 要拿到「凭据有效」的硬证据，再加一次只读调用：
  node scripts/probe_mcp_http.js --name <服务名> --call <只读工具名> --args '{}'
  ```

> ⚠️ **远端 streamableHttp 的鉴权字段「因服务而异」，务必以官方配置为准（实测踩坑）**：不同远端 MCP 期望的鉴权字段不同——MinerU 远端（`mcp.mineru.net`）要 `env: {MINERU_API_TOKEN: "<token>"}`（WorkBuddy 会把 `env` 转发成同名请求头 `MINERU_API_TOKEN`）；McDSaver 等则要 `headers: {"Authorization":"Bearer <token>"}`。**没有「远端必须用 headers、env 无效」的统一规则**，切勿把 A 服务的写法套到 B 服务（曾把 MinerU 错改成 `Authorization: Bearer`，被服务器 401 拒绝）。**判定方法：以该 MCP 官方配置为准；配完实测握手，若出现 401 / 鉴权错误，先查「字段名对不对、Bearer 前缀有没有漏」**，而不是盲目换字段。
> 补充：WorkBuddy 在 `streamableHttp` 下**会转发 `env`**（作为同名请求头），所以官方用 `env` 的远端服务直接照抄即可，不必改成 `headers`。
> 注：**MinerU 的 REST API 文档写的是 `Authorization: Bearer`，但其 MCP 服务端的 `mcp.mineru.net` 读的是 `MINERU_API_TOKEN` 头**（故官方 MCP 配置用 `env`）——两套鉴权字段不同、别混。其 REST 文档完全没提 MCP / `open_upload_ui`，MCP 专属行为只能看工具 schema。

> ⚠️ **远端 MCP 处理本地文件：不能直接传本地路径（实测踩坑，反复测试浪费大量时间）**：文件解析类远端 MCP（如 MinerU `mcp.mineru.net`）部署在远端、**没有本地文件系统访问权限**。调用 `parse_*` 等工具时直接传 `C:\...\xxx.pdf` / `/Users/.../x.pdf` 等本地路径会被服务器拒绝（报错如 `Local file paths are not supported on this remote server. Call open_upload_ui to get the browser upload URL instead.`）。**这不是 MCP 配置问题，是远程服务的设计限制**——改配置、换字段都没用。正确做法二选一：
> - ① **用浏览器上传 UI（推荐，走 MCP 自身机制）**：先看这个 MCP 有没有 `open_upload_ui` 类工具（MinerU 的 `mcp__mineru__open_upload_ui` 即是，仅 streamable-http 模式可用）。调用它拿到一个浏览器上传链接，用户在浏览器里把本地文件传上去、由远端解析。上传后再按需调 `parse_*` 做后续处理。
> - ② **给公开 URL**：把文件放到远端能访问到的 URL（OneDrive/网盘分享链接、公开托管等），把该 URL 传给工具。**含机密的文件不要公开托管**——这类走 ① 的上传 UI 更安全（只传到服务商自己的服务器）。
> **排错铁律：先区分「配置错」还是「远端设计限制」**。本地路径被拒 = 设计限制（与配置无关），应走上传 UI / 公开 URL；只有 401 / 握手失败才是配置或鉴权问题。配置完远端文件类 MCP 后，**测试时若涉及本地文件，先问自己：这个 MCP 有没有 `open_upload_ui`？要不要给公开 URL？不要直接拿本地路径去测。**

### 方案二：本地 MCP（文件 / 文件夹 / zip）
**先在问答里判断「单文件够不够」**：
- 用户只给 `index.js` → 检查它的 `import`。若有外部包且同目录无 `node_modules` → 明确告诉用户：「单文件不够，还缺依赖，请给我整个包（文件夹或 zip），或允许我 `npm install`」。不要硬配。
- 用户给文件夹或 zip → 直接走下面命令。

```
# 给的是文件夹（--name 可省略，省略时脚本自动从路径推断服务名）
node scripts/scaffold_mcp.js [--name <服务名>] --from-dir '<包文件夹路径>'

# 给的是 zip（极简模式首选：用户只需给路径）
node scripts/scaffold_mcp.js [--name <服务名>] --from-zip '<zip路径>'

# 包内没有 node_modules 时，若要允许安装依赖（需联网）：
node scripts/scaffold_mcp.js [--name <服务名>] --from-dir '<包文件夹>' --npm-install
```

> **极简模式（重点，呼应 5.0 节）**：药企研发等非 IT 用户只需说「配置 XX mcp，zip 在 YY」，AI 直接跑 `--from-zip "<zip路径>" --npm-install --self-check`（**name 省略、语言自动识别**）即可，用户无需懂命令行、无需记参数。Python 与 Node 走同一条命令，脚本自己认：Python 默认自动 `uv sync` 装依赖；Node 需 `--npm-install` 才会装依赖（加上无害，Python 会忽略该 flag）。

**npx 远程包方式（无需下载 zip）**：若服务提供的是 npm 包名（如 `@scope/mcp-server-xxx`），运行时由 `npx -y` 自动拉取，无需你预先下载包或 zip：
```
node scripts/scaffold_mcp.js --name <服务名> --pkg <npm包名> [--env '{"KEY":"v"}']
```
- 这是 stdio 型，脚本生成 `command: "npx"`、`args: ["-y", <包名>]` 的条目。
- 适用：以 npm 包形式发布、你不想本地保存源码的 MCP（很多科学数据 / 工具类 MCP 如此）。首次运行需联网拉包。
- 验证同样走第四节的 `verify_mcp.js` 握手。

脚本会自动：找到 `package.json` 根目录（兼容 zip 双重嵌套）→ 复制到 `~/.workbuddy/mcp-servers/<服务名>/` → 读 `main` 定位入口 → 检查 `node_modules`（缺则警告；有 `--npm-install` 则安装）→ 生成 `type:stdio / command:node / args:[入口]` 条目。

**依赖决策（各语言安装方式不同）**：
- **Python**：包内无 `.venv` 时**默认自动 `uv sync` 装依赖**（无需任何 flag；`uv` 缺失时向导自动 `pip install uv` 补装）。
- **Node**：包内无 `node_modules` 且**无 `build` 脚本**时，需显式加 `--npm-install` 才会联网安装依赖；不加则只告警、不安装（此时 MCP 会因缺依赖跑不起来）。`--from-zip "<zip>" --npm-install --self-check` 是 Node 包的稳妥写法。
- 仅当用户明确说「我有带 node_modules 的完整包 / 这是离线环境」时，才跳过安装、改让用户提供完整文件夹 / zip。

> 注：`npm install` 只是安装「用户已提供的这个包」的运行依赖（如 `@modelcontextprotocol/sdk`、`axios`），**不属于上网替用户找 MCP 源码**，不违反铁律第 1 条。

**源码包自动编译（增强）**：若 zip/文件夹里 `main` 指向的入口（如 `build/index.js`）不存在、但 `package.json` 有 `build` 脚本（典型如 TypeScript 包 `tsc` 编译），脚本会**自动 `npm install`（含 devDependencies，如 typescript）并执行 `npm run build`** 生成入口，无需手动编译。纯源码包也能端到端配好。若编译后入口仍缺失，会明确告警。

**源码补丁与握手自检自愈（增强，应对"需要修源码才能被宿主接受"的包）**：除编译外，有些包能编译、能跑，却会被严格宿主（如 WorkBuddy）在 `initialize` 握手时拒绝——例如服务器在返回的 `capabilities` 里**广播了非标准的 `experimental` 能力**（`progressNotifications` / `cancellationSupport` / `extendedMetadata`），宿主 schema 不认，报 `capabilities.experimental.* Invalid input`。向导对此有两层防护：
- **Curated 补丁注册表** `known_patches.json`（skill 根目录）：登记已知「需修源码」的包。scaffold 在复制 / 编译前后，按 `packageName` 匹配并**自动应用补丁**（如移除 `lifecycle-manager.ts` 里的 `experimental` 广播块），幂等。新增同类包只需往注册表加一条。
- **握手自检 + 自愈（兜底，覆盖未知包）**：scaffold 加 `--self-check` 会在写入后启动 MCP、发 `initialize`、检查其返回的 `capabilities`；若发现非标准 `experimental` 广播，加 `--harden` 即**自动剥离并重新编译**。即便包不在注册表里，也能自愈。
> 这两个能力是当初配 `openpharma-org/fda-mcp-server` 时踩坑（纯 TS 源码需编译 + 广播 `experimental` 被宿主拒）后补上的，已沉淀进 skill，未来同类包自动处理。

**command 形态与跨平台可移植性（设计决策）**：本地型条目默认用**可移植的运行时**：Node 用裸 `"node"`（依赖宿主 PATH 解析）；Python 默认用**venv 绝对路径**（运行时不再依赖 PATH 中有 uv，最稳，可消除「Connection closed」类启动崩溃），也支持 `--uv` 改用可移植的 `uv --directory run`。绝对路径加固默认不自动执行，需用户显式 `--node` / 指定。
- **跨用户 / 跨平台分享最稳**：各 AI 平台（WorkBuddy / Claude Desktop / VS Code / Cursor / Codex / OpenCode / 豆包工作 等）spawn MCP 时基本都会把自身或系统 node 放到 PATH；而 WorkBuddy 托管的 node 路径含**用户名与版本号、每台机器不同**，写死绝对路径反而跨机失效。
- **平台识别作为扩展点**：`scaffold_mcp.js` 内置 `detectTargetPlatform()`（当前可识别 `workbuddy` / `unknown`）。未来支持更多平台只需加分支，不破坏现有逻辑。
- **node 预检兜底**：配置时会对本地型条目跑 `node --version` 预检；若 PATH 不可达，仅提示用户常见 node 位置，**不自动改写为绝对路径**（避免破坏可移植性）。
- **绝对路径加固：默认不自动执行**。若目标机确无 node 且 PATH 不被注入，用户可手动 `--node <绝对路径>` 覆盖（属用户显式决策，非默认行为）。理由：PATH 解析失败（`spawn node ENOENT`）在主流平台概率极低，为低概率风险牺牲可移植性不划算。

**可选**：
- `--node <node.exe 绝对路径>`：node 不在 PATH 时指定（参考现有条目的写法）。
- `--overwrite`：安装目录已存在时覆盖。

### 方案二·运行时类型自动识别（2026-11 新增，重点）

**核心变化：用户不再需要知道"这是什么语言写的"。** 给一个文件夹或 zip，向导按"标记文件"自动识别运行时类型，然后按该语言的方式装依赖、找入口、生成配置、握手验证。Node 与 Python 已完整自动化；Go / Rust / Java / .NET 等做了"识别 + 预编译二进制直用 + 缺工具链时给清晰指引"的预案（见下表）。

#### 运行时类型速查表（给非 IT 用户的人话版）

| 类型 | 人话解释 | 向导自动做什么 | 你要不要装额外东西 |
|---|---|---|---|
| **云端 / SaaS** | 别人托管好的服务，给个网址+密钥就能用 | 写 `streamableHttp` 条目 | 不用 |
| **Node.js** | 用 JavaScript 写的服务（最常见） | 复制包 → `npm install` 装依赖（缺则自动编译）→ 跑 `node` | 一般不用（主流平台自带 node） |
| **Python** | 用 Python 写的服务（很多官方生物医药数据源如此） | 复制包 → `uv sync` 装依赖到本地 `.venv` → 跑 venv 里的 `python` | 需 **uv**；**缺失时向导自动 `pip install uv` 补装**，用户无需手动操作 |
| **Go / Rust** | 编译型语言，通常发布成一个独立可执行文件 | 包里自带编译好的程序就直接用；否则先走 `--bin` 注册作者发布的现成程序（见下节三条出路） | 多数情况**不用**；只有作者没发程序才需要 IT 装工具链 |
| **Java / Kotlin** | 企业级服务（如 cBioPortal 后端） | 需装 JDK + Maven/Gradle，自动打包成 `.jar` 后 `java -jar` | 需装 JDK + 构建工具 |
| **.NET / C#** | 微软生态服务 | 需装 .NET SDK，自动 `dotnet build` 后运行 | 需装 .NET SDK |
| **Ruby / PHP** | 少数服务用这俩写 | 需装对应运行时 + 包管理器，自动安装依赖 | 需装 Ruby/PHP 环境 |
| **Docker（容器）** | 服务打包在容器里，本地跑起来后通过网址连接 | 识别出 Dockerfile 后会提示走 `docker run` + HTTP 端点（后续可加 `--from-docker` 自动化） | 需本机装 Docker |

> 识别依据（标记文件）：Node=`package.json`、Python=`pyproject.toml`/`requirements.txt`、Go=`go.mod`、Rust=`Cargo.toml`、Java=`pom.xml`/`build.gradle`、.NET=`*.csproj`、Ruby=`Gemfile`、PHP=`composer.json`、Docker=`Dockerfile`/`docker-compose.yml`。

#### Python 本地包的具体用法
> 下述命令中的 `--name` 均可省略：极简模式（5.0 节）下脚本会自动从 zip / 目录名推断服务名，用户/AI 都不必显式给。
```
# 给源码文件夹（或 zip）即可，向导自动识别语言、uv sync、找入口、生成配置并握手
node scripts/scaffold_mcp.js --name <服务名> --from-dir '<Python包目录>' [--self-check]
node scripts/scaffold_mcp.js --name <服务名> --from-zip '<Python包.zip>' [--self-check]

# 入口识别不到时，用 --entry 手动指定（如 server.py / gdc_mcp_server.py）
node scripts/scaffold_mcp.js --name <服务名> --from-dir '<目录>' --entry server.py

# 想要可移植写法（不写 venv 绝对路径，改用 uv --directory run；依赖目标机 PATH 有 uv）
node scripts/scaffold_mcp.js --name <服务名> --from-dir '<目录>' --uv

# Python 包已发布到 PyPI / uv 源、不想下载源码时，用 uvx 直接拉（无本地路径，等同 npx）
node scripts/scaffold_mcp.js --name <服务名> --uvx-pkg <包名> [--uvx-with <依赖>] [--env '<环境变量>']

# uvx 装不上 / 启动超时 / 日志里出现 cargo・maturin 时，钉扎解释器版本：
node scripts/scaffold_mcp.js --name <服务名> --uvx-pkg <包名> --uvx-python 3.12
```
> 🔴 **uvx 默认用「最新 Python」，这是 Windows 上 uvx 类 MCP 最常见的启动失败原因**。新版 Python（如 3.14 / 3.15）刚发布时，`pydantic-core`、`onnxruntime`、`tokenizers` 等带二进制组件的包常常还没有对应 wheel，uvx 会退化成拉 sdist 现场编译 Rust/C++，在宿主给的启动预算内必然超时，表现就是 `Failed to connect` / `Connection closed`，日志里能看到 `cargo rustc` / `maturin failed`。
> 判定与处置：先用 `uv python list` 看本机 uv 默认版本（本机实测默认已是 3.14）；**遇到上述症状就直接加 `--uvx-python 3.12`（或任何有 wheel 的版本）重配一次**，别去怀疑 URL/令牌。
> 另一个 Windows 专属坑：包若依赖 `onnxruntime`（如经 `fastembed` 做本地向量的服务），缺 **VC++ 2015-2022 Redistributable** 会报 `ImportError: DLL load failed while importing onnxruntime_pybind11_state`。装 `winget install Microsoft.VCRedist.2015+.x64` 即可，与 mcp.json 无关。
- **默认 command 用 venv 绝对路径**（如 `.../.venv/Scripts/python.exe`），运行时不再依赖 PATH 中有 uv，最稳。
- 验证：`node scripts/verify_mcp.js --name <服务名>` 对 Python 条目同样适用（直接 spawn venv python 做握手）。

#### 编译型语言（Go / Rust / Java / .NET）缺工具链时——**禁止劝退式回复**
识别到这类包、但本机没有对应工具链时，**绝不能**第一句话就说"请先安装 Go 再重跑"。对研发同事，这等于当场宣告失败，并让他觉得这个 skill 不好用。必须按下面顺序给出路，**第 1 条完全不用装任何环境**：

| 顺序 | 做法 | 对应动作 |
|---|---|---|
| **1（首选）** | 用作者发布的现成可执行文件；AI 主动去该项目 GitHub「Releases」页下载对应平台版本 | `node scripts/scaffold_mcp.js --bin "<下载的 .exe 路径>" --name <服务名> --self-check` |
| **2** | 换云端托管版（给 URL + key 就能用） | 主动问一句「这个 MCP 有没有官方托管版 / 在线 API 版」 |
| **3（最后）** | 确实只能本地跑 → 请 IT/开发同学装一次工具链，再重跑原命令由向导自动编译 | 须明说"这一步要 IT 出手，不是你能单机解决的" |

- 给用户的第一句话必须交代**「不是你的操作问题，你的其它 MCP 不受影响，mcp.json 未改动」**（脚本已内置这段文案，直接转述，别自己另编）。
- `--bin` 务必配 `--self-check`：下载来的程序是否真会说 MCP 协议必须握过手，才能对用户说"配好了"。
- 编译型二进制若广播了 `experimental`，`--harden` **改不了二进制**：如实说"需要作者更新版本或改用云端版"，不要承诺"稍后自动修复"。

#### 扩展点（给维护者）
新增一种语言的完整自动化，只需在 `scripts/lang.js` 的 `handleLang` 里加一个 `handleXxx(installDir, a)` 分支（装依赖→找入口→返回 `entry` + `verifyCmd`），`detectLang` 已覆盖所有标记文件识别，无需改动 `scaffold_mcp.js`。

### 参数纠正表（AI 自查，防误用）

| 常见误用 | 正确做法 |
|---|---|
| 对 Python 包传 `--npm-install` | Python 走 `uv sync`，`--npm-install` 只对 Node 有意义；脚本已按语言自动选，**不用手传** |
| 本地包忘了 `--self-check` | 本地 stdio 包一律加 `--self-check`，握手失败不要告诉用户"配好了" |
| 用 `--from-dir` 指向 zip 文件 | zip 用 `--from-zip`，文件夹用 `--from-dir`，给错类型会报"找不到包标记" |
| 用 `--from-url` 配本地服务 | 本地进程配 `stdio`（走 `--from-dir`/`--from-zip`）；只有对方真给了 http(s) 端点才用 `--from-url` |
| 手写 `command` 为 `npx xxx` 猜包名 | 包名必须来自用户提供的来源；**绝不猜**（铁律 1） |
| Python 入口识别失败就放弃 | 用 `--entry server.py` 显式指定，不要改源码 |
| uvx 类启动失败就先怀疑 key / URL | 先看日志有没有 `cargo` / `maturin`：多半是 uvx 用了最新 Python、无预编译 wheel。加 `--uvx-python 3.12` 重配 |
| 服务名随手写（带空格 / 中文 / 斜杠） | 只允许字母、数字、点、下划线、连字符；脚本会直接拒绝并给出建议名，别绕过 |
| Go/Rust 包缺工具链 → 直接叫用户"装 Go 再重跑" | **禁止**。先走 `--bin` 注册作者发布的现成程序（免装环境）；装工具链是最后一条且要说明"需 IT 出手" |
| 拿到现成 `.exe` 后再跑 `--from-dir` | 已经有机可执行文件就直接 `--bin "<exe 路径>"`，不必再复制源码 |
| 用 `--bin` 却不加 `--self-check` | 下载来的程序是否真会说 MCP 协议未经验证，**必须**握手后才说"配好了" |
| 覆盖同名条目时手动补 env | 脚本已自动保留原 `env`；仅当用户要**改**凭据时才传新的 `--env` |

### 凭据自适应（按需问用户）
- 只需 API key → `--api-key`（云端）或 `--env '{"API_KEY":"..."}'`（本地）
- 用户名 + 密码 → `--env '{"DB_USER":"u","DB_PASSWORD":"p"}'`（或该服务要求的变量名）
- 其它 token / OAuth → 问清变量名，放进 `--env` 或 JSON 的 `headers`
- 永远是「先问用户要真实值」，不要编造。

### 握手验证（按形态选脚本，两类都必做）

#### 5.1 本地 stdio
```
node scripts/verify_mcp.js --name <服务名>
# 若握手报 capabilities.experimental.* Invalid input，加 --harden 自动剥离并重建后重验：
node scripts/verify_mcp.js --name <服务名> --harden
```
- 会 spawn 进程 → `initialize` → `notifications/initialized` + `tools/list` → 打印 `serverInfo` / `protocolVersion` / `capabilities` / 工具清单。
- 通过才算配好；失败按 stderr 排错（常见：缺 node_modules、node 不在 PATH、包名 / 入口错）。
- **若返回里出现非标准 `capabilities.experimental`**（非空对象才算）：说明该服务器广播了严格宿主会拒绝的能力，加 `--harden` 让向导自动剥离并重新编译、再握手复验。已知如 `openpharma-org/fda-mcp-server`。
  > 注：`experimental: {}`（空对象）是合法的，脚本**不会**误报，也不需要硬化。
- `initialize` 被明确拒绝（返回 JSON-RPC error）时会直接报协议层错误，不会再伪装成「超时」。

#### 5.2 远端 streamableHttp（四步实测，不能用 curl 代替）
```
node scripts/probe_mcp_http.js --name <服务名>
node scripts/probe_mcp_http.js --name <服务名> --call <只读工具> --args '{}'
node scripts/probe_mcp_http.js --url <url> --token <t>        # 没有 mcp.json 条目时
node scripts/probe_mcp_http.js --url "https://h/mcp?apikey=x" # URL 参数型，自动识别
```
**四步**：① 鉴权真对照 → ② `initialize` → ③ `notifications/initialized` + `tools/list` → ④ 真实调用一个只读工具。

**四种鉴权形态自动识别**（不许假设"一律 Bearer"）：

| 形态 | 配置长什么样 | 对照怎么剥 | 常见服务 |
|---|---|---|---|
| `url` | key 在 `url` 的 query 里（`?apikey=`） | **删 URL 参数**（不是删头） | 智慧芽 connect 系列 |
| `bearer` | `headers.Authorization: Bearer x` | 删 Authorization 头 | McDSaver 等 |
| `header` | 其它自定义头（`X-API-Key`） | 删该头 | 部分商业 API |
| `env` | `env: {TOKEN: x}`（宿主转发成同名头） | 删该头 | MinerU 远端 |

> 🔴 **最常见的误判**：对 URL-key 型端点只删 `Authorization` 头去做对照，会得到"未鉴权也 200 → 鉴权未生效"的**错误结论**——因为 key 一直在 URL 里没被删。`probe_mcp_http.js` 按识别到的形态剥，不会犯这个错。

**结论措辞必须对齐证据强度**（脚本已内置，别自己另编）：
- 「凭据**必需**」= 无凭据被 401/403 拒绝；
- 「凭据**有效**」只认两条硬证据：无凭据被拒 **且** 真实 `tools/call` 成功。**握手成功只等于"没被拒"，不等于"令牌有效"**；
- `tools/list` 列的是服务端全部工具，**不代表这把凭据都能调**（实测见过清单 18 个、实际 403）。汇报时分开讲「平台能做什么」和「你这把凭据能做什么」。

**两个必须识别的坑**：
- 🔴 **`result.isError: true` 藏在 200 里**：MCP 常把业务错误包成 `result.isError`，HTTP 200、也没有 JSON-RPC error。只看 `error` 字段会把「执行失败」误判成「调用成功」，凭据结论直接失真。脚本已单独判定并给 2 的退出码。
- 🔴 **`Unknown or missing Mcp-Session-Id` 有两种性质**：从没成功过 = 缺 `notifications/initialized`（协议要求，补会话流程即可）；**先成功后突然全挂** = 宿主客户端持有的 session 过期，**不是服务端故障、也不是令牌失效**——别删配置、别换令牌。诊断：直连 `initialize` 拿新 session 能通即证明服务端健康。旁路：`probe_mcp_http.js --call` 每次重握手，可直接继续干活；根治让用户重连 MCP / 重启 WorkBuddy。
- 从 403 反查 scope：故意调一个不该有的工具，服务端常回显完整允许清单，一次调用即得权限范围。

#### 5.3 Python 类 stdio 的编码探测（属 5.1，向导自动做，别跳过）

握手成功后会**再用强制 GBK 环境握一次手**。原因是中文 Windows 上宿主拉起 Python 子进程时，stdout/stderr 的编码是 GBK(cp936)；服务端只要往这两条流打印 emoji 或中文符号（启动 banner、日志前缀极常见），Python 立刻 `UnicodeEncodeError` 并在握手完成前退出，客户端只看到 **`-32000: Connection closed`**。

```
✅ 强制 GBK 仍能握手：源码本身 UTF-8 安全，无隐患
⚠️ 源码在纯 GBK 环境会崩：只能靠 env 兜底；别人照抄源码漏配 env 就会复现 -32000
```

- 向导**已默认给所有 Python 条目注入** `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1`（`lang.js` 的 `PY_ENV`）。**不要删这两条**，它们不是可选项。
- 用户传 `--env` 时是**合并**而非覆盖，凭证和编码兜底共存。
- **最容易误判的地方**：同一份代码在 Git Bash / Windows Terminal 里手跑通常正常（终端是 UTF-8），"我这儿能跑"**不构成**在宿主里能跑的证据。
- `--no-gbk` 可跳过这次探测（仅在已确认源码安全、想省时间时用）。
- 另一条独立检查：**stdout 污染检测**。若握手期间 stdout 出现非 JSON-RPC 行（横幅打到了 stdout），会单独告警——这类输出必须改到 `sys.stderr`，否则严格宿主解析失败。

### 交付清单（配完复制给用户）
1. 已把 `<服务名>` 写进 `~/.workbuddy/mcp.json`。
2. **已验证**（没验过不许说"配好了"）：stdio → 握手通过、N 个工具；远端 → 四步结论（凭据必需？凭据有效？工具可调？）。
3. **⚠️ 改了 `mcp.json` 必须重启 WorkBuddy（完全退出后重新打开，不是仅刷新对话）** —— 配置不会热更新，不重启就看不到新装的 MCP。
   > 区分两种情况，别一律叫人重启：**配置刚改过** → 重启（重读配置）；**配置没动、只是某个连接器掉线** → 到连接器页对该 server 点「重新连接」即可。
4. 重启后打开 **连接器管理页 → 右上角「自定义连接器」→ 找到 `<服务名>` → 点「信任」启用**（新 MCP 不会自动生效）。
   > 审批状态记在 `~/.workbuddy/mcp-approvals.json`。**不要自己去改这个文件"替用户信任"**——那是绕过安全确认。
5. 远端服务要一并交代**权限边界**：凭据绑定的身份、`tools/list` 清单 ≠ 实际可调范围、可见性字段默认值。
6. 调用试试（例如「用 `<服务名>` 查一下 XX」）。
7. 报错贴给我。

### 其它注意
- 永远只增改单个 server 条目，不覆盖整个 mcp.json（脚本已保证）。
- **写入安全**：改写前自动备份为 `<配置文件名>.bak`，再「临时文件 + 原子改名」替换；写入前会先自校验 JSON 可解析。若自检握手失败、想撤销，把 `.bak` 覆盖回去即可。
- **同名重配**：会提示"已存在，将覆盖"，但**保留原条目的 `env`**（token/key 不会丢）。
- **执行台账落盘**：每次配置（成功/失败）都会追加一行到 `~/.workbuddy/mcp-servers/.install-log.jsonl`。批量配多个 MCP 时用它核对进度，中断后不必凭记忆重跑。
- 密钥不硬编码进脚本 / 仓库；提醒用户 apikey 明文存在 mcp.json，勿外泄。
- mcp.json 开头若有 UTF-8 BOM，脚本会自动剥离。
- **解压依赖**：`--from-zip` 优先用 `unzip`，失败回退系统解压；两者都不可用时会给出可读原因并建议改用 `--from-dir`。
- `--from-template` 仅供「自己从零写一个 MCP」，第三方服务禁用。

---

## 6. 多 MCP 治理（几十个怎么管）

生物医药场景往往累积几十个 MCP，治理比「装几个」更重要：

- **按需启停**：用不到的服务器在连接器页关闭 / 不点「信任」，需要时一键开启。这是控制「工具过多导致模型选错、上下文臃肿」的主要手段。
- **分组心法**：脑中按领域分组（专利文献 / 化学 / 靶点 / 临床 / 结构 / 办公），当前任务只需启用相关那组。
- **季度清点**：长期不可用 / 连续 90 天没用过的，禁用或卸载，别堆着。
- **兼容性巡检**：新装一个后跑一遍验证（stdio → `verify_mcp.js`；远端 → `probe_mcp_http.js`）；注意协议版本兼容（例如某些 MCP 与宿主存在协议版本不匹配导致整体握手失败，需升级或替换）。
- **升级重审**：服务升级后权限需求变化的，重新过第 4 节审查五步法。
- **密钥轮换**：付费 MCP 的 key 泄露或过期，及时在 `mcp.json` 对应条目更新，团队共用模板不含真实凭证。

---

## 7. 配置排错速查

| 症状 | 高概率原因 | 处理 |
|---|---|---|
| 服务器列表里不出现 | 配置文件 JSON 语法错 / 路径错 | 校验 JSON；确认配置文件位置正确后重启宿主 |
| 出现但工具调用失败 | 命令不可执行 / 依赖缺失 | 手动在终端跑启动命令看报错；本地型跑 `verify_mcp.js` |
| 提示鉴权失败 | token 过期 / 环境变量没传进去 | 检查 `env` 字段拼写与 token 有效期 |
| 模型不用装好的工具 | 工具描述模糊 / 工具太多 | 精简常驻数量、关掉无关服务；任务里显式点名工具 |
| 响应超慢 | 服务器冷启动 / 网络代理 | 观察二次调用；检查代理配置 |
| 握手报协议版本不匹配 | MCP 与宿主协议版本不兼容 | 升级服务端或宿主；或暂用替代服务 |
| 本地型缺依赖 | 无 `node_modules` | 重跑脚本追加 `--npm-install` |
| 握手报 `capabilities.experimental.* Invalid input` | 服务器在 `initialize` 返回里广播了非标准 `experimental` 能力，被严格宿主拒绝 | 跑 `verify_mcp.js --name <服务名> --harden` 自动剥离并重建；或 scaffold 时加 `--self-check --harden` |
| 连接时整体报 `-32000: Connection closed`，同一批其它 MCP 都正常 | 该 Python 类 MCP 启动时向 stdout/stderr 打印了 emoji / 中文符号，GBK(cp936) 下 `UnicodeEncodeError` 崩在握手前（**不是配置写错**） | 给该条目 `env` 加 `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1`（向导已默认注入）；根治则把源码里的 emoji 改成 ASCII 并输出到 `sys.stderr`。⚠️ 在终端手跑同一份代码通常是好的，**不能**据此判断宿主里没问题 |
| 远端 MCP 报 `Local file paths are not supported` / 提示 `open_upload_ui` | 远端服务器无本地文件系统访问权限（设计限制，**非配置问题**） | 不要改配置；用该 MCP 的 `open_upload_ui` 工具拿浏览器上传链接，或传一个远端可访问的公开 URL。注意：这是 MinerU 等远端文件类 MCP 的常态，与鉴权/JSON 无关 |
| 远端 MCP 报 `404 Not Found` 且指向**提供方自己的后端域名**（如 `mineru.net/file-urls/batch`） | 提供方 MCP 服务端 bug / 临时故障：常把请求打到**不存在或已迁移的端点**（如漏了 `/api/v4` 前缀），并非你的配置错 | **不是你的 mcp.json 问题**。诊断：把 MCP 实际调用的 URL 与提供方官方文档端点对比——若正确端点返回 405/401 而 MCP 调用的返回 404，说明 MCP 硬编码了错误路径，向提供方反馈。可暂用其主站/REST API 替代。若 404 指向外部不可控域名则另查网络 |
| 上传 UI 提示「未检测到 API Token / 使用 Flash 模式」或解析只给 Markdown | token 没传导到上传/解析会话（提供方 MCP 服务端缺陷），退化成游客/Flash 模式 | 若握手层已证明 token 有效（如 `MINERU_API_TOKEN` 头 200、`Bearer` 401），则属提供方服务端 bug，不是你的字段配错；向提供方反馈，或改用其主站/REST API |
| 远端「未鉴权也返回 200 → 鉴权未生效」 | 凭据根本不在 Authorization 头里（在 URL 参数 / 自定义头 / env 转发头），只删头等于没做对照 | 用 `probe_mcp_http.js` 让它按识别到的形态剥（URL-key 就删 URL 参数）；别手写只删 Authorization 的对照 |
| `401` 但令牌"看着没过期" | 鉴权**字段名/位置**不对，不是令牌本身的问题 | 以该服务官方 MCP 配置为准照抄：`Bearer ` 前缀有没有漏、该用 `headers` 还是 `env`、URL 参数名是 `apikey` 还是 `api_key`。**别把 A 服务的写法套到 B 服务** |
| `403` + 回显允许的工具清单 | 凭据被识别但无该工具的 scope（设计内白名单） | 告知用户授权范围，或申请加白；不是配置错，别反复改 `mcp.json` |
| 原本正常、突然**全部**报 `Unknown or missing Mcp-Session-Id` | 宿主客户端持有的 session 过期（不是服务端故障、也不是令牌失效） | 别删配置别换令牌。直连 `initialize` 拿新 session 能通即证明服务端健康；旁路：`probe_mcp_http.js --call` 可直接继续；根治：重连 MCP / 重启 WorkBuddy |
| `tools/call` 返回 200、内容里却是 `isError: true` | 业务错误被包在 `result` 里（参数错 / 无权限 / 无额度），协议层"成功" | 看 `_meta.error_code` 与提示文案；核对参数名与取值口径。**这种不能算"配好了"** |
| 远端首次调用超时、第二次就好 | 服务端冷启动 | 重试一次再判断，别急着改配置 |
| uvx 类首次连接失败，日志里有 `cargo rustc` / `maturin failed` | uvx 用了最新 Python（3.14/3.15），依赖包尚无预编译 wheel → 退化成源码编译、超时 | 加 `--uvx-python 3.12` 重配；先 `uv python list` 确认默认版本。改完记得重启让新条目生效 |
| `ImportError: DLL load failed while importing onnxruntime_pybind11_state` | 缺 VC++ 2015-2022 Redistributable（onnxruntime 的原生依赖） | `winget install Microsoft.VCRedist.2015+.x64`；与 mcp.json 无关 |
| 改了 `mcp.json`，连接器列表毫无变化 | 宿主内存里是旧配置，磁盘已更新（stale config） | 重启 WorkBuddy 重读配置。**这与"连接器掉线"不是一回事**，见下一行 |
| 配置没动过，某个连接器突然不可用 / Failed to reconnect | 进程崩了或网络中断，配置本身没问题 | 连接器页对该 server 点「重新连接」让宿主重生进程，**不必重启整个应用**；仍不行再按本表往下查 |

---

## 8. 脚本清单与退出码

| 脚本 | 用途 | 退出码 |
|---|---|---|
| `scaffold_mcp.js` | 写入 / 复制 / 装依赖 / 编译 / 生成条目（`--name` 可省略，自动从路径推断） | `0` 成功 |
| `verify_mcp.js` | **stdio** 握手 + `capabilities.experimental` 检测（`--harden` 自愈）+ 强制 GBK 编码探测 | `0` 通过 / `1` 握手失败 |
| `probe_mcp_http.js` | **streamableHttp** 四步实测（真对照 / session / tools/list / 真实调用），也是会话失效时的旁路客户端 | `0` 通过 / `1` 握手失败 / `2` 工具或调用失败 |
| `lib.js` / `lang.js` | 共享工具：源码补丁、capabilities 硬化、运行时识别与依赖安装 | — |

```bash
NODE=C:/Users/<用户名>/.workbuddy/binaries/node/versions/<ver>/node.exe   # 自查：where node
$NODE scripts/verify_mcp.js     --name gdc
$NODE scripts/probe_mcp_http.js --name patsnap-patent-legal --call legal_data --args '{"patent_number":"US10000000B2"}'
```

> 输出里的凭据一律脱敏（`apikey=***`、令牌只留首尾）。要把输出贴给别人前，仍建议过一眼。

---

## 9. 把这份配置搬到别的 Agent（给同事 / 客户发配置时用）

WorkBuddy 只认 `~/.workbuddy/mcp.json`（单文件、用户级、无 project scope）。同一份服务要给别人用，**不能直接把字段抄过去**——各家 Agent 的文件路径、字段名、生效方式都不同：

| Agent | 配置文件 | 关键差异 | 生效方式 |
|---|---|---|---|
| WorkBuddy | `~/.workbuddy/mcp.json`，键在 `mcpServers` 下 | 本地条目**必须带 `type: "stdio"`**；远端 `type: "streamableHttp"`；`env` 在远端会被转发成同名请求头 | 重启 WorkBuddy，再在连接器页点「信任」 |
| Claude Code | `./.mcp.json`（project）/ `~/.claude.json`（user、local） | **必须用 `claude mcp add` 命令注册，手改配置文件不被识别**；另有 local（仅当前项目、仅本机）/ user / project 三种 scope | CLI 注册；会话内 `/reload-plugins`；`/mcp` → Reconnect |
| Cursor | `~/.cursor/mcp.json` | 不需要 `type` / `transport` 字段 | 设置页 MCP 开关切换，或重启 Cursor |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | **必须加 `"transport": "stdio"`**（字段名与 WorkBuddy 的 `type` 不同） | 重启 IDE |

- **互转时最容易错的三个字段**：① `type`（WorkBuddy）/ `transport`（Antigravity）/ 不带（Cursor）；② 本地与远端的类型取值写法；③ 键名 `mcpServers` 的位置（Claude Code 的 local scope 埋在 `projects[<path>].mcpServers` 里）。
- **发出去之前先脱敏**：`scaffold_mcp.js --dry-run` 的输出已做脱敏（URL 里 `apikey=***`、其余凭据只留首尾），可直接贴给别人；但**直接发 `mcp.json` 原文件前务必手查**——里面的 key 是明文。
- 服务名规则各家一致：只用字母、数字、点、下划线、连字符。

---

## 10. 边界说明
- MCP 生态迭代快，具体服务器的安装命令与配置格式以其官方仓库最新文档为准。
- 授予 AI 系统权限意味着接受相应风险，生产环境接入请先经安全团队评估。
- 本 skill 的脚本只处理「用户已提供的配置」，**不会替你上网寻找或下载 MCP 源码**。

---

## 11. 来源与授权

本 skill 由 **hupan** 原创，首次公开发布于 2026-10-31。

| 项 | 值 |
|---|---|
| 原仓库 | `https://github.com/Philip0910732123/mcp-config-wizard` |
| 著作权人 | hupan（GitHub: Philip0910732123） |
| 许可 | Apache License 2.0，全文见 `LICENSE.txt` |
| 归属声明要求 | 见 `NOTICE.txt` |
| 文件指纹 | `MCPWIZ-FP-2026-HUPAN-7C41` |

### 11.1 允许什么

Apache-2.0 允许你自由使用、修改、再分发本 skill，包括用于商业项目、集成进你自己的产品或服务。不需要付费，也不需要事先取得同意。

### 11.2 再分发时必须做什么

以下四条是许可的强制条件，不是建议：

1. **附上 LICENSE.txt 全文**，接收方要能拿到。
2. **保留 NOTICE.txt 中的归属声明**——著作权人、原项目名 `mcp-config-wizard`、原仓库地址，三者在衍生作品里都要能读到。可以放在 LICENSE.txt/NOTICE.txt、README，或作品的"关于"页面。
3. **修改过的文件要显著标注"已被修改"**。这一条对更名场景尤其关键：改名本身属于修改，所以更名后的版本必须同时说明它基于 `mcp-config-wizard` 修改而来。
4. **不得暗示原作者为你的版本背书**，也不得把 `mcp-config-wizard` 当作你自己的产品名使用。

### 11.3 关于"换个名字就当成自己的"

这是本许可明确覆盖的场景。把本 skill 更名后发布，本身是允许的；但**只改名、不声明来源、抹掉原作者署名**，同时违反 11.2 的第 2 条与第 3 条。

判断依据不是"看起来像不像"，而是两个客观事实：

- 本文件的表述、章节结构、脚本的接口与实现细节，是否被实质复制；
- 归属声明是被**遗漏**了，还是被**主动删除**了。后者属于故意侵权。

如果发现有人以本 skill 的实质内容更名发布且未注明来源，可以依 Apache-2.0 第 4 条主张违约，并向其发布平台提出版权投诉。本 skill 每一份脚本头部都带有指纹字符串，可作为同一来源的初步证据。

### 11.4 引用与致谢

在文章、课程、内部文档中介绍或引用本 skill 时，请附上原仓库地址。这既是许可要求，也便于读者拿到会持续更新的版本。

