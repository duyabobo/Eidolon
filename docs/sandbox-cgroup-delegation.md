# 沙盒 Session 级 cgroup 委托配置指南

本文说明如何在宿主机上配置 **cgroup v2 控制器委托**，使 `pi-runtime` 能为每个 session 创建子 cgroup，对 bwrap 沙盒进程树施加 **内存 / CPU** 上限。

> **背景**：`pi-runtime` 在 spawn bwrap 后，将根 PID 写入 `{父 cgroup}/pi-sessions/{sessionId}/cgroup.procs`。若宿主机未委托 `memory` / `cpu` 控制器，子 cgroup 无法写入 `memory.max`，会自动降级为 `prlimit --as`（仅近似内存限制，无 CPU 配额）。

---

## 1. pi-runtime 资源限制行为

| 层级 | 机制 | 生效条件 |
|------|------|----------|
| 优先 | cgroup v2 子 cgroup | 父 cgroup 已委托 `memory` / `cpu`，且可写 `cgroup.subtree_control` |
| 降级 | `prlimit --as=<bytes> bwrap ...` | cgroup 创建失败，且配置了 `SANDBOX_CGROUP_MEMORY_MAX` |
| 不限制 | 无 | `SANDBOX_CGROUP_ENABLED=false`，或未配置任何上限 |

相关环境变量（见 `pi-runtime/README.md`）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `SANDBOX_CGROUP_ENABLED` | `true` | 总开关 |
| `SANDBOX_CGROUP_MEMORY_MAX` | `512M` | 单 session 内存上限 |
| `SANDBOX_CGROUP_CPU_MAX` | `max` | CPU 上限，如 `50000 100000` ≈ 0.5 核 |
| `SANDBOX_CGROUP_BASE` | 空 | 可选，显式指定父 cgroup 绝对路径 |

`docker-compose.yml` 中 `pi-runtime` 已配置：

```yaml
cgroup: host          # 使用宿主机 cgroup 命名空间
privileged: true      # bwrap 所需；同时便于访问 cgroup 文件系统
```

---

## 2. 快速诊断

在 **pi-runtime 容器内**执行：

```bash
# 1) 确认 cgroup v2
test -f /sys/fs/cgroup/cgroup.controllers && echo "cgroup v2 OK"

# 2) 查看当前进程所在 cgroup
cat /proc/self/cgroup
# 期望（Linux + cgroup: host）：0::/docker/<container-id>
# Docker Desktop / 私有命名空间：可能是 0::/

# 3) 解析父路径（与 pi-runtime 逻辑一致）
PARENT="/sys/fs/cgroup$(grep '^0::' /proc/self/cgroup | cut -d: -f3)"
echo "parent=$PARENT"

# 4) 检查控制器与委托
cat "$PARENT/cgroup.controllers"
cat "$PARENT/cgroup.subtree_control"

# 5) 试探创建 session 子 cgroup（与 pi-runtime 相同路径）
CG="$PARENT/pi-sessions/diag-test"
mkdir -p "$CG"
echo 536870912 > "$CG/memory.max" && echo "memory.max OK" || echo "memory.max FAILED"
rm -rf "$PARENT/pi-sessions/diag-test"
```

**结果解读：**

| 现象 | 含义 |
|------|------|
| `memory.max OK` | 完整 cgroup 可用，无需额外配置 |
| `Permission denied` 写 `memory.max` | 父 cgroup 未委托 `memory`，需按下文配置 |
| `cgroup.subtree_control` 为空且无法 `echo +memory` | 常见：Docker 容器根 cgroup 内仍有进程，或未委托 |
| 日志出现 `降级 prlimit --as` | cgroup 不可用，仅内存 RLIMIT_AS 生效 |

查看 pi-runtime 日志：

```bash
docker compose logs pi-runtime | grep -E '\[cgroup\]'
# 成功：已创建 cgroup path=... memory.max=...
# 降级：cgroup 不可用，降级 prlimit --as=...
```

---

## 3. 前置条件

### 3.1 确认宿主机使用 cgroup v2

