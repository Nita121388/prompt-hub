# VSCode Prompt 管理插件 - 开发设计文档

## 1. 总体架构

```
VSCode Extension Host
├─ CommandRegistrar：集中注册命令并注入依赖
├─ PromptStorageService：管理 JSON 存储与 Markdown 镜像
├─ PromptTreeProvider：活动栏树视图
├─ PromptPaletteProvider：命令面板数据源
├─ AIService：标题/emoji 生成与内容优化
├─ UsageLogService：AI 调用统计
├─ GitSyncService：检测存储目录是否为 Git 仓库，提供 git pull/commit/push 与状态展示
├─ OnboardingWizard：首次使用引导向导
├─ SettingsService：快速打开设置、配置项管理
├─ SelectionParser：选区智能识别 Prompt 名称
└─ ConfigurationService：读取配置、监听变更、管理 SecretStorage
```

各模块通过事件发射器（EventEmitter<void>）松耦合刷新；服务层暴露接口，方便单元测试通过 mock 注入。

---

## 2. 模块职责

| 模块 | 主要职责 | 关键接口 |
| --- | --- | --- |
| **PromptStorageService** | 以 JSON 为主存，负责 CRUD、导入导出、与 Markdown 镜像的同步 | `list()`, `save(prompt)`, `remove(id)`, `export(format)`, `syncMarkdown()` |
| **PromptTreeProvider** | 构建树结构，处理复制/编辑/删除/撤销命令 | `getChildren()`, `getTreeItem()`, `refresh(trigger)` |
| **PromptPaletteProvider** | 命令面板搜索、最近使用排序、快捷操作 | `provideQuickPickItems(filter)` |
| **AIService** | 统一封装调用接口，生成标题/emoji、优化内容并返回 token 统计 | `generateMeta(content)`, `optimize(content, intent)` |
| **UsageLogService** | 记录 AI 耗费、失败信息，提供查询与 CSV 导出 | `record(log)`, `query(filter)`, `exportCSV(path)` |
| **PromptFileService** | 新建 Markdown 模板、自定义文件名、打开编辑器并插入标题 | `createBlankFile(options)`, `appendTitle(fileUri, title)` |
| **ConfigurationService** | 读取 `promptHub.*` 设置、监听变更、管理 SecretStorage | `get(key)`, `onDidChange(cb)`, `storeSecret(key, value)` |
| **GitSyncService** | 检测存储目录是否为 Git 仓库，提供 git pull/commit/push 并展示同步状态 | `ensureRepo()`, `pull()`, `commit(message)`, `push()`, `status()` |
| **OnboardingWizard** | 首次使用引导，5 步向导（欢迎→存储路径→Git→AI→完成） | `start()`, `skipStep()`, `complete()` |
| **SettingsService** | 快速打开插件配置页面，提供多入口访问 | `openSettings(section?)` |
| **SelectionParser** | 从选区第一行检测 `# prompt:` 标记，提取名称和 emoji | `parseSelection(text)`, `extractEmojiAndName(text)` |

---

## 3. 数据模型

```typescript
interface Prompt {
  id: string;
  name: string;
  emoji?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sourceFile?: string;
  tags?: string[];
  aiGeneratedMeta?: boolean;
  fromMarkdownFile?: Uri;
}

interface AIUsageLog {
  id: string;
  promptId?: string;
  fileUri?: string;
  operation: 'meta' | 'optimize';
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost?: number;
  durationMs: number;
  timestamp: string;
  status: 'success' | 'failed';
  message?: string;
}

interface PromptFileDraft {
  fileName: string;
  targetDir: Uri;
  title: string;
  emoji?: string;
}

interface OnboardingState {
  step: number;                    // 当前步骤（1-5）
  storagePath: string;
  gitEnabled: boolean;
  gitRemoteUrl?: string;
  aiProvider?: 'openai' | 'azure' | 'custom';
  aiModel?: string;
  completed: boolean;
}
```

Prompt 对象作为 JSON 存储的基本单元。`fromMarkdownFile` 字段用于映射 Markdown 镜像或用户通过 F9 创建的文件。

---

## 4. 关键流程

### 4.1 选区创建（F1 + F13）

1. 命令触发后读取当前选区文本与来源 URI。
2. **智能识别**：调用 `SelectionParser.parseSelection()` 检测第一行是否有 `# prompt:` 标记：
   - 如有，提取名称和 emoji，移除标记行
   - 如无，使用默认流程
