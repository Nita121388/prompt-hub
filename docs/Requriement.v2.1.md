下面给出一个可落地的「VSCode 扩展 + Obsidian Vault + AI CLI」设计方案，目标是让你在 VSCode 里用 Markdown 像“写笔记一样发命令”，并把记录沉淀到 Obsidian，最后自动汇总成“今日工作总结”。

---

## 1. 目标与核心体验（从用户视角）
你在 VSCode 任意 `.md` 文件里随手记：

- 一条命令：插入当前时间（可带格式、时区、是否带秒，支持中英混输与空格容错）。
- 一段记录：用关键字/标签/项目名一键“落到 Obsidian Vault 的指定目录 + 模板”，也可选中内容后右键“发送到 Obsidian”支持选择模板。
- 直接浏览/编辑 Obsidian Vault 的 `.md`（像普通项目文件一样）。
- 一键生成“今日工作总结”（从当天记录聚合，交给 AI CLI 生成并输出到 Obsidian）。

---

## 2. 总体架构（推荐方案）
**推荐：VSCode 扩展做“记录入口 + 规则执行”，AI 用独立 CLI 做“总结生成”。**

- **VSCode 扩展（TypeScript）**
  - Markdown 命令解析器（从当前文档/选区解析 `@命令`，中英文别名与空格都容忍）
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
> @time format=HH:mm  TODO:这里输入之后自动将命令渲染为时间，类似于一个标签样式，点击该事件再显示命令原本的文本样式
> @capture kw=项目A type=log
> @summary date=today
```
优点：不干扰正文、可读性强、容易解析、适合快速输入  
缺点：需要你习惯在命令前加 `>`

改进与容错：
- 指令支持中英文：`@time`/`@时间`、`@capture`/`@捕获`、`@summary`/`@总结`
- 支持有空格或无空格：`@timeformat=HH:mm`、`@time format=HH:mm` 均可解析
- 未写格式时默认 `YYYY-MM-DD HH:mm`，可在设置中覆盖
- 未写 capture 指令时，可右键“发送到 Obsidian”，或对选中文本右键触发；若未提供关键字，按内容自动提取（项目名/标签/行首 #tag）

自动化补充：
- 今日工作总结默认收集：当日写入/修改的 Vault 文件 + 用户指定的固定文件清单 + 右键“加入今日总结”的文件
- 支持新建可落盘到 Obsidian 的文件：命令面板/右键菜单选择模板与目标目录，快捷键可绑定常用模板
- 落到obsidian的文本片段、文件支持标记出来

---

## 4. 功能拆解与关键设计

### 4.1 快速输入当前时间
- 触发方式：
  - 命令面板：`PromptHub: 插入时间`
  - 快捷键：例如 `Ctrl+Alt+T`
  - Markdown 命令：`> @time format=YYYY-MM-DD HH:mm`（中英文别名、空格容错）
- 配置项：
  - `time.format`、`time.timezone`、`time.locale`、`time.prefix`（如 `- `）

### 4.2 记录内容：按关键字创建到 Obsidian
本质：**“这段内容该落到 Vault 的哪里、用什么文件名、如何避免重复、是否要更新索引？”**

设计要点：
- **路由规则（Routing）**：根据关键字/标签/项目映射目录与模板  
  - 例：`kw=项目A -> Vault/Projects/项目A/Log/2026-01-08.md`
  - 未显式提供 kw 时，从选中文本/行内 `#标签`/标题自动提取
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
- **交互补充**：
  - 右键“发送到 Obsidian”可在无命令输入时完成 capture
  - 选中文本右键可先弹出关键字选择/自动建议，再执行落盘
  - **资源右键落盘（文件/文件夹）**：在 VSCode 资源管理器（Explorer）对文件或文件夹右键，支持“存储到 Obsidian”
    - 文件：复制到 Vault 的附件目录（如 `Vault/Attachments/` 或按规则分流），并可选择同时生成一条引用该文件的笔记（含来源路径、时间、标签/项目）
    - 文件夹：按规则将文件夹（可选递归）复制到 Vault 指定目录，并自动生成 `index.md`（或同名 `.md`）作为目录索引，列出子文件/子目录链接，便于在 Obsidian 内浏览
    - **默认存储路径 + 选择新路径**：
      - 默认：优先写入用户配置的“默认目标目录”（可按 capture/附件分别配置）
      - 临时改路径：右键菜单提供“存储到 Obsidian（选择路径）”，弹出 Vault 内目录选择器（或输入相对路径）本次生效
      - 可选：在选择路径对话框中提供“设为默认路径”的勾选项，用于把本次选择写回设置（提升长期使用效率）

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
- VSCode 中标记为 `type=log` 的段落
- 用户指定的固定文件（配置/右键加入）
- 右键“加入今日总结”的文件列表

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
  - `commandParser`：解析 `@time/@capture/@summary`（中英文别名与空格容错）
  - `vaultService`：读写文件、append、frontmatter、索引更新
  - `routingRules`：关键字→目录/模板（JSON/YAML 配置）
  - `aiBridge`：调用 CLI（spawn），传入 input，接收输出写回 Vault
- 配置（settings.json）：
  - `prompthub.vaultPath`
  - `prompthub.rulesPath`
  - `prompthub.timeFormat`
  - `prompthub.capture.defaultTargetDir`（默认写入的 Vault 子目录：如 `Inbox/`、`Projects/<name>/`）
  - `prompthub.capture.attachmentsDir`（文件右键“存储到 Obsidian”的附件目录：如 `Attachments/`）
  - `prompthub.capture.alwaysAskTargetDir`（右键/命令触发时是否总是弹出“选择路径”）
  - `prompthub.summary.cliPath`
  - `prompthub.summary.model/provider`（如果 CLI 也读配置）
  - `prompthub.summary.extraFiles`（纳入总结的固定文件列表）

---

## 6. 风险与边界（提前规避）
- **Vault 路径与多设备同步冲突**：append 日志要做简单锁/重试，或优先“每条记录独立文件”以减少冲突。
- **隐私与合规**：AI 默认本地/可脱敏；发送到云端需显式开关与提示。
- **解析鲁棒性**：命令应“失败不破坏正文”，只在可确定时执行；未知指令静默忽略并标注提示。
- **可维护性**：规则/模板外置（YAML/JSON），避免把业务逻辑写死在扩展里。

---

## 7. MVP 里程碑（建议 2 周内可交付）
1) VSCode 扩展：插入时间（命令面板+快捷键+`@time`）
2) Vault 打开与写入：`@capture kw=...` 按规则写入/append（含右键/选中快速捕获）
2.1) Explorer 右键：文件/文件夹“存储到 Obsidian”（支持默认路径与“选择新路径”）
3) 当日聚合：自动生成/更新 `Daily/日期.md`
4) AI CLI：读当日聚合文件 → 生成总结 md → 写入 `Reports/Daily/`

---

## 你需要确认的 5 个问题（确认后方案可定稿）
1) Obsidian Vault 的目录结构偏好：`Daily/Projects/Tags` 还是你已有结构？
2) “关键字”来源：手填 `kw=项目A`，还是从标签 `#项目A` 自动识别？
3) 记录落盘策略：更像“日记追加到同一文件”，还是“每条记录一文件”？
4) 工作总结格式：你希望更偏“周报风格”还是“站会风格”（完成/阻塞/计划）？
5) AI 模型：能用云端（OpenAI 等）还是必须本地/内网？
