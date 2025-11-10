# VSCode Prompt 管理插件 - 需求说明

## 1. 背景与目标
- 聚焦“单台电脑集中管理 Prompt”：许多 Prompt 零散地保存在不同 Markdown/笔记/终端片段中，难以统一检索与复用，本插件希望在本地工作站内实现一体化的整理、复用与优化。
- 借助 VSCode 原生交互（编辑器右键、命令面板、活动栏视图）完成 Prompt 的创建、检索、复制、编辑、删除与 AI 优化，让开发者无需离开当前工作上下文。
- 通过结构化存储（JSON 主存 + 可选 Markdown 镜像）与辅助工具（AI 生成标题/emoji、空白模板、GitHub 同步），提升 Prompt 资产的可读性、可维护性与分享效率。

## 2. 业务范围
1. 支持 VSCode 1.85+（Win/macOS/Linux 行为一致），默认离线可用。
2. AI 能力（自动标题/emoji、内容优化）需用户在设置中配置 Provider、模型、API Key 后启用。
3. Prompt 主存储位于本机用户目录，可通过配置绑定到网盘/同步盘，从而在同一台电脑的多个项目间共享。
4. 支持“空白 Prompt 模板”命令：自动创建 Markdown 文件、生成默认文件名，允许用户自定义或跳过，并在文末插入自动生成的标题。
5. 可选开启 GitHub 同步：当存储目录位于 Git 仓库内时，插件在 VSCode 中提供 git pull/commit/push 的快捷入口，帮助用户将 Prompt 同步到远端仓库。

## 3. 用户角色与场景
| 角色 | 主要诉求 | 典型场景 |
| --- | --- | --- |
| Prompt 作者 | 将当前编辑内容快速固化为可复用 Prompt | 选中文本 → 右键创建 → 填写元信息/调用 AI 生成标题 |
| Prompt 使用者 | 在任意项目中快速检索、复制或调整 Prompt | Ctrl+Shift+P 调出命令 → 搜索 → 复制到剪贴板或打开编辑 |
| Prompt 管理者 | 维护结构化元数据、查看 AI 调用耗费、导入导出 | 活动栏 TreeView 管理 → 查看 UsageLog → 导出 CSV |
| Markdown 爱好者 | 需要在纯 Markdown 文件中撰写 Prompt | 运行“新建 Prompt 文件”命令 → 自动打开 MD → 文末插入标题 |
| GitHub 同步用户 | 希望以 Git 形式管理 Prompt、回溯历史 | 在 Git 仓库中操作 Prompt → 插件提供一键同步与冲突提示 |

## 4. 功能需求
| 编号 | 功能 | 描述 | 关键要点 |
| --- | --- | --- | --- |
| F1 | Markdown 选区创建 | 编辑器右键 Prompt → Create As New Prompt，将选区内容保存为 Prompt | 自动记录来源路径/时间戳；名称唯一校验 |
| F2 | 命令面板管理 | Ctrl+Shift+P 进入 Prompt 命令集合，提供筛选、复制、编辑、删除等操作 | 模糊匹配、最近使用排序、一键复制到剪贴板 |
| F3 | Prompt 元数据 | 维护名称、emoji、正文、创建/更新时间、来源、标签、AI 生成标记 | emoji 可手选或 AI 推荐；标签用于 TreeView 分组 |
| F4 | 本地共享存储 | JSON 作为主存储，可导入导出；支持可插拔存储实现 | 写入采用临时文件 + 原子替换；可配置镜像目录 |
| F5 | 活动栏 TreeView | 活动栏展示 Prompt 列表，支持复制、编辑、删除、撤销 | 删除需二次确认，并在短时间内可撤销 |
| F6 | AI 辅助生成 | 调用 AI 自动生成标题/emoji 或优化正文 | 模型、温度、token 上限可配置；失败需提示并保留原稿 |
| F7 | AI 消耗记录 | 记录模型、token、费用、耗时、命令来源 | 提供命令或 Output Channel 查看，支持导出 CSV |
| F8 | 单元测试 | Storage、AI、命令层均需具备可测试性，CI 中自动运行 | 约定使用 Mocha + Chai + Sinon，覆盖率 ≥70% |
| F9 | 空白 Prompt 模板 | 命令面板直接新建 Markdown Prompt 文件 | 默认文件名 `prompt-{时间}.md`，可重命名；文末自动插入生成标题 |
| F10 | GitHub 同步 | 当存储目录位于 Git 仓库内时，插件提供 pull/commit/push 命令面板项 | 集成 git status、冲突提示、提交信息模板、同步日志 |
| F11 | 首次使用引导 | 插件首次激活时，自动启动配置向导，引导用户完成存储路径、AI Provider、Git 同步等初始化设置 | 支持跳过并使用默认值；可通过命令面板重新启动向导 |
| F12 | 快速打开设置 | 提供命令快速打开插件配置页面 | 在命令面板、TreeView、状态栏等位置提供快捷入口 |
| F13 | 选区智能识别名称 | 从选区创建 Prompt 时，自动识别 `# prompt:` 标记提取名称 | 识别 `# prompt:` 标记，模糊匹配、不区分大小写、忽略空格；未识别则使用默认名称 |

