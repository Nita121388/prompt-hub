下面给出一个可落地的「VSCode 扩展 + Obsidian Vault + AI CLI」设计方案，目标是让你在 VSCode 里用 Markdown 像“写笔记一样发命令”，并把记录沉淀到 Obsidian，最后自动汇总成“今日工作总结”。

---

## 1. 目标与核心体验（从用户视角）
你在 VSCode 任意 `.md` 文件里随手记：

- 一条命令：插入当前时间（可带格式、时区、是否带秒）。
- 一段记录：用关键字/标签/项目名一键“落到 Obsidian Vault 的指定目录 + 模板”。
- 直接浏览/编辑 Obsidian Vault 的 `.md`（像普通项目文件一样）。
- 一键生成“今日工作总结”（从当天记录聚合，交给 AI CLI 生成并输出到 Obsidian）。

---

## 2. 总体架构（推荐方案）
**推荐：VSCode 扩展做“记录入口 + 规则执行”，AI 用独立 CLI 做“总结生成”。**

- **VSCode 扩展（TypeScript）**
  - Markdown 命令解析器（从当前文档/选区解析 `@命令`）
  - Vault 适配器（把内容写入 Obsidian Vault：路径、命名、模板、去重、索引）
  - Vault 浏览/搜索（在 VSCode 工作区打开 Vault，提供快速跳转）
  - 触发 AI 总结（调用本地 CLI 或 Node 子进程，传入当天语料）

- **Obsidian Vault（纯文件系统）**
  - 你已有的知识库目录结构继续沿用
  - 插件只负责“按约定写入 md 文件 + 可选更新索引页”

- **AI CLI（独立命令行工具）**
  - 输入：当天记录集合（markdown/plaintext）
  - 输出：工作总结 markdown（可写回 Vault）
  - 模型可插拔：OpenAI/本地模型/企业内网模型

为什么推荐“AI 独立 CLI”：
- 扩展更稳定（少依赖网络/SDK），AI 失败不影响记录能力
- CLI 便于在 CI/定时任务/终端复用，也便于更换模型与提示词

---

## 3. Markdown 作为“操作命令”的语法设计（多方案对比）
你需要一种在 Markdown 中“看起来像记录、又能执行”的语法。

### 引用块命令 `> @cmd ...`
示例：
```md
> @time format=HH:mm  TODO:格式化支持不写，提供默认，支持智能提示
> @capture kw=项目A type=log
> @summary date=today
```
优点：不干扰正文、可读性强、容易解析、适合快速输入  
缺点：需要你习惯在命令前加 `>`

TODO:
- 输入指令能中英文 有空格或无空格都支持
- 不输入 capture 指令，也支持右键 capture，然后让用户选择关键字；
或者根据用户选中内容，自动解析关键字，落到 Obsidian
- 今日工作总结，自动根据今日落到Obsidian的文件、和用户指定的固定文件、用户点击文件右键选择加入今日总结、
- 支持新建一个可以落到 Obsidian 的文件，支持选择模板，支持菜单绑定快速创建文件


---

## 4. 功能拆解与关键设计

### 4.1 快速输入当前时间
- 触发方式：
  - 命令面板：`PromptHub: 插入时间`
  - 快捷键：例如 `Ctrl+Alt+T`
  - Markdown 命令：`> @time format=YYYY-MM-DD HH:mm`  TODO：希望时间输入指令能中英文 有空格或无空格都支持
- 配置项：
  - `time.format`、`time.timezone`、`time.locale`、`time.prefix`（如 `- `）

### 4.2 记录内容：按关键字创建到 Obsidian
这里要解决的本质问题：**“这段内容该落到 Vault 的哪里、用什么文件名、如何避免重复、是否要更新索引？”**

设计要点：
- **路由规则（Routing）**：根据关键字/标签/项目映射目录与模板  
  - 例：`kw=项目A -> Vault/Projects/项目A/Log/2026-01-08.md`
- **文件命名策略**：
  - 日志型：按日期落单文件（append）
  - 事件型：按时间戳建新文件（one note per item）
