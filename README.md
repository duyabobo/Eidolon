# Eidolon

个人分身：以前你坐在电脑前做的事情，它都能做。

## 信念

agent 产品的价值，不在于引擎本身，而在于：

1. **提供专业工具供用户调用**
2. **帮助用户积累经验与知识**

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
├── deploy.sh              # 部署脚本
├── docker-compose.yml     # 单节点编排
├── .env.example           # 环境变量示例
├── docs/                  # 文档与架构图
├── frontend/              # 窗口
├── cm-server/             # 本机服务
├── pi-shared/             # 共享工具库
├── arxiv-mcp/             # 内置 arXiv 工具
├── nature-mcp/            # 内置学术检索工具
├── pi-runtime/            # 执行引擎
├── electron/              # 桌面壳
└── scripts/               # 打包脚本
```