## 5. 非功能需求
- 性能：在 1000+ Prompt 情况下，TreeView/命令面板的刷新延迟 < 200ms；AI 请求默认超时 15s，可配置。
- 可用性：所有破坏性操作需二次确认并提示结果；AI 操作显示进度与错误信息；Git 同步需展示状态与冲突提示。首次使用引导需清晰、友好，允许跳过并使用默认配置。
- 可扩展性：存储与 AI Provider 均以接口隔离；Git 同步能力应能扩展到远端 API（如 Gist、团队仓库）。
- 安全性：API Key 保存在 VSCode SecretStorage；Git 同步过程中不得记录敏感凭据；UsageLog 不写入 Prompt 原文。
- 可测试性：服务层依赖注入、命令层可在 VSCode Test Host 中自动化；Git 同步流程需具备可模拟的接口。
- GitHub 同步：git 命令若失败需提示具体原因；允许设置最大执行时间（默认 5s），并在日志中记录每次同步的结果与提交 SHA。

## 6. 依赖与约束
- VSCode API：commands、window、workspace、TreeDataProvider、SecretStorage、Memento、Uri、env.clipboard、Progress API。
- AI Provider：初期支持 OpenAI 兼容接口，可扩展 Azure OpenAI、通义千问等；需���许自定义 Base URL、超时与代理。
- 文件系统：默认主存文件位于 `~/.prompt-hub/prompts.json`；空白模板与镜像目录均可配置；写入需处理同步盘锁定。
- Git 命令：依赖系统已安装 git（2.40+），在 VSCode 内通过 Node 子进程执行；需处理 pull 冲突、网络失败与认证错误。
- 离线约束：插件需在无网络环境下正常执行本地操作；AI/Git 功能应降级并提示。

## 7. 存储方案对比（JSON vs Markdown）
| 维度 | JSON 存储 | Markdown 存储 |
| --- | --- | --- |
| 结构化表达 | 原生支持 ID、时间戳、标签、AI 标记，易于检索与去重 | 需依赖 front-matter 或约定格式，解析复杂且易出错 |
| 性能与并发 | 可一次性加载或按需索引；便于增量写入 | 大文件需全文解析；多次插入可能导致冲突 |
| 用户可读性 | 原始 JSON 可读性一般，需借助视图或导出 | 直接打开即为 Markdown，天然适合阅读/编辑 |
| 工作流兼容 | 便于记录辅助字段（token、费用等），可直接驱动命令 | 需额外规则才能同步统计字段 |
| 与 Git 协同 | JSON 更利于结构化 diff；可配合 prettier-json | Markdown diff 可读但难以保证字段完整性 |

**结论：**
1. 以 JSON 作为权威主存，确保数据结构稳定、易扩展。
2. 提供可选的 Markdown 镜像与导入导出，兼顾可读性与知识库需求。
3. 空白 Prompt 模板命令直接面向 Markdown，保存时同步更新 JSON，保持双向一致。

## 8. 首次使用引导（Onboarding Wizard）

### 8.1 触发时机
- **首次激活**：用户首次安装插件并在 VSCode 中激活时，自动弹出引导向导。
- **检测条件**：通过 `Memento.get('promptHub.onboardingCompleted')` 判断；未完成则启动引导。
- **手动触发**：提供命令 `Prompt Hub: 重新运行配置向导`，允许用户随时重新配置。

### 8.2 引导流程

#### 步骤 1：欢迎页面
```
┌─────────────────────────────────────────────┐
│  🎉 欢迎使用 Prompt Hub                     │
│                                             │
│  让我们花 2 分钟完成初始配置，开始高效管理  │
│  您的 Prompt 资产。                         │
│                                             │
│  [开始配置]  [使用默认设置]  [稍后提醒]    │
└─────────────────────────────────────────────┘
```

**行为**：
- **开始配置**：进入步骤 2
- **使用默认设置**：跳过向导，使用 `~/.prompt-hub` 作为存储路径，不启用 AI 和 Git
- **稍后提醒**：关闭向导，下次启动 VSCode 时再次提示

---

#### 步骤 2：存储路径配置
```
┌─────────────────────────────────────────────┐
│  📁 选择 Prompt 存储位置                    │
│                                             │
│  Prompt 将保存在此目录，支持以下场景：      │
│                                             │
│  ○ 本地存储（默认）                        │
│     推荐：~/.prompt-hub                     │
│                                             │
│  ○ 云盘同步                                │
│     示例：~/OneDrive/prompts                │
│                                             │
│  ○ 项目级别（团队协作）                    │
│     示例：${workspaceFolder}/.prompts       │
│                                             │
│  当前路径：[~/.prompt-hub        ] [浏览]  │
│                                             │
│  [上一步]  [下一步]  [跳过此步]            │
└─────────────────────────────────────────────┘
```

**交互元素**：
- **单选卡片**：点击预设场景自动填充路径
- **路径输入框**：支持 `~`、环境变量、工作区变量
- **浏览按钮**：打开文件夹选择对话框
- **实时校验**：路径不存在时提示"将自动创建"；路径不可写时显示错误