3. 通过 QuickInput 收集名称（预填充识别结果）、emoji、标签；如选择 AI 自动生成则调用 `AIService.generateMeta`。
4. `PromptStorageService.save` 写入 JSON，保存前进行名称唯一性校验；写入成功后同步到 Markdown（若用户开启镜像）。
5. 触发 `PromptTreeProvider.refresh`，状态栏提示结果。

### 4.2 命令面板管理（F2）

- `PromptPaletteProvider` 在初始化时加载所有 Prompt，构建模糊索引（fuse.js 或自实现）。
- 每次命令执行更新最近使用队列并写入 `workspaceState`，供下次排序。
- 复制命令通过 `env.clipboard.writeText`；编辑命令跳转到自定义编辑器（Webview + Diff）。

### 4.3 活动栏视图（F5）

- `PromptTreeProvider` 以标签/文件夹为一级节点，Prompt 为叶子节点。
- 上下文菜单提供"复制/编辑/删除/AI 优化/打开设置/查看日志"，删除前弹出 `showWarningMessage`。
- 删除后记录至 UndoStack（vscode.Memento），允许"撤销最近删除"。
- **快速打开设置**：TreeView 工具栏添加设置图标按钮（F12）。

### 4.4 AI 辅助（F6/F7）

- `AIService` 支持多 Provider，策略模式基于配置选择底层实现。
- 请求阶段显示进度通知，允许取消；成功后返回建议标题/emoji 或优化内容差异。
- `UsageLogService` 记录 tokens/费用/耗时/命令来源；提供 `Prompt: View AI Usage` 命令。

### 4.5 空白 Prompt 模板（F9）

1. 用户通过命令面板或活动栏按钮触发 `promptHub.createBlankPrompt`。
2. `PromptFileService` 生成文件名：
   - 使用模板：`promptHub.markdown.filenameTemplate`（支持 `{name}`、`{timestamp}`、`{date}`、`{emoji}` 占位符）
   - 如启用 `promptHub.markdown.askForFilename`，弹出输入框让用户自定义
3. 文件写入基础内容：front-matter（可选）、空行、`<!-- prompt-body -->` 占位符。
4. 如用户勾选"自动生成标题"，则调用 `AIService.generateMeta` 获取标题/emoji，并在文件末尾插入 `## {emoji}{title}`。若 AI 不可用，则使用占位标题 `## 新 Prompt`。
5. 打开 Markdown 文件到新编辑器标签页，并将光标定位到正文区域；同时在 JSON 存储中生成一条草稿 Prompt 记录，字段 `fromMarkdownFile` 指向该文件。
6. 当用户保存文件时触发 `workspace.onDidSaveTextDocument`，由 `PromptFileService.syncMarkdown` 解析最新内容并更新 JSON。

### 4.6 GitHub 同步（F10）

1. `GitSyncService` 初始化时调用 `ensureRepo()` 检测存储目录是否为 Git 仓库，检测失败则提示用户配置或手动初始化。
2. 用户通过命令面板或状态栏按钮触发同步命令，先执行 `git status` 确认是否有未修改，冲突时提示用户先处理。
3. 执行 `git pull` 并展示同步状态；如有冲突时在 `Prompt Hub Output Channel` 显示需要手动选择保留的 Prompt。
4. 提交阶段，由用户输入 commit 信息（或使用模板），调用 `commit(message)` 和 `git push`；过程中展示进度。
5. 命令执行期间支持取消，超时或出现异常时 `GitSyncService` 需自动回退到安全状态；单次操作限制时间 5 秒。
6. 同步动作记录到独立 Git Channel 日志中，用户可随时查询同步历史。

### 4.7 首次使用引导（F11）

1. **触发检测**：插件激活时检查 `context.globalState.get('promptHub.onboardingCompleted')`，未完成则延迟 1 秒启动向导。
2. **5 步流程**：
   - **步骤 1**：欢迎页面，提供"开始配置"、"使用默认设置"、"稍后提醒"三个选项
   - **步骤 2**：存储路径配置，提供预设场景（本地/云盘/项目级别），支持浏览选择
   - **步骤 3**：Git 仓库配置，自动检测 + 提供初始化选项 + 远程 URL 配置
   - **步骤 4**：AI Provider 配置，支持多提供商 + API Key + 测试连接
   - **步骤 5**：完成页面，展示配置摘要 + 快速开始指南
3. **UI 实现**：使用 `vscode.window.showQuickPick` + `vscode.window.showInputBox` 组合。
4. **状态保存**：每步完成立即写入配置，避免中途退出丢失；向导取消时保留已配置部分。
5. **命令接口**：提供 `promptHub.startOnboarding`、`promptHub.resetOnboarding`、`promptHub.configureStorage` 等命令。

### 4.8 快速打开设置（F12）

