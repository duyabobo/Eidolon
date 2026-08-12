# Electron 桌面客户端

把 `cm-server`（合并后的 Python 单进程）、`pi-runtime`（Node 执行引擎）、`arxiv-mcp`（平台内置
工具，PyInstaller 单独打包）、`frontend`（React SPA）四个已有产物打包成 mac arm64 桌面安装包，
本目录只放 Electron 主进程代码，不重复实现任何业务逻辑。

## 架构

```
Electron 主进程（本目录 src/main.ts）
  ├─ 分配 4 个本机空闲端口（src/ports.ts）
  ├─ 拉起 arxiv-mcp 可执行程序（PyInstaller 产物，src/process-manager.ts）
  ├─ 拉起 cm-server 可执行程序（PyInstaller 产物），把 arxiv-mcp 的本机地址通过
  │  ARXIV_MCP_URL 环境变量传给它，用来刷新内置系统 MCP 记录（见下方"内置 MCP"一节）
  ├─ 拉起 pi-runtime（Electron 内置 Node 运行 dist/worker.js，ELECTRON_RUN_AS_NODE=1）
  ├─ 起一个本机静态文件 + API 反向代理服务器（src/static-server.ts，取代容器部署里的 nginx）
  └─ 创建 BrowserWindow，加载上面那个本机服务器的地址
```

cm-server / pi-runtime / arxiv-mcp 三个子进程全部启动时都注入了 `NO_PROXY=127.0.0.1,localhost,::1`
（见 `process-manager.ts` 的 `NO_PROXY_ENV`）：如果用户机器上配置了系统级 HTTP/SOCKS 代理（常见于
公司网络、Clash/Surge 之类工具），Python `httpx`（cm-server 连 MCP downstream 用）会通过
`urllib.request.getproxies()` 读到 macOS 系统代理配置，但不会应用系统代理面板里
"127.0.0.1/localhost 例外"这条规则，导致所有本机 loopback 请求也被转发给代理、代理再因为连不到
本机随机端口返回 502——现象和 MCP 探测失败一致，和业务逻辑无关，显式设置 `NO_PROXY` 从源头绕开。

选择「本机静态代理服务器」而不是让渲染进程直接用 `file://` 加载前端产物，是因为前端代码里的
`fetch("/sessions")` 等调用都是相对路径（沿用容器部署时 nginx.conf / vite.config.ts 的代理约定，
不改前端源码），`file://` 协议下这些相对路径没有意义；用一个本机 HTTP 服务器同时提供静态文件和
API 反向代理，行为上等价于把 `frontend/nginx.conf` 的路由表搬进了 Electron 主进程。

## 目录结构

```
electron/
  package.json       # electron-builder 配置在 package.json 的 "build" 字段里
  tsconfig.json
  src/
    main.ts           # 入口：编排启动顺序、创建窗口、退出时清理子进程
    paths.ts           # 开发/打包两种模式下的资源路径 + 本地数据目录（app.getPath('userData')）
    ports.ts            # 本机空闲端口分配
    process-manager.ts   # 拉起/健康检查/优雅关闭 cm-server / pi-runtime / arxiv-mcp 三个子进程
    static-server.ts     # 本机静态文件服务器 + API 反向代理（取代 nginx）
```

## 内置 MCP（arxiv）

`arxiv-mcp` 是平台内置工具，不是用户自己配置的远程 MCP Server，所以桌面端把它当第 3 个子进程
拉起（和 cm-server / pi-runtime 同等地位），而不是要求用户自己起一个远程服务。它每次启动分配的
本机端口都不同，`cm_server/admin/services/mcp_server_store.py` 的
`ensure_builtin_system_servers()` 会在 `ARXIV_MCP_URL` 环境变量存在时，每次启动都用真实端口
刷新数据库里的 `arxiv` 记录 url（但不动用户在 Admin 页手动改过的 `enabled` 开关），
自愈式解决"重启后端口变了、旧地址还留在库里"的问题。Docker 部署没有这个环境变量，
退回容器内 DNS 地址 `http://arxiv-mcp:8081/mcp`，行为不变。

## 本地数据目录

对应容器部署里的 `/data`（SQLite）和 `/data/sandboxes`（沙盒），桌面场景改成
`app.getPath('userData')`（macOS 上是 `~/Library/Application Support/onenew-desktop`——
沿用 `package.json` 里未改过的 `name` 字段，与展示层品牌名 `productName: "Eidolon"` 是两回事；
如果以后把 `name` 也改成跟品牌一致，要注意这会导致老用户的本地数据目录“失踪”，需要单独做迁移）：

```
<userData>/
  data/local.db     # SQLite，首次启动时 cm_server/shared/db.py 的 connect() 自动建表，
                     # 不需要额外的 schema 初始化步骤
  sandboxes/        # pi-runtime 沙盒根目录（workspace/home/tmp）
  logs/             # cm-server / pi-runtime 日志（各自内部按天滚动，见 pi_shared.logger /
                     # pi-runtime/src/file-logger.ts），另外各留一份 *.stdout.log 兜底捕获
                     # 崩溃时可能没走到内部 logger 就退出的输出
```

## 本地开发

```bash
# 1. 依次构建产物到仓库根目录 build/（frontend / pi-runtime / cm-server / arxiv-mcp）
bash ../scripts/build-frontend.sh
bash ../scripts/build-pi-runtime.sh
bash ../scripts/build-cm-server.sh   # 需已安装 python3；用独立虚拟环境跑 PyInstaller
bash ../scripts/build-arxiv-mcp.sh   # 同上，独立虚拟环境

# 2. 编译并启动 Electron（开发模式下 paths.ts 会读取上面的 build/ 目录）
npm install
npm run dev
```

## 打包 mac arm64 安装包

```bash
# 仓库根目录一键打包（内部调用 scripts/package-mac.sh）
bash ../deploy.sh --package
```

产物：`electron/release/Eidolon-<version>-arm64.dmg`（可安装的 mac 磁盘映像，拖到 Applications）。

必须在 **Apple Silicon Mac** 上运行：PyInstaller 不支持交叉编译。

`pi` CLI（`@earendil-works/pi-coding-agent@0.79.9`）与 `pi-mcp-adapter` / `bwrap` 扩展会由
`scripts/build-pi-cli.sh` 打进 `Resources/pi-cli/`，启动时通过 `PI_BIN` / `PI_EXTENSIONS_DIR` /
`NODE_BIN`（指向 Electron 内置 Node）注入，**不再要求用户本机全局安装 pi**。

## 已知限制（后续独立任务）

- **未做代码签名**：`package.json` 里 `hardenedRuntime: true` 但没有配置 Apple Developer 证书，
  当前产物是未签名的 `.app`，用户首次打开会被 Gatekeeper 拦截，需要右键"打开"绕过或后续接入签名
  + notarize 流程。
- **崩溃后不自动重启**：`process-manager.ts` 目前只负责启动时的健康检查和退出时的优雅关闭，
  cm-server / pi-runtime / arxiv-mcp 运行期间意外退出不会自动重启，需要用户手动重开应用。

## 安装包说明

可安装产物是 **`.dmg`**（约 200MB+），双击打开后把 `Eidolon` 拖到 Applications 即可。

同目录下的 `.dmg.blockmap`（约 160KB）只是增量更新用的索引文件，**不是安装包**。