**保存逻辑**：
- 写入 User Settings：`promptHub.storagePath`
- 如果目录不存在，自动创建并生成空的 `prompts.json`

---

#### 步骤 3：Git 仓库配置
```
┌─────────────────────────────────────────────┐
│  🔄 启用 Git 同步（可选）                   │
│                                             │
│  ✓ 已检测到路径 ~/.prompt-hub 不在 Git 仓库│
│                                             │
│  是否要启用版本控制和远程备份？             │
│                                             │
│  [ ] 在当前位置初始化 Git 仓库              │
│      (将执行：git init)                     │
│                                             │
│  如果已选择，请配置远程仓库（可选）：        │
│  GitHub URL: [                    ] [测试]  │
│                                             │
│  [ ] 启动时自动拉取最新 Prompt              │
│                                             │
│  [上一步]  [下一步]  [暂不启用]            │
└─────────────────────────────────────────────┘
```

**检测逻辑**：
- 执行 `git rev-parse --is-inside-work-tree` 检测是否在 Git 仓库内
- **场景 A**：已在 Git 仓库内 → 提示"✓ 已检测到 Git 仓库"，询问是否启用同步
- **场景 B**：不在仓库内 → 提供"初始化 Git"选项

**初始化操作**（如果用户勾选）：
1. 执行 `git init`
2. 创建 `.gitignore`：
   ```gitignore
   *.log
   .DS_Store
   node_modules/
   ```
3. 如果用户填写了远程 URL：
   ```bash
   git remote add origin <user-input>
   git add .
   git commit -m "chore: init prompt hub"
   git push -u origin main
   ```

**配置保存**：
```json
{
  "promptHub.git.enableSync": true,
  "promptHub.git.autoPullOnStartup": true
}
```

---

#### 步骤 4：AI Provider 配置（可选）
```
┌─────────────────────────────────────────────┐
│  🤖 配置 AI 辅助功能（可选）                │
│                                             │
│  AI 可帮您自动生成标题、emoji、优化内容     │
│                                             │
│  Provider: [OpenAI          ▼]              │
│  Model:    [gpt-4o          ▼]              │
│  API Key:  [****************   ] [测试连接] │
│  Base URL: [https://api.openai.com/v1    ]  │
│                                             │
│  连接状态：⏳ 等待测试...                   │
│                                             │
│  [上一步]  [完成配置]  [暂不配置]          │
└─────────────────────────────────────────────┘
```

**交互逻辑**：
- **Provider 下拉**：OpenAI、Azure OpenAI、通义千问、自定义
- **测试连接**：发送简单请求验证配置有效性
- **安全存储**：API Key 存入 `SecretStorage`，不保存在 settings.json

**保存逻辑**：
```json
// settings.json
{
  "promptHub.ai.provider": "openai",
  "promptHub.ai.model": "gpt-4o",
  "promptHub.ai.baseUrl": "https://api.openai.com/v1"
}
// SecretStorage
{
  "promptHub.ai.apiKey": "<user-input>"
}
```

---

#### 步骤 5：完成页面
```
┌─────────────────────────────────────────────┐
│  ✅ 配置完成！                              │
│                                             │
│  您的配置：                                 │
│  • 存储路径：~/.prompt-hub                  │
│  • Git 同步：已启用                         │
│  • AI 辅助：已配置 OpenAI (gpt-4o)          │
│                                             │
│  快速开始：                                 │
│  1. 选中文本 → 右键 → "Create As New Prompt"│
│  2. 打开命令面板 → "Prompt Hub: New Prompt" │
│  3. 查看侧边栏的 Prompt Hub 视图            │
│                                             │
│  [打开 Prompt Hub]  [查看文档]  [完成]     │
└─────────────────────────────────────────────┘
```

**行为**：
- **打开 Prompt Hub**：激活侧边栏 TreeView
- **查看文档**：打开插件文档网页
- **完成**：关闭向导，设置 `promptHub.onboardingCompleted = true`

---

### 8.3 向导设计原则

| 原则 | 实现方式 |
|------|----------|
| **可跳过** | 每个步骤提供"跳过"或"暂不配置"选项 |
| **使用默认值** | 欢迎页面提供"使用默认设置"快速路径 |
| **渐进式配置** | 核心功能（存储路径）必选，增强功能（Git/AI）可选 |
| **即时反馈** | 路径校验、Git 检测、API 测试均实时显示结果 |
| **可重入** | 提供命令重新运行向导，允许修改配置 |
| **错误容错** | Git init 失败、API 连接失败时提供降级方案 |

---

### 8.4 技术实现要点

#### A. 向导状态管理
```typescript
interface OnboardingState {
  step: number;                    // 当前步骤（1-5）
  storagePath: string;
  gitEnabled: boolean;
  gitRemoteUrl?: string;
  aiProvider?: 'openai' | 'azure' | 'custom';
  aiModel?: string;
  completed: boolean;
}

// 存储在 Memento（工作区级别）
context.workspaceState.update('promptHub.onboardingState', state);
```

