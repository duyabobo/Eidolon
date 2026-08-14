import { app, BrowserWindow, dialog } from "electron";
import type { Server } from "http";
import { allocateAppPorts } from "./ports";
import { resolveResourcePaths, resolveUserDataPaths } from "./paths";
import { startArxivMcp, startCmServer, startNatureMcp, startPiRuntime } from "./process-manager";
import {
  ProcessSupervisor,
  showSupervisorGiveUpDialog,
} from "./process-supervisor";
import { startStaticAndProxyServer } from "./static-server";

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;

let mainWindow: BrowserWindow | null = null;
let staticServer: Server | null = null;
let supervisor: ProcessSupervisor | null = null;
let isShuttingDown = false;

// 单实例锁：cm-server 独占同一个 SQLite 文件，第二个实例会导致数据库锁冲突，
// 直接拒绝启动第二个实例并把已有窗口聚焦到前台。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap).catch(handleFatalStartupError);
}

async function bootstrap(): Promise<void> {
  const resourcePaths = resolveResourcePaths();
  const userDataPaths = resolveUserDataPaths();
  const { cmServerPort, piRuntimePort, staticServerPort, arxivMcpPort, natureMcpPort } =
    await allocateAppPorts();

  supervisor = new ProcessSupervisor({
    onGiveUp: (name, detail) => {
      showSupervisorGiveUpDialog(name, detail);
      app.quit();
    },
  });

  // 先起内置 MCP：cm-server 启动时会立刻用 *_MCP_URL 刷新内置系统 MCP 的地址
  // （见 mcp_server_store.ensure_builtin_system_servers），必须在 cm-server 之前拿到端口。
  await supervisor.start("arxiv-mcp", () =>
    startArxivMcp({
      executablePath: resourcePaths.arxivMcpExecutable,
      port: arxivMcpPort,
      storagePath: userDataPaths.arxivStoragePath,
      logDir: userDataPaths.logDir,
    }),
  );

  await supervisor.start("nature-mcp", () =>
    startNatureMcp({
      executablePath: resourcePaths.natureMcpExecutable,
      port: natureMcpPort,
      logDir: userDataPaths.logDir,
    }),
  );

  await supervisor.start("cm-server", () =>
    startCmServer({
      executablePath: resourcePaths.cmServerExecutable,
      port: cmServerPort,
      sqlitePath: userDataPaths.sqlitePath,
      sandboxRoot: userDataPaths.sandboxRoot,
      logDir: userDataPaths.logDir,
      piRuntimeBaseUrl: `http://127.0.0.1:${piRuntimePort}`,
      arxivMcpUrl: `http://127.0.0.1:${arxivMcpPort}/mcp`,
      natureMcpUrl: `http://127.0.0.1:${natureMcpPort}/mcp`,
    }),
  );

  await supervisor.start("pi-runtime", () =>
    startPiRuntime({
      entryPath: resourcePaths.piRuntimeEntry,
      cwd: resourcePaths.piRuntimeDir,
      port: piRuntimePort,
      cmServerPort,
      sandboxRoot: userDataPaths.sandboxRoot,
      logDir: userDataPaths.logDir,
      piBin: resourcePaths.piBin,
      piExtensionsDir: resourcePaths.piExtensionsDir,
      sandboxPythonBinDir: resourcePaths.sandboxPythonBinDir,
    }),
  );

  staticServer = startStaticAndProxyServer({
    port: staticServerPort,
    frontendDir: resourcePaths.frontendDir,
    cmServerPort,
  });

  createMainWindow(staticServerPort);
}

function createMainWindow(staticServerPort: number): void {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: "Eidolon",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${staticServerPort}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function shutdown(): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  staticServer?.close();
  staticServer = null;
  // 反向顺序关闭：pi-runtime 依赖 cm-server 才能优雅上报最终状态，先关它更安全。
  await supervisor?.stopAll();
  supervisor = null;
}

function handleFatalStartupError(error: unknown): void {
  console.error("[main] 启动失败:", error);
  dialog.showErrorBox(
    "Eidolon 启动失败",
    `本地服务未能正常启动，请查看日志目录排查问题。\n\n${error instanceof Error ? error.message : String(error)}`,
  );
  app.quit();
}

app.on("window-all-closed", () => {
  void shutdown().finally(() => app.quit());
});

app.on("before-quit", (event) => {
  if (isShuttingDown || !supervisor) {
    return;
  }
  // 确保子进程被清理后才真正退出；shutdown() 内部有超时兜底，不会无限阻塞退出流程。
  event.preventDefault();
  void shutdown().finally(() => app.quit());
});
