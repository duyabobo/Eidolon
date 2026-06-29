# Pi 进程内部流程图

## 完整流程：从用户输入到流式输出

```mermaid
flowchart TD
    A(["stdin JSONL: type=prompt, message=..."]) --> B

    subgraph INIT["启动阶段（进程启动时执行一次）"]
        B["buildSystemPrompt"] --> B1["工具列表 + Guidelines"]
        B --> B2["available_skills 索引\n只有名字+描述+路径"]
        B --> B3["--append-system-prompt\nMEMORY.md 指引"]
        B --> B4["当前日期 + cwd"]
        B --> B5["--session-dir 加载 JSONL\n恢复历史 messages 列表"]
    end

    B5 --> C

    subgraph LOOP["Agent Loop（每次 prompt 执行）"]
        C["agent_start / turn_start"] --> D

        D{"Steering 队列\n有消息?"} -->|有| D1["注入 steering 消息到 messages"] --> E
        D -->|无| E

        E["streamAssistantResponse 调用 LLM"] --> E1
        E1["transformContext\n修剪/注入消息"] --> E2
        E2["convertToLlm\n过滤 UI 专用消息"] --> E3
        E3["HTTP POST 127.0.0.1:9001/v1\nllm-proxy 转发真实 LLM"] --> E4

        subgraph STREAM["流式输出（实时推 stdout）"]
            E4a["thinking_delta 思考过程"]
            E4b["text_delta 回复文字"]
            E4c["toolcall_delta 工具调用参数"]
        end
        E4 --> E4a & E4b & E4c

        E4 --> F{"有 tool call?"}

        F -->|有| G

        subgraph TOOLS["工具执行"]
            G["beforeToolCall Extension 拦截 可 block"] --> G1
            G1{"并行 or 串行"} -->|并行默认| G2["并发执行多个工具"]
            G1 -->|含 sequential 工具| G3["逐个串行执行"]
            G2 & G3 --> G4

            subgraph TOOLSET["内置工具集"]
                T1["read 读文件"]
                T2["write 写文件"]
                T3["edit 编辑文件"]
                T4["bash 执行命令"]
                T5["find / grep / ls"]
            end

            G4["tool.execute()"] --> TOOLSET

            T1 -->|"读 SKILL.md"| SK["Skill 内容进入 messages"]
            T1 & T2 -->|"读写 MEMORY.md"| MEM["长期记忆\n跨 session 共享"]
            T2 & T3 & T4 -->|"操作文件/执行脚本"| WS["workspace 持久化文件"]

            G4 --> G5["afterToolCall Extension 后处理"]
        end

        G5 --> G6["toolResult 写入 messages\ntool_execution_end 推 stdout"]
        G6 --> H

        F -->|无| H

        H["turn_end"] --> I

        subgraph COMPACT["上下文压缩检查"]
            I{"tokens > contextWindow - 16384?"} -->|是| I1["LLM 摘要旧消息\n保留最近 20K tokens\n记录读写文件列表"]
            I1 --> I2["compactionSummary 写入 messages"]
            I -->|否| J
            I2 --> J
        end

        J["JSONL 自动持久化\npi-sessions/sessionId.jsonl"] --> K

        K{"shouldStopAfterTurn?"} -->|否| D
        K -->|是| L

        F -->|"无，检查 Follow-up"| M{"Follow-up 队列\n有消息?"}
        M -->|有| D1
        M -->|无| L
    end

    L(["stdout: agent_end\npi 进程继续等待下一条 stdin prompt"])

    style INIT fill:#e8f4f8,stroke:#2196F3
    style LOOP fill:#f0f8e8,stroke:#4CAF50
    style TOOLS fill:#fff8e1,stroke:#FF9800
    style STREAM fill:#fce4ec,stroke:#E91E63
    style COMPACT fill:#f3e5f5,stroke:#9C27B0
    style TOOLSET fill:#fff3e0,stroke:#FF9800
```

## 各阶段说明

### 启动阶段（一次性）

| 步骤 | 说明 |
|------|------|
| buildSystemPrompt | 拼装工具列表、Guidelines、Skills 索引、MEMORY.md 指引、当前日期/cwd |
| Skills 索引 | 只在 system prompt 放名字+描述+路径，SKILL.md 内容不展开（渐进式披露） |
| JSONL 恢复 | `--session-dir` + `--session {sessionId}` 加载上次对话历史，恢复 messages[] |

### Agent Loop

每次用户发消息执行一轮完整 loop，循环直到无 tool call 且无 follow-up 消息。

| 阶段 | 说明 |
|------|------|
| Steering 队列 | tool 执行期间外部注入的消息，在下一个 turn 开始前消费 |
| LLM 调用 | 流式请求 llm-proxy，逐 token 推送 thinking/text/toolcall delta 到 stdout |
| 工具执行 | 默认并行，含 sequential 标记的工具串行；Extension 可拦截前后处理 |
| Compaction | tokens 超限时自动触发，LLM 摘要旧消息，保留最近 20K tokens |
| JSONL 持久化 | 每轮结束自动写盘，pi 重启后完整恢复 |
| Follow-up 队列 | agent 本应结束时检查，有则继续执行 |

### 三层记忆

| 层级 | 存储位置 | 生命周期 | 作用 |
|------|---------|---------|------|
| 短期记忆 | pi 进程 messages[]（内存） | session 进程存活期间 | LLM 推理上下文 |
| 短期记忆恢复 | `pi-sessions/{sessionId}.jsonl`（磁盘） | 永久（用户不删则不删） | pi 重启后恢复完整对话历史 |
| 长期记忆 | `memory/MEMORY.md`（磁盘） | 永久（跨 session） | 跨 session 关键信息共享 |

### 工具与记忆的关系

```
read(SKILL.md)   → Skill 内容进 messages[]，指导当前任务执行
read(MEMORY.md)  → 读取跨 session 记忆，了解历史背景
write(MEMORY.md) → 更新跨 session 记忆，记录重要发现
bash/edit/write  → 操作 workspace/ 文件，结果持久保留
```

## 其他能力（未在图中展示）

| 功能 | 说明 |
|------|------|
| Branch 摘要 | 切换历史分支时 LLM 生成摘要插入 context |
| Extended Thinking | off/minimal/low/medium/high/xhigh 六级思考深度 |
| terminate: true | 工具返回此标志，整批都返回时跳过下一次 LLM 调用 |
| 并行结果顺序保证 | 并发执行但 toolResult 按 LLM 请求顺序写回 |
| Session HTML 导出 | 可导出完整对话为 HTML（test_pi 未启用） |