#### B. UI 实现方式
- **推荐方案**：使用 `vscode.window.showQuickPick` + `vscode.window.showInputBox` 组合
- **备选方案**：使用 Webview 实现富交互界面（成本较高）

#### C. Git 命令执行
```typescript
async function initGitRepo(storagePath: string): Promise<void> {
  await exec('git init', { cwd: storagePath });
  await exec('git config user.name "Prompt Hub"');
  await exec('git config user.email "noreply@prompthub"');
  // 创建 .gitignore
  // 首次提交
}
```

#### D. 配置写入时机
- **步骤完成时**：立即写入对应配置项，避免中途退出丢失配置
- **向导取消时**：保留已配置的部分，下次继续

---

### 8.5 命令接口

| 命令 ID | 显示名称 | 说明 |
|---------|----------|------|
| `promptHub.startOnboarding` | Prompt Hub: 配置向导 | 启动首次使用引导 |
| `promptHub.resetOnboarding` | Prompt Hub: 重置配置向导 | 清除完成标记，重新运行 |
| `promptHub.configureStorage` | Prompt Hub: 配置存储路径 | 直接跳转到步骤 2 |
| `promptHub.configureGit` | Prompt Hub: 配置 Git 同步 | 直接跳转到步骤 3 |
| `promptHub.configureAI` | Prompt Hub: 配置 AI Provider | 直接跳转到步骤 4 |

---

### 8.6 自动触发逻辑

```typescript
export async function activate(context: vscode.ExtensionContext) {
  const onboardingCompleted = context.globalState.get('promptHub.onboardingCompleted', false);

  if (!onboardingCompleted) {
    // 延迟 1 秒，避免与其他插件冲突
    setTimeout(() => {
      vscode.commands.executeCommand('promptHub.startOnboarding');
    }, 1000);
  }

  // ... 其他初始化逻辑
}
```

---

## 9. 配置项完整清单

### 9.1 存储路径配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `promptHub.storagePath` | string | `~/.prompt-hub` | Prompt 存储根目录，支持绝对路径、~、环境变量、工作区变量 |
| `promptHub.storage.autoCreate` | boolean | `true` | 目录不存在时是否自动创建 |
| `promptHub.markdown.mirrorPath` | string | `${storagePath}/markdown` | Markdown 镜像目录（可选） |
| `promptHub.markdown.enableMirror` | boolean | `false` | 是否启用 Markdown 镜像 |
| `promptHub.markdown.filenameTemplate` | string | `prompt-{timestamp}.md` | 文件名模板，支持 `{name}`、`{timestamp}`、`{date}`、`{emoji}` 占位符 |
| `promptHub.markdown.askForFilename` | boolean | `false` | 创建 Markdown Prompt 时是否询问文件名 |
| `promptHub.selection.autoDetectPromptName` | boolean | `true` | 从选区创建 Prompt 时自动检测 `# prompt:` 标记 |
| `promptHub.selection.removePromptMarker` | boolean | `true` | 检测到标记后，是否从内容中移除标记行 |

**路径格式支持**：
- ✅ 绝对路径：`E:/Projects/my-prompts`
- ✅ 用户目录：`~/.prompt-hub` 或 `~/Documents/prompts`
- ✅ 环境变量：`${USERPROFILE}/OneDrive/prompts`（Windows）、`$HOME/prompts`（Linux/macOS）
- ✅ 工作区变量：`${workspaceFolder}/.prompts`（项目级别存储）
- ❌ 网络路径：`\\server\share\prompts`（暂不支持）

---

### 9.2 Git 同步配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `promptHub.git.enableSync` | boolean | `false` | 是否启用 Git 同步功能 |
| `promptHub.git.autoPullOnStartup` | boolean | `false` | VSCode 启动时自动拉取远程更新 |
| `promptHub.git.commitMessageTemplate` | string | `"chore: sync prompts"` | 提交信息模板，支持 `{datetime}` 占位符 |
| `promptHub.git.maxExecutionTime` | number | `5000` | Git 命令最大执行时间（毫秒） |
| `promptHub.git.autoCommitOnSave` | boolean | `false` | 保存 Prompt 时自动提交到本地仓库 |
| `promptHub.git.showSyncStatus` | boolean | `true` | 是否在状态栏显示同步状态 |

---

### 9.3 AI Provider 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `promptHub.ai.provider` | enum | `"openai"` | AI 提供商：`openai`、`azure`、`qwen`、`custom` |
| `promptHub.ai.model` | string | `"gpt-4o"` | 使用的模型名称 |
| `promptHub.ai.baseUrl` | string | `"https://api.openai.com/v1"` | API 基础 URL |
| `promptHub.ai.timeout` | number | `15000` | API 请求超时时间（毫秒） |
| `promptHub.ai.temperature` | number | `0.7` | 生成温度（0-2） |
| `promptHub.ai.maxTokens` | number | `500` | 最大 token 数量 |

**安全存储**（不在 settings.json 中）：
- `promptHub.ai.apiKey`：存储在 `SecretStorage`

---

