import { app } from "electron";
import { join } from "path";
import { mkdirSync } from "fs";

/**
 * 打包后 `extraResources` 落在 `process.resourcesPath` 下（见 package.json 的 build.extraResources），
 * 开发模式下用仓库根目录的 `build/` 目录（`scripts/build-*.sh` 的产物），两种模式目录结构一致，
 * 只是根路径不同，避免 main.ts 里到处判断 `app.isPackaged`。
 */
function resourcesRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return join(__dirname, "..", "..", "build");
}

export interface ResourcePaths {
  cmServerExecutable: string;
  piRuntimeEntry: string;
  piRuntimeDir: string;
  frontendDir: string;
  /** 安装包内 pi CLI 可执行包装脚本（build/pi-cli/bin/pi） */
  piBin: string;
  /** 安装包内 pi 扩展目录（含 pi-mcp-adapter / bwrap） */
  piExtensionsDir: string;
  /** 安装包内 arxiv-mcp 可执行程序（PyInstaller 产物，build/arxiv-mcp/arxiv-mcp） */
  arxivMcpExecutable: string;
  /** 安装包内 nature-mcp 可执行程序（PyInstaller 产物，build/nature-mcp/nature-mcp） */
  natureMcpExecutable: string;
  /** 安装包内沙盒 Python 的 bin 目录（含 python3 + 科学栈） */
  sandboxPythonBinDir: string;
}

export function resolveResourcePaths(): ResourcePaths {
  const root = resourcesRoot();
  return {
    cmServerExecutable: join(root, "cm-server", "cm-server"),
    piRuntimeDir: join(root, "pi-runtime"),
    piRuntimeEntry: join(root, "pi-runtime", "dist", "worker.js"),
    frontendDir: join(root, "frontend"),
    piBin: join(root, "pi-cli", "bin", "pi"),
    piExtensionsDir: join(root, "pi-cli", "extensions"),
    arxivMcpExecutable: join(root, "arxiv-mcp", "arxiv-mcp"),
    natureMcpExecutable: join(root, "nature-mcp", "nature-mcp"),
    sandboxPythonBinDir: join(root, "sandbox-python", "bin"),
  };
}

/**
 * 本地数据目录：`app.getPath('userData')` 是 macOS 上的
 * `~/Library/Application Support/<productName>`，替代容器里的 `/data`。
 * 首次启动时 SQLite/沙盒目录均不存在，需要的初始化只是「保证目录存在」——
 * 表结构由 `cm_server/shared/db.py` 的 `connect(schema_sql=...)` 在库文件不存在时自动建表，
 * 不需要额外的 schema 初始化步骤。
 */
export interface UserDataPaths {
  root: string;
  sqlitePath: string;
  sandboxRoot: string;
  logDir: string;
  /** arxiv-mcp 论文缓存目录，对应容器里的 /data/arxiv-papers */
  arxivStoragePath: string;
}

export function resolveUserDataPaths(): UserDataPaths {
  const root = app.getPath("userData");
  const paths: UserDataPaths = {
    root,
    sqlitePath: join(root, "data", "local.db"),
    sandboxRoot: join(root, "sandboxes"),
    logDir: join(root, "logs"),
    arxivStoragePath: join(root, "arxiv-papers"),
  };
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(paths.sandboxRoot, { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });
  mkdirSync(paths.arxivStoragePath, { recursive: true });
  return paths;
}