- **模板（Template）**：
  - frontmatter：`date / project / tags / source=vscode`
  - 正文：插入原文 + 回链（可选）
- **去重策略**：
  - 以内容 hash + 当日文件为粒度，避免重复 append
- **索引更新（可选）**：
  - 更新 `Vault/Daily/2026-01-08.md` 增加链接与摘要行

### 4.3 在 VSCode 中显示/编辑 Obsidian 的 md
推荐两种入口（都可以做）：
1) **把 Vault 当工作区文件夹打开**（最简单、最稳定）  
- 扩展提供命令：`PromptHub: 打开 Obsidian Vault`（选择路径，自动 `Add Folder to Workspace`）

2) **扩展提供“虚拟视图/树”**（锦上添花）  
- 侧边栏 `PromptHub Vault`：按 `Daily / Projects / Tags` 分类展示、搜索、最近编辑

MVP 建议先做 1)，因为 VSCode 原生文件浏览/搜索/Markdown 预览已经很好用。

### 4.4 AI CLI：根据记录生成“今日工作总结”
关键在于“语料收集与结构化”，否则 AI 输出会空泛。

**语料来源（建议组合）：**
- 今日新增/修改的 Vault 文件（按 `Daily/日期.md` 或 frontmatter `date=today`）
- 你在 VSCode 记录页中标记为 `type=log` 的段落
- 可选：Git 提交信息、Jira/飞书任务（后续扩展）

**结构化建议：**
- 扩展把当天记录整理成统一输入：
  - 按项目分组
  - 每条记录带时间、来源文件、标签
- AI 输出模板（可配置）：
  - 今日完成 / 进行中 / 风险阻塞 / 明日计划 / 需要协助
- 输出落盘：
  - `Vault/Reports/Daily/2026-01-08 工作总结.md`
  - 并在 `Daily/2026-01-08.md` 中插入链接

---

## 5. 工程实现要点（扩展侧）
- 技术栈：VSCode Extension（TypeScript + vscode API）
- 模块划分：
  - `commandParser`：解析 `@time/@capture/@summary`
  - `vaultService`：读写文件、append、frontmatter、索引更新
  - `routingRules`：关键字→目录/模板（JSON/YAML 配置）
  - `aiBridge`：调用 CLI（spawn），传入 input，接收输出写回 Vault
- 配置（settings.json）：
  - `prompthub.vaultPath`
  - `prompthub.rulesPath`
  - `prompthub.timeFormat`
  - `prompthub.summary.cliPath`
  - `prompthub.summary.model/provider`（如果 CLI 也读配置）

---

## 6. 风险与边界（提前规避）
- **Vault 路径与多设备同步冲突**：append 日志要做简单锁/重试，或优先“每条记录独立文件”以减少冲突。
- **隐私与合规**：AI 默认本地/可脱敏；发送到云端需显式开关与提示。
- **解析鲁棒性**：命令应“失败不破坏正文”，只在可确定时执行。
- **可维护性**：规则/模板外置（YAML/JSON），避免把业务逻辑写死在扩展里。

---

## 7. MVP 里程碑（建议 2 周内可交付）
1) VSCode 扩展：插入时间（命令面板+快捷键+`@time`）
2) Vault 打开与写入：`@capture kw=...` 按规则写入/append
3) 当日聚合：自动生成/更新 `Daily/日期.md`
4) AI CLI：读当日聚合文件 → 生成总结 md → 写入 `Reports/Daily/`

---

## 你需要确认的 5 个问题（确认后方案可定稿）
1) Obsidian Vault 的目录结构偏好：`Daily/Projects/Tags` 还是你已有结构？
2) “关键字”来源：手填 `kw=项目A`，还是从标签 `#项目A` 自动识别？
3) 记录落盘策略：更像“日记追加到同一文件”，还是“每条记录一文件”？
4) 工作总结格式：你希望更偏“周报风格”还是“站会风格”（完成/阻塞/计划）？
5) AI 模型：能用云端（OpenAI 等）还是必须本地/内网？

如果你回答这 5 个问题，我可以把路由规则、模板示例、命令语法（含参数表）和 MVP 的目录约定直接给到可执行级别的规格说明。