### 9.4 UI 与交互配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `promptHub.ui.showEmojiPicker` | boolean | `true` | 创建 Prompt 时显示 emoji 选择器 |
| `promptHub.ui.defaultView` | enum | `"tree"` | TreeView 默认视图：`tree`（树形）、`flat`（平铺） |
| `promptHub.ui.sortBy` | enum | `"recent"` | 排序方式：`recent`（最近使用）、`name`（名称）、`created`（创建时间） |
| `promptHub.ui.confirmDelete` | boolean | `true` | 删除 Prompt 时是否二次确认 |
| `promptHub.ui.undoTimeout` | number | `5000` | 撤销操作的超时时间（毫秒） |

---

### 9.5 高级配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `promptHub.advanced.enableUsageLog` | boolean | `true` | 是否记录 AI 使用日志 |
| `promptHub.advanced.logLevel` | enum | `"info"` | 日志级别：`debug`、`info`、`warn`、`error` |
| `promptHub.advanced.maxPromptSize` | number | `100000` | 单个 Prompt 最大字符数 |
| `promptHub.advanced.autoBackup` | boolean | `true` | 是否自动备份 prompts.json |
| `promptHub.advanced.backupInterval` | number | `86400000` | 备份间隔（毫秒，默认 24 小时） |

---

### 9.6 配置优先级

当同一配置项在多个层级定义时，优先级顺序为：

```
工作区设置（Workspace Settings）
  ↓
用户设置（User Settings）
  ↓
默认值（Default Values）
```

**典型场景**：
```json
// User Settings（全局）
{
  "promptHub.storagePath": "~/global-prompts"
}

// Workspace Settings（项目 A）
{
  "promptHub.storagePath": "${workspaceFolder}/.prompts"
}
```
→ 在项目 A 中，使用项目级别路径；其他项目使用全局路径

---

## 10. GitHub 同步实现要点
- **存储检测**：启动时检测 `promptHub.storagePath` 是否位于 Git 仓库；若是则在状态栏或命令面板展示“Git 同步”相关入口。
- **命令集合**：提供 pull（拉取远端最新）、commit（带模板的提交对话框）、push（推送到默认远端）以及统一的“同步全部”命令。
- **状态提示**：同步前执行 `git status`，如存在未暂存或冲突文件需提示；pull/push 过程中通过 VSCode 进度框展示状态。
- **冲突处理**：pull 失败并检测到冲突时，需要列出受影响的 Prompt 文件或 JSON 条目，引导用户在 Git 中解决后重试。
- **日志记录**：同步动作写入独立 Output Channel（如 `Prompt Hub Git Sync`），记录命令、耗时、结果、错误信息；可选写入 UsageLog 以追踪历史。
- **配置项**：新增 `promptHub.git.enableSync`、`promptHub.git.commitMessageTemplate`、`promptHub.git.autoPullOnStartup` 等设置，允许用户定制同步策略。
- **安全与容错**：git 命令需要支持取消与超时；失败时需退回到安全状态，不影响本地 JSON/Markdown 的读写；禁止在日志中打印凭据。

---

## 11. 快速打开设置功能（F12）

### 11.1 功能目标
为用户提供快捷方式，一键打开 Prompt Hub 插件的配置页面，无需手动在 VSCode 设置中搜索。

### 11.2 实现方式

#### A. 命令面板入口
```typescript
// 命令 ID: promptHub.openSettings
vscode.commands.registerCommand('promptHub.openSettings', () => {
  vscode.commands.executeCommand('workbench.action.openSettings', '@ext:publisher.prompt-hub');
});
```

**命令显示名称**：`Prompt Hub: 打开设置`

#### B. TreeView 快捷入口

在活动栏的 Prompt Hub 视图顶部添加设置图标按钮：

```typescript
// TreeView 工具栏按钮
{
  "command": "promptHub.openSettings",
  "when": "view == promptHubView",
  "group": "navigation",
  "icon": "$(settings-gear)"
}
```

#### C. 状态栏快捷入口

当检测到配置问题时（如 Git 未配置、AI API Key 缺失），在状态栏显示提示：

```typescript
const statusBarItem = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right,
  100
);
statusBarItem.text = "$(warning) Prompt Hub";
statusBarItem.tooltip = "配置未完成，点击打开设置";
statusBarItem.command = "promptHub.openSettings";
statusBarItem.show();
```

#### D. 右键菜单入口

在 TreeView 的右键菜单中添加"打开设置"选项：

```json
{
  "command": "promptHub.openSettings",
  "when": "view == promptHubView",
  "group": "z_settings"
}
```

### 11.3 配置项分组

打开设置页面后，配置项按以下方式分组展示：

```json
// package.json - contributes.configuration
{
  "title": "Prompt Hub",
  "properties": {
    // === 存储配置 ===
    "promptHub.storagePath": { ... },
    "promptHub.storage.autoCreate": { ... },

    // === Git 同步 ===
    "promptHub.git.enableSync": { ... },
    "promptHub.git.autoPullOnStartup": { ... },

    // === AI 配置 ===
    "promptHub.ai.provider": { ... },
    "promptHub.ai.model": { ... },

    // === UI 设置 ===
    "promptHub.ui.showEmojiPicker": { ... },
    "promptHub.ui.sortBy": { ... }
  }
}
```

