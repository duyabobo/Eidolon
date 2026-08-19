import { dialog } from "electron";
import { ManagedProcess, stopManagedProcess } from "./process-manager";

const RESTART_BASE_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 5;
/** 进程持续健康超过该时间后，再次崩溃时重置连续失败计数 */
const STABLE_RESET_MS = 60_000;

export type SupervisedProcessName = "cm-server" | "pi-runtime";

type ProcessFactory = () => Promise<ManagedProcess>;

interface Slot {
  name: SupervisedProcessName;
  factory: ProcessFactory;
  managed: ManagedProcess | null;
  consecutiveFailures: number;
  restarting: boolean;
  /** 最近一次健康启动成功的时间戳 */
  lastHealthyAt: number;
}

export interface ProcessSupervisorOptions {
  /** 连续重启失败达上限时回调（通常弹窗并退出应用） */
  onGiveUp: (name: SupervisedProcessName, detail: string) => void;
}

/**
 * 监督 cm-server / pi-runtime 子进程：意外退出后指数退避重启；
 * 应用关机（stopAll）期间不重启。端口在应用生命周期内固定，重启后下游可按原地址恢复。
 */
export class ProcessSupervisor {
  private readonly slots = new Map<SupervisedProcessName, Slot>();
  private readonly startOrder: SupervisedProcessName[] = [];
  private readonly onGiveUp: ProcessSupervisorOptions["onGiveUp"];
  private shuttingDown = false;

  constructor(options: ProcessSupervisorOptions) {
    this.onGiveUp = options.onGiveUp;
  }

  /** 按调用顺序启动并挂上 exit 监听；启动失败直接抛出（由 bootstrap 处理） */
  async start(name: SupervisedProcessName, factory: ProcessFactory): Promise<ManagedProcess> {
    if (this.slots.has(name)) {
      throw new Error(`进程 ${name} 已在监督列表中`);
    }
    const managed = await factory();
    this.slots.set(name, {
      name,
      factory,
      managed,
      consecutiveFailures: 0,
      restarting: false,
      lastHealthyAt: Date.now(),
    });
    this.startOrder.push(name);
    this.watchExit(name, managed);
    return managed;
  }

  listManaged(): ManagedProcess[] {
    return this.startOrder
      .map((name) => this.slots.get(name)?.managed)
      .filter((m): m is ManagedProcess => m != null);
  }

  /** 先禁止重启，再按启动逆序优雅关闭 */
  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    for (const name of [...this.startOrder].reverse()) {
      const slot = this.slots.get(name);
      if (!slot?.managed) continue;
      await stopManagedProcess(slot.managed);
      slot.managed = null;
    }
  }

  private watchExit(name: SupervisedProcessName, managed: ManagedProcess): void {
    managed.process.once("exit", (code, signal) => {
      void this.handleUnexpectedExit(name, code, signal);
    });
  }

  private async handleUnexpectedExit(
    name: SupervisedProcessName,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const slot = this.slots.get(name);
    if (!slot || this.shuttingDown) {
      return;
    }
    if (slot.restarting) {
      return;
    }

    const reason = signal ? `signal=${signal}` : `code=${code}`;
    console.error(`[process-supervisor] ${name} 意外退出（${reason}），准备重启`);

    const ranStableMs = Date.now() - slot.lastHealthyAt;
    if (ranStableMs >= STABLE_RESET_MS) {
      slot.consecutiveFailures = 0;
    }
    slot.consecutiveFailures += 1;
    slot.managed = null;

    if (slot.consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
      const detail = `${name} 连续重启失败 ${slot.consecutiveFailures} 次（最近退出：${reason}）`;
      console.error(`[process-supervisor] ${detail}`);
      this.onGiveUp(name, detail);
      return;
    }

    slot.restarting = true;
    try {
      await this.restartWithBackoff(slot);
    } finally {
      slot.restarting = false;
    }
  }

  private async restartWithBackoff(slot: Slot): Promise<void> {
    while (!this.shuttingDown) {
      const delayMs = Math.min(
        RESTART_BASE_DELAY_MS * 2 ** Math.max(0, slot.consecutiveFailures - 1),
        RESTART_MAX_DELAY_MS,
      );
      console.log(
        `[process-supervisor] ${slot.name} 将在 ${delayMs}ms 后重启` +
          `（第 ${slot.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} 次）`,
      );
      await sleep(delayMs);
      if (this.shuttingDown) {
        return;
      }

      try {
        const managed = await slot.factory();
        if (this.shuttingDown) {
          await stopManagedProcess(managed);
          return;
        }
        slot.managed = managed;
        slot.consecutiveFailures = 0;
        slot.lastHealthyAt = Date.now();
        this.watchExit(slot.name, managed);
        console.log(`[process-supervisor] ${slot.name} 重启成功`);
        return;
      } catch (error) {
        slot.consecutiveFailures += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[process-supervisor] ${slot.name} 重启失败: ${message}`);
        if (slot.consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          this.onGiveUp(slot.name, `${slot.name} 重启失败: ${message}`);
          return;
        }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 连续失败达上限时的默认处理：提示用户并退出 */
export function showSupervisorGiveUpDialog(name: SupervisedProcessName, detail: string): void {
  dialog.showErrorBox(
    "Eidolon 本地服务异常",
    `${name} 多次重启仍无法恢复，应用即将退出。\n请查看日志目录后重新打开。\n\n${detail}`,
  );
}