1. **多入口访问**：
   - 命令面板：`Prompt Hub: 打开设置`
   - TreeView 工具栏：设置图标按钮
   - 状态栏：配置问题时显示警告图标
   - 右键菜单：TreeView 右键菜单
2. **实现逻辑**：执行 `vscode.commands.executeCommand('workbench.action.openSettings', '@ext:publisher.prompt-hub')`
3. **智能提示**：检测到配置问题（Git 未配置、AI API Key 缺失）时，状态栏显示可点击的警告提示。

---

## 5. 存储与同步策略

1. **主存储**：JSON 文件，结构为 `{ version, prompts: Prompt[], usageLogs: AIUsageLog[] }`；写入采用临时文件+原子重命名策略。
2. **Markdown 镜像**：可配置是否为每个 Prompt 生成单独 Markdown；镜像目录结构与标签、来源映射，便于用户直接浏览。
3. **F9 文件同步**：
   - 初次创建即写入 Markdown；
   - 监听保存事件 → 解析 front-matter 或特定标记获取名称/内容 → 更新 JSON；
   - 如用户删除 Markdown 文件，`syncMarkdown` 会提示是否删除对应 Prompt。
4. **冲突处理**：若 JSON 与 Markdown 均被修改，使用"时间戳优先"策略并提示用户，否则以 JSON 为准。

---

## 6. 配置、安全与容错

### 配置项清单

参见 `requirements.md` 第 9 章完整配置清单，主要包括：

- **存储路径**：`promptHub.storagePath`、`promptHub.storage.autoCreate`
- **Markdown**：`promptHub.markdown.*`（镜像、文件名模板、自动导入等）
- **Git 同步**：`promptHub.git.*`（enableSync、autoPullOnStartup、commitMessageTemplate 等）
- **AI Provider**：`promptHub.ai.*`（provider、model、baseUrl、temperature、maxTokens 等）
- **UI 交互**：`promptHub.ui.*`（showEmojiPicker、defaultView、sortBy 等）
- **选区识别**：`promptHub.selection.*`（autoDetectPromptName、removePromptMarker）
- **高级配置**：`promptHub.advanced.*`（enableUsageLog、logLevel、autoBackup 等）

### 安全

- **SecretStorage**：保存 API Key，命令 `Prompt: Configure AI Key` 写入；读取失败时提示。
- **Git 凭据**：同步过程中不记录敏感凭据，禁止在日志中打印。

### 容错

- AI 请求采用指数退避；文件写入失败时回滚并提示；剪贴板失败给出错误信息而不阻塞其他功能。
- Git 命令失败需提示具体原因；允许设置最大执行时间（默认 5s）。

---

## 7. 日志与监控

- **Output Channel - Prompt Hub**：记录关键操作、AI 请求摘要、错误堆栈。
- **Output Channel - Prompt Hub Git Sync**：Git 同步日志、失败原因/堆栈、提交 SHA。
- **UsageLogService**：提供 query 参数支持按日期/模型过滤，便于手动报表。
- **可选 Telemetry**：如需匿名统计，需提供显式开关并遵守 VSCode 市场政策。

---

## 8. 测试与 CI 设计要点

### 单元测试

- **PromptStorageService**：使用 memfs 模拟文件系统，验证 CRUD、镜像同步、冲突处理。
- **PromptFileService**：结合 Sinon stub VSCode API，确保默认命名、重命名、AI 标题插入逻辑正确。
- **AIService**：注入 HTTP mock，覆盖成功/失败/超时分支。
- **GitSyncService**：使用 simple-git mock 验证 pull/commit/push 命令功能，模拟 git 命令返回值。
- **SelectionParser**：测试各种标记格式的识别（大小写、空格、emoji 提取）。
- **OnboardingWizard**：模拟用户交互流程，验证状态保存和跳过逻辑。

### 集成测试

使用 `@vscode/test-electron` 启动沙盒工程，执行核心命令链路（创建→编辑→删除→新建模板→Git 同步）。

### CI

GitHub Actions ubuntu-latest 执行 `npm ci`, `npm run lint`, `npm test -- --coverage`; 生成 LCOV 上传到 Codecov（可选）。

---

## 9. 扩展性设计

- **存储插件化**：`PromptStorageService` 接口隔离，未来可扩展云端存储（Gist、团队仓库）。
- **AI Provider 插件化**：策略模式支持多 Provider（OpenAI、Azure、通义千问、自定义）。
- **Git 同步扩展**：可扩展到远端 API（如 Gist、团队仓库）。
- **命令扩展**：新功能通过 `CommandRegistrar` 统一注册，保持架构一致性。