### 11.4 使用场景

| 场景 | 触发方式 | 预期结果 |
|------|----------|----------|
| 用户想修改存储路径 | 命令面板 → "打开设置" | 直接跳转到插件设置页面 |
| AI 功能报错（API Key 无效） | 点击状态栏警告图标 | 打开设置并高亮 AI 配置项 |
| 在 TreeView 中快速配置 | 点击视图顶部设置图标 | 打开设置页面 |
| 右键菜单操作 | TreeView 右键 → "打开设置" | 打开设置页面 |

---

## 12. 选区智能识别名称功能（F13）

### 12.1 功能目标
用户选中文本后右键创建 Prompt 时，插件自动检测选区内容中的 `# prompt:` 标记，智能提取 Prompt 名称和 emoji，提升创建体验。如果未检测到标记，则使用默认命名方式。

### 12.2 使用场景

#### 场景 1：选区包含 prompt 标记
```markdown
用户选中以下内容：
┌────────────────────────────────────────┐
│ # prompt: 🖨️ 代码审查清单             │
│                                        │
│ 在审查代码时，请检查以下方面：         │
│ 1. 代码质量                            │
│ 2. 安全性                              │
│ 3. 性能                                │
└────────────────────────────────────────┘

用户操作：右键 → "Create As New Prompt"

插件行为：
1. 检测到 `# prompt: 🖨️ 代码审查清单`
2. 提取名称："代码审查清单"
3. 提取 emoji："🖨️"
4. 自动填充到创建对话框
5. 内容自动移除标记行，只保留正文
```

#### 场景 2：选区无 prompt 标记
```markdown
用户选中以下内容：
┌────────────────────────────────────────┐
│ 这是一段普通的代码注释                 │
│ 用于说明函数的用途                     │
└────────────────────────────────────────┘

用户操作：右键 → "Create As New Prompt"

插件行为：
1. 未检测到 `# prompt:` 标记
2. 使用默认名称："New Prompt" 或让用户输入
3. emoji 使用默认值或让用户选择
4. 内容保持原样
```

### 12.3 标记格式规范

#### 标准格式
```markdown
# prompt: 🖨️ 这里是用户自定义的prompt名称
这里是具体内容
```

#### 格式规则
- **位置要求**：标记必须在选区的**第一行**
- **标记头**：以 `# prompt:` 开头（一级标题）
- **名称**：冒号后的内容作为 Prompt 名称
- **Emoji**：名称中可包含 emoji，会被自动提取
- **内容处理**：标记行会被移除，只保留后续内容作为 Prompt 正文

#### 匹配规则（灵活性）
- ✅ 模糊匹配：`#prompt:`、`# prompt:`、`#  prompt:` 均有效
- ✅ 不区分大小写：`# PROMPT:`、`# Prompt:` 均有效
- ✅ 忽略空格：`#prompt :` 也能识别
- ❌ 非首行：标记在第二行及以后不识别

### 12.4 实现逻辑

#### A. 检测与提取代码
```typescript
interface ParsedPromptInfo {
  name?: string;
  emoji?: string;
  content: string;
}

function parseSelectionForPrompt(selectedText: string): ParsedPromptInfo {
  const lines = selectedText.split('\n');
  const firstLine = lines[0];

  // 匹配 prompt 标记（不区分大小写，忽略空格）
  const PROMPT_HEADER_REGEX = /^#\s*prompt\s*:\s*(.+)$/i;
  const match = firstLine.match(PROMPT_HEADER_REGEX);

  if (match) {
    const fullName = match[1].trim();
    const { emoji, name } = extractEmojiAndName(fullName);

    // 移除标记行，保留剩余内容
    const content = lines.slice(1).join('\n').trim();

    return { name, emoji, content };
  }

  // 未检测到标记，返回原内容
  return { content: selectedText };
}

// 提取 emoji 和名称
function extractEmojiAndName(text: string): { emoji?: string; name: string } {
  // 匹配开头的 emoji（Unicode emoji）
  const emojiRegex = /^(\p{Emoji})\s*(.+)$/u;
  const match = text.match(emojiRegex);

  if (match) {
    return { emoji: match[1], name: match[2].trim() };
  }
  return { name: text };
}
```

#### B. 集成到创建流程
```typescript
// 命令 ID: promptHub.createFromSelection
vscode.commands.registerCommand('promptHub.createFromSelection', async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const selection = editor.document.getText(editor.selection);
  if (!selection) {
    vscode.window.showWarningMessage('请先选中文本');
    return;
  }

  // 智能解析选区
  const parsed = parseSelectionForPrompt(selection);

  // 1. 询问名称（如果检测到则预填充）
  const name = await vscode.window.showInputBox({
    prompt: '输入 Prompt 名称',
    placeHolder: '例如：代码审查清单',
    value: parsed.name  // 预填充检测到的名称
  });

  if (!name) return;

  // 2. 选择 emoji（如果检测到则预填充）
  const emoji = await selectEmoji(parsed.emoji);  // 传入默认值

  // 3. 保存 Prompt
  await promptStorage.add({
    id: generateId(),
    name: name,
    emoji: emoji,
    content: parsed.content,  // 使用处理后的内容（已移除标记行）
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: editor.document.uri.fsPath,
    tags: []
  });

  vscode.window.showInformationMessage(`✓ Prompt "${name}" 创建成功`);
});
```