```bash
stat -fc %T /sys/fs/cgroup/
# 期望输出：cgroup2fs

# 或
test -f /sys/fs/cgroup/cgroup.controllers && echo v2
```

若为 hybrid / v1，需在 GRUB 内核参数启用统一层级（发行版各异，常见）：

```text
systemd.unified_cgroup_hierarchy=1
```

修改后重启。具体步骤以所用发行版文档为准。

### 3.2 确认 Docker 使用 systemd cgroup driver

```bash
docker info | grep -i cgroup
# 期望：Cgroup Driver: systemd
```

`/etc/docker/daemon.json` 示例：

```json
{
  "exec-opts": ["native.cgroupdriver=systemd"]
}
```

修改后：

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
```

---

## 4. 方案 A：systemd 委托 + 专用 slice（Linux 生产推荐）

适用于 **裸机 / VM / 云主机** 上直接运行 Docker Compose。

### 4.1 为 docker 服务开启 Delegate

```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/delegate.conf <<'EOF'
[Service]
Delegate=cpu cpuset io memory pids
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker

# 验证
systemctl show docker --property Delegate,ControlGroup
# 期望 Delegate=yes
```

> systemd 文档说明：`Delegate=` 只能设在 **service / scope** 单元，不能设在 slice 单元。参见 [systemd CGROUP_DELEGATION](https://github.com/systemd/systemd/blob/main/docs/CGROUP_DELEGATION.md)。

### 4.2 创建 pi-agent 专用 slice

将 `pi-runtime` 容器挂到独立 slice，便于资源隔离与审计：

```bash
sudo tee /etc/systemd/system/pi-agent.slice <<'EOF'
[Unit]
Description=Pi Agent Platform containers
Before=slices.target

[Slice]
MemoryAccounting=yes
CPUAccounting=yes
EOF

sudo systemctl daemon-reload
```

### 4.3 docker-compose 指定 cgroup_parent

在 `docker-compose.yml` 的 `pi-runtime` 服务下增加：

```yaml
pi-runtime:
  cgroup_parent: pi-agent.slice
  cgroup: host
  privileged: true
  # ... 其余配置不变
```

重建并启动：

```bash
docker compose up -d pi-runtime
```

验证容器 cgroup 路径：

```bash
CID=$(docker compose ps -q pi-runtime)
docker inspect "$CID" --format '{{.HostConfig.CgroupParent}}'
cat /proc/$(docker inspect "$CID" --format '{{.State.Pid}}')/cgroup
```

### 4.4 若仍无法写 memory.max：容器内 enable nesting

Docker 容器根 cgroup 内往往仍有进程，导致无法在其上启用 `cgroup.subtree_control`（cgroup v2 **「内节点不能同时有进程和子 cgroup」** 规则）。

对 **privileged** 的 `pi-runtime`，可在容器 **入口脚本** 中执行（思路来自 Docker DinD）：

```bash
#!/bin/sh
# 在 pi-runtime 主进程启动前执行
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  mkdir -p /sys/fs/cgroup/init
  # 将根 cgroup 内进程移到 init 子 cgroup
  for p in $(cat /sys/fs/cgroup/cgroup.procs 2>/dev/null); do
    echo "$p" > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
  done
  # 启用 memory、cpu 控制器供子 cgroup 使用
  for ctrl in memory cpu; do
    echo "+${ctrl}" >> /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
  done
fi
exec node dist/worker.js   # 按实际入口调整
```

执行后再次运行 **§2 诊断**，`memory.max` 应可写入。

> 若希望平台默认开箱即用，可将上述逻辑并入 `pi-runtime` 镜像 entrypoint；当前仓库默认依赖宿主机委托 + 降级 prlimit。

---

## 5. 方案 B：Kubernetes

`pi-runtime` 以 **Privileged Pod** 运行时，可参考以下要点：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pi-runtime
spec:
  template:
    spec:
      containers:
        - name: pi-runtime
          image: your-registry/pi-runtime:latest
          securityContext:
            privileged: true
          env:
            - name: SANDBOX_CGROUP_MEMORY_MAX
              value: "512M"
            - name: SANDBOX_CGROUP_CPU_MAX
              value: "50000 100000"   # 可选：约 0.5 CPU
          # 不要 bind-mount 覆盖 /sys/fs/cgroup，除非明确需要且了解后果
```

