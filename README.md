# Eidolon

个人分身。
1. 以前你坐在电脑前才能做的，它都能做。
2. 所有能力都是插件：安装到本机客户端运行，并自动登记到 mcp-proxy 给 Agent 调用。
3. 添加插件是对话式的，由 Agent 写代码。
4. 添加经验 = 你的办事流程和规则 + 已装插件或插件市场，写成 Skill。

## 整体架构

架构是 Client — Model（简称 cm 架构）。

![系统总体架构](docs/assets/system-architecture.png)

## 快速开始

```bash
bash deploy.sh              # 本机启动
bash deploy.sh --package    # 打 mac arm64 安装包（.dmg）
```

## 目录结构

```
eidolon-platform/
├── README.md              # 本文件
├── LICENSE                # MIT
├── deploy.sh              # 部署脚本
├── docker-compose.yml     # 单节点编排
├── .env.example           # 环境变量示例
├── docs/                  # 文档与架构图
├── frontend/              # 窗口
├── cm-server/             # 本机服务
├── pi-shared/             # 共享工具库
├── pi-runtime/            # 执行引擎
├── electron/              # 桌面壳
└── scripts/               # 打包脚本
```