### 12.5 支持的标记变体

| 选区内容 | 是否识别 | 提取结果 |
|----------|----------|----------|
| `# prompt: 代码审查` | ✅ | name: "代码审查" |
| `#prompt: 代码审查` | ✅ | name: "代码审查" |
| `# PROMPT: 代码审查` | ✅ | name: "代码审查" |
| `#  prompt  :  代码审查` | ✅ | name: "代码审查" |
| `# prompt: 🖨️ 代码审查` | ✅ | name: "代码审查", emoji: "🖨️" |
| `# prompt:📝文档模板` | ✅ | name: "文档模板", emoji: "📝" |
| `## prompt: 名称` | ❌ | 二级标题不识别 |
| `内容\n# prompt: 名称` | ❌ | 非首行不识别 |
| `prompt: 名称` | ❌ | 缺少 `#` |

### 12.6 用户体验优化

#### A. 视觉反馈
```typescript
// 检测到标记时显示提示
if (parsed.name) {
  vscode.window.showInformationMessage(
    `检测到 Prompt 名称：${parsed.emoji || ''}${parsed.name}`,
    { modal: false }
  );
}
```

#### B. 配置项
```json
{
  "promptHub.selection.autoDetectPromptName": {
    "type": "boolean",
    "default": true,
    "description": "从选区创建 Prompt 时自动检测 `# prompt:` 标记"
  },
  "promptHub.selection.removePromptMarker": {
    "type": "boolean",
    "default": true,
    "description": "检测到标记后，是否从内容中移除标记行"
  }
}
```

#### C. 降级策略
```typescript
// 如果用户禁用了自动检测
const autoDetect = vscode.workspace.getConfiguration('promptHub.selection')
  .get('autoDetectPromptName', true);

if (!autoDetect) {
  // 跳过检测，直接使用原始内容
  return { content: selectedText };
}
```

### 12.7 使用示例

#### 示例 1：完整的 Prompt 标记
```markdown
用户选中：
# prompt: 🐛 Bug 报告模板

**Bug 描述**：[简要描述]

**复现步骤**：
1. 步骤1
2. 步骤2

**预期行为**：[预期结果]
**实际行为**：[实际结果]

结果：
- name: "Bug 报告模板"
- emoji: "🐛"
- content: "**Bug 描述**：[简要描述]\n\n**复现步骤**：..."
```

#### 示例 2：纯文本名称
```markdown
用户选中：
# prompt: API 文档模板

这是一个 API 文档的模板内容

结果：
- name: "API 文档模板"
- emoji: (使用默认或让用户选择)
- content: "这是一个 API 文档的模板内容"
```

#### 示例 3：无标记
```markdown
用户选中：
这是一段代码注释
用于说明函数的用途

结果：
- name: (让用户输入)
- emoji: (让用户选择)
- content: "这是一段代码注释\n用于说明函数的用途"
```

---

## 13. 自定义文件名支持

### 13.1 功能目标
允许用户在创建 Prompt 时自定义文件名（用于 Markdown 镜像模式），而不是使用默认的 `prompt-{时间}.md` 格式。

### 13.2 实现方式

#### A. 创建 Prompt 时自定义文件名

```typescript
async function createPromptWithCustomFilename() {
  // 1. 输入 Prompt 名称
  const name = await vscode.window.showInputBox({
    prompt: '输入 Prompt 名称',
    placeHolder: '例如：代码审查清单'
  });

  if (!name) return;

  // 2. 询问是否自定义文件名
  const customFilename = await vscode.window.showInputBox({
    prompt: '自定义文件名（可选，留空使用默认）',
    placeHolder: `默认：prompt-${Date.now()}.md`,
    value: sanitizeFilename(name) + '.md'  // 预填充为名称的安全文件名
  });

  const filename = customFilename || `prompt-${Date.now()}.md`;

  // 3. 创建文件
  const filePath = path.join(mirrorPath, filename);
  // ... 创建逻辑
}