**建议：**

1. 集群节点启用 **cgroup v2**（Kubernetes 1.25+ 默认倾向 v2，以节点实际为准）。
2. kubelet 使用 **systemd cgroup driver**（与 Docker/containerd 配置一致）。
3. Pod 使用 **host cgroup namespace**（Kubernetes 1.26+ `securityContext.cgroupns: Host`，若集群支持）。
4. 若诊断仍失败，在容器 `command` / `args` 中加入 **§4.4 nesting 脚本** 再启动 worker。

在 Pod 内验证：

```bash
kubectl exec -it deploy/pi-runtime -- sh -c '
  PARENT=/sys/fs/cgroup$(grep "^0::" /proc/self/cgroup | cut -d: -f3)
  echo parent=$PARENT
  cat "$PARENT/cgroup.subtree_control"
  mkdir -p "$PARENT/pi-sessions/k8s-test"
  echo 536870912 > "$PARENT/pi-sessions/k8s-test/memory.max" && echo OK || echo FAIL
  rm -rf "$PARENT/pi-sessions/k8s-test"
'
```

---

## 6. Docker Desktop（macOS / Windows）

Docker Desktop 运行在 Linux VM 内，cgroup 行为与真实 Linux 主机不同：

| 能力 | 说明 |
|------|------|
| session cgroup（memory.max / cpu.max） | **通常不可用** |
| prlimit 内存降级 | 一般可用 |
| 完整 CPU 配额 | 需 Linux 裸机 / VM / K8s 节点 |

本地开发可接受 prlimit 降级；**生产环境请在 Linux 主机按 §4 配置**。

---

## 7. 配置 CPU 上限示例

cgroup v2 的 `cpu.max` 格式为：`$QUOTA $PERIOD`（微秒）。

| 值 | 含义 |
|----|------|
| `100000 100000` | 约 1 核 |
| `50000 100000` | 约 0.5 核 |
| `max` | 不限制（默认） |

`docker-compose.yml`：

```yaml
environment:
  SANDBOX_CGROUP_CPU_MAX: "50000 100000"
```

---

## 8. 与容器级 limit 的关系

| 层级 | 配置方式 | 作用对象 |
|------|----------|----------|
| Docker 容器 | `mem_limit` / `deploy.resources.limits` | 整个 pi-runtime 容器 |
| session cgroup | `SANDBOX_CGROUP_*` | 单个用户 session 沙盒 |
| prlimit 降级 | 自动 | 单个 session（仅内存 RLIMIT_AS） |

建议：

- **容器级**：为 pi-runtime 设置总内存上限（防止多 session 总和失控）。
- **session 级**：用 `SANDBOX_CGROUP_MEMORY_MAX` 限制单会话。

示例（compose）：

```yaml
pi-runtime:
  mem_limit: 4g
  environment:
    SANDBOX_CGROUP_MEMORY_MAX: "512M"
```

---

## 9. 故障排查

| 错误 / 日志 | 可能原因 | 处理 |
|-------------|----------|------|
| `创建 cgroup 失败，跳过资源限制` | 无写权限或未委托 | §4.1–4.4 |
| `降级 prlimit --as` | 同上；Docker Desktop | 生产换 Linux；开发可忽略 |
| `pid=... 加入 cgroup 失败` | cgroup 已删或路径错误 | 查 session 生命周期与日志 |
| `echo +memory: Device or resource busy` | 根 cgroup 仍有进程 | §4.4 nesting 脚本 |
| CPU 限制不生效 | 仅 prlimit 降级路径 | 必须让 cgroup 创建成功 |

---

## 10. 参考

- [systemd CGROUP_DELEGATION](https://github.com/systemd/systemd/blob/main/docs/CGROUP_DELEGATION.md)
- [runc cgroup v2 文档](https://github.com/opencontainers/runc/blob/main/docs/cgroup-v2.md)
- [Linux cgroup v2 内核文档](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- 项目实现：`pi-runtime/src/session-cgroup.ts`、`pi-runtime/src/pi-session.ts`