// 文件名安全化
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')  // 替换非法字符
    .replace(/\s+/g, '-')            // 空格转短横线
    .replace(/^\.+/, '')             // 移除开头的点
    .substring(0, 100);              // 限制长度
}
```

#### B. 配置项

```json
{
  "promptHub.markdown.filenameTemplate": {
    "type": "string",
    "default": "prompt-{timestamp}.md",
    "description": "Markdown 文件名模板，支持占位符：{name}（Prompt名称）、{timestamp}（时间戳）、{date}（日期YYYY-MM-DD）、{emoji}（emoji字符）"
  },
  "promptHub.markdown.askForFilename": {
    "type": "boolean",
    "default": false,
    "description": "创建 Markdown Prompt 时是否询问文件名"
  }
}
```

#### C. 模板变量支持

```typescript
function generateFilename(prompt: Prompt, template: string): string {
  const replacements = {
    '{name}': sanitizeFilename(prompt.name),
    '{timestamp}': Date.now().toString(),
    '{date}': new Date().toISOString().split('T')[0],
    '{emoji}': prompt.emoji || '',
    '{time}': new Date().toTimeString().split(' ')[0].replace(/:/g, '-')
  };

  let filename = template;
  for (const [key, value] of Object.entries(replacements)) {
    filename = filename.replace(key, value);
  }

  return sanitizeFilename(filename);
}
```

#### D. 使用示例

| 模板配置 | Prompt 名称 | 生成文件名 |
|----------|-------------|------------|
| `prompt-{timestamp}.md` | 任意 | `prompt-1704067200000.md` |
| `{name}.md` | 代码审查 | `代码审查.md` |
| `{date}-{name}.md` | Bug报告 | `2025-01-01-Bug报告.md` |
| `{emoji}{name}.md` | 📝 文档 | `📝文档.md` |

---

## 14. 命令清单汇总

### 14.1 核心命令

| 命令 ID | 显示名称 | 功能 | 快捷键建议 |
|---------|----------|------|-----------|
| `promptHub.createFromSelection` | Prompt Hub: 从选区创建 | 将编辑器选中内容创建为新 Prompt | 无 |
| `promptHub.newPromptFile` | Prompt Hub: 新建 Prompt 文件 | 创建空白 Markdown Prompt 文件 | 无 |
| `promptHub.searchPrompt` | Prompt Hub: 搜索 Prompt | 打开搜索面板，模糊匹配查找 | `Ctrl+Shift+P` |
| `promptHub.copyPrompt` | Prompt Hub: 复制 Prompt | 复制 Prompt 内容到剪贴板 | 无 |
| `promptHub.editPrompt` | Prompt Hub: 编辑 Prompt | 打开 Prompt 编辑界面 | 无 |
| `promptHub.deletePrompt` | Prompt Hub: 删除 Prompt | 删除选中的 Prompt（需确认） | 无 |

### 14.2 配置与管理命令

| 命令 ID | 显示名称 | 功能 |
|---------|----------|------|
| `promptHub.openSettings` | Prompt Hub: 打开设置 | 快速打开插件配置页面 |
| `promptHub.startOnboarding` | Prompt Hub: 配置向导 | 启动首次使用引导 |
| `promptHub.resetOnboarding` | Prompt Hub: 重置配置向导 | 清除完成标记，重新运行向导 |
| `promptHub.configureStorage` | Prompt Hub: 配置存储路径 | 直接跳转到存储路径配置 |
| `promptHub.configureGit` | Prompt Hub: 配置 Git 同步 | 直接跳转到 Git 配置 |
| `promptHub.configureAI` | Prompt Hub: 配置 AI Provider | 直接跳转到 AI 配置 |

### 14.3 Git 同步命令

| 命令 ID | 显示名称 | 功能 |
|---------|----------|------|
| `promptHub.git.pull` | Prompt Hub: Git Pull | 拉取远��仓库最新 Prompt |
| `promptHub.git.commit` | Prompt Hub: Git Commit | 提交本地 Prompt 更改 |
| `promptHub.git.push` | Prompt Hub: Git Push | 推送到远程仓库 |
| `promptHub.git.syncAll` | Prompt Hub: Git 同步全部 | 执行 pull → commit → push |
| `promptHub.git.status` | Prompt Hub: Git 状态 | 查看 Git 仓库状态 |

### 14.4 导入导出命令

| 命令 ID | 显示名称 | 功能 |
|---------|----------|------|
| `promptHub.importJSON` | Prompt Hub: 导入 JSON | 从 JSON 文件导入 Prompt |
| `promptHub.exportJSON` | Prompt Hub: 导出 JSON | 导出 Prompt 为 JSON 文件 |
| `promptHub.exportToMarkdown` | Prompt Hub: 导出为 Markdown | 将 Prompt 导出为 Markdown 文件 |

### 14.5 AI 辅助命令

| 命令 ID | 显示名称 | 功能 |
|---------|----------|------|
| `promptHub.ai.generateTitle` | Prompt Hub: AI 生成标题 | 为当前 Prompt 生成标题 |
| `promptHub.ai.generateEmoji` | Prompt Hub: AI 推荐 Emoji | 为当前 Prompt 推荐合适的 emoji |
| `promptHub.ai.optimizeContent` | Prompt Hub: AI 优化内容 | 优化 Prompt 内容 |
| `promptHub.ai.viewUsage` | Prompt Hub: 查看 AI 使用记录 | 打开 AI 调用统计和费用记录 |

### 14.6 其他功能命令

| 命令 ID | 显示名称 | 功能 |
|---------|----------|------|
| `promptHub.viewLogs` | Prompt Hub: 查看日志 | 打开 Output Channel 查看日志 |
| `promptHub.clearCache` | Prompt Hub: 清除缓存 | 清除插件缓存数据 |
| `promptHub.refreshView` | Prompt Hub: 刷新视图 | 重新加载 TreeView 数据 |

---
