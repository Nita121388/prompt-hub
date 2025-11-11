# VSCode Prompt 管理插件 - 任务清单

## 项目概览

本文档跟踪 Prompt Hub 插件的开发任务进度，按功能模块组织。

**文档版本**：v1.0
**最后更新**：2025-01-10
**当前阶段**：需求设计完成，准备进入开发阶段

---

## 任务状态说明

- ✅ **已完成**：功能已实现并通过测试
- 🚧 **进行中**：正在开发或测试
- ⏳ **待开始**：已规划但尚未开始
- ⏸️ **暂停**：因依赖或优先级暂停
- ❌ **已取消**：不再需要实现

---

## 1. 项目初始化与配置

| 任务 | 状态 | 负责人 | 优先级 | 备注 |
|------|------|--------|--------|------|
| 创建项目脚手架 | ⏳ | - | P0 | 使用 yo code 生成基础结构 |
| 配置 TypeScript | ⏳ | - | P0 | tsconfig.json, 编译设置 |
| 配置 ESLint/Prettier | ⏳ | - | P1 | 代码规范与格式化 |
| 配置测试环境 (Mocha) | ⏳ | - | P0 | 单元测试与集成测试 |
| 配置 CI/CD (GitHub Actions) | ⏳ | - | P1 | 自动化测试与发布 |
| 编写 package.json 元信息 | ⏳ | - | P0 | 插件名称、版本、依赖 |

---

## 2. 核心存储服务 (F1, F4)

### 2.1 PromptStorageService

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 Prompt 数据模型定义 | ⏳ | P0 | 2h | interface Prompt |
| 实现 JSON 文件读写 | ⏳ | P0 | 4h | 原子写入、错误处理 |
| 实现 CRUD 操作 (list/save/remove) | ⏳ | P0 | 6h | 增删改查核心逻辑 |
| 实现名称唯一性校验 | ⏳ | P0 | 2h | 防止重名 |
| 实现数据迁移机制 (migrate) | ⏳ | P1 | 3h | 版本升级兼容 |
| 实现自动备份功能 | ⏳ | P2 | 3h | 定期备份 JSON |
| 单元测试 - CRUD 操作 | ⏳ | P0 | 4h | 覆盖所有边界条件 |
| 单元测试 - 冲突处理 | ⏳ | P1 | 2h | 并发写入测试 |

### 2.2 Markdown 镜像功能

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 Markdown 文件生成 | ⏳ | P1 | 4h | JSON → Markdown |
| 实现 Markdown 文件解析 | ⏳ | P1 | 4h | Markdown → JSON |
| 实现双向同步逻辑 | ⏳ | P1 | 6h | 时间戳优先策略 |
| 实现冲突检测与提示 | ⏳ | P1 | 3h | 用户选择保留策略 |
| 实现文件监听 (onDidSaveTextDocument) | ⏳ | P1 | 3h | 自动同步 |
| 单元测试 - 同步逻辑 | ⏳ | P1 | 3h | Mock 文件系统 |

---

## 3. 配置管理 (ConfigurationService)

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 定义所有配置项 (package.json) | ⏳ | P0 | 4h | 参考 requirements.md 第9章 |
| 实现配置读取接口 | ⏳ | P0 | 2h | get() 方法 |
| 实现配置变更监听 | ⏳ | P0 | 2h | onDidChangeConfiguration |
| 实现 SecretStorage 管理 (API Key) | ⏳ | P0 | 3h | 安全存储 |
| 实现路径变量解析 (~, ${workspaceFolder}) | ⏳ | P0 | 3h | 支持多种路径格式 |
| 单元测试 - 配置读取 | ⏳ | P0 | 2h | Mock VSCode API |

---

## 4. 首次使用引导 (F11)

### 4.1 OnboardingWizard

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现步骤 1：欢迎页面 | ⏳ | P0 | 3h | QuickPick UI |
| 实现步骤 2：存储路径配置 | ⏳ | P0 | 4h | 预设场景 + 浏览 |
| 实现步骤 3：Git 仓库配置 | ⏳ | P0 | 5h | Git 检测 + 初始化 |
| 实现步骤 4：AI Provider 配置 | ⏳ | P0 | 4h | 下拉选择 + 测试连接 |
| 实现步骤 5：完成页面 | ⏳ | P0 | 2h | 配置摘要 |
| 实现状态保存与恢复 | ⏳ | P0 | 3h | Memento 存储 |
| 实现跳过与默认设置逻辑 | ⏳ | P0 | 2h | 快速路径 |
| 实现"重置向导"命令 | ⏳ | P1 | 1h | promptHub.resetOnboarding |
| 单元测试 - 向导流程 | ⏳ | P0 | 4h | 模拟用户交互 |
| 集成测试 - 完整流程 | ⏳ | P1 | 3h | VSCode Test Host |

---

## 5. 选区创建 Prompt (F1, F13)

### 5.1 SelectionParser（智能识别）

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 `# prompt:` 标记检测 | ⏳ | P0 | 3h | 正则匹配 |
| 实现 emoji 提取逻辑 | ⏳ | P0 | 2h | Unicode emoji 解析 |
| 实现名称提取与预填充 | ⏳ | P0 | 2h | extractEmojiAndName() |
| 实现标记行移除逻辑 | ⏳ | P0 | 1h | 可配置 |
| 实现大小写不敏感匹配 | ⏳ | P0 | 1h | /i 标志 |
| 实现空格容错匹配 | ⏳ | P0 | 1h | \s* |
| 单元测试 - 标记识别 | ⏳ | P0 | 3h | 覆盖所有格式变体 |
| 单元测试 - emoji 提取 | ⏳ | P0 | 2h | Unicode 测试 |

### 5.2 创建命令 (promptHub.createFromSelection)

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现选区读取 | ⏳ | P0 | 1h | activeTextEditor.selection |
| 实现名称输入框 | ⏳ | P0 | 2h | showInputBox + 预填充 |
| 实现 emoji 选择器 | ⏳ | P0 | 3h | QuickPick emoji 列表 |
| 实现标签输入 | ⏳ | P1 | 2h | 多标签支持 |
| 集成 SelectionParser | ⏳ | P0 | 2h | 调用解析逻辑 |
| 实现保存到 StorageService | ⏳ | P0 | 1h | 调用 save() |
| 实现成功/失败提示 | ⏳ | P0 | 1h | showInformationMessage |
| 集成测试 - 完整创建流程 | ⏳ | P0 | 3h | VSCode Test Host |

---

## 6. 活动栏 TreeView (F5)

### 6.1 PromptTreeProvider

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 TreeDataProvider 接口 | ⏳ | P0 | 4h | getChildren(), getTreeItem() |
| 实现标签分组视图 | ⏳ | P0 | 3h | 一级节点为标签 |
| 实现刷新机制 (EventEmitter) | ⏳ | P0 | 2h | 触发视图更新 |
| 实现上下文菜单 | ⏳ | P0 | 3h | 复制/编辑/删除 |
| 实现单击复制功能 | ⏳ | P0 | 2h | env.clipboard.writeText |
| 实现双击编辑功能 | ⏳ | P0 | 2h | 打开编辑器 |
| 实现删除确认对话框 | ⏳ | P0 | 2h | showWarningMessage |
| 实现撤销删除功能 | ⏳ | P1 | 3h | UndoStack + Memento |
| 实现工具栏按钮 | ⏳ | P0 | 2h | 新建/刷新/设置/同步 |
| 单元测试 - TreeProvider | ⏳ | P0 | 3h | Mock VSCode API |

---

## 7. 命令面板搜索 (F2)

### 7.1 PromptPaletteProvider

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 QuickPick 数据源 | ⏳ | P0 | 3h | provideQuickPickItems |
| 实现模糊搜索 (fuse.js) | ⏳ | P0 | 3h | 关键词匹配 |
| 实现最近使用排序 | ⏳ | P0 | 2h | workspaceState 存储 |
| 实现快捷操作 (复制/编辑) | ⏳ | P0 | 2h | QuickPickItem.buttons |
| 单元测试 - 搜索逻辑 | ⏳ | P0 | 2h | Mock 数据 |

---

## 8. 空白 Prompt 模板 (F9)

### 8.1 PromptFileService

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现默认文件名生成 | ⏳ | P0 | 2h | prompt-{timestamp}.md |
| 实现文件名模板解析 | ⏳ | P0 | 3h | {name}, {date}, {emoji} |
| 实现自定义文件名输入 | ⏳ | P0 | 2h | showInputBox |
| 实现 Markdown 文件创建 | ⏳ | P0 | 2h | 写入基础内容 |
| 实现 AI 标题生成集成 | ⏳ | P1 | 2h | 调用 AIService |
| 实现光标定位 | ⏳ | P0 | 1h | 打开编辑器到正文区 |
| 实现保存时同步到 JSON | ⏳ | P0 | 2h | onDidSaveTextDocument |
| 单元测试 - 文件创建 | ⏳ | P0 | 3h | Mock 文件系统 |

---

## 9. AI 辅助功能 (F6, F7)

### 9.1 AIService

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 AI Provider 接口 | ⏳ | P0 | 3h | 策略模式 |
| 实现 OpenAI Provider | ⏳ | P0 | 4h | GPT-4o 调用 |
| 实现 Azure OpenAI Provider | ⏳ | P1 | 3h | Azure 兼容 |
| 实现通义千问 Provider | ⏳ | P2 | 3h | 阿里云 API |
| 实现标题生成 (generateMeta) | ⏳ | P0 | 3h | 返回标题 + emoji |
| 实现内容优化 (optimize) | ⏳ | P0 | 3h | 润色/缩写/扩展 |
| 实现超时与重试机制 | ⏳ | P0 | 3h | 指数退避 |
| 实现进度提示 (Progress API) | ⏳ | P0 | 2h | withProgress |
| 实现取消支持 (CancellationToken) | ⏳ | P1 | 2h | 允许中断 |
| 单元测试 - AI 调用 | ⏳ | P0 | 4h | Mock HTTP |

### 9.2 UsageLogService

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 AIUsageLog 数据模型 | ⏳ | P0 | 1h | interface AIUsageLog |
| 实现日志记录 (record) | ⏳ | P0 | 2h | 写入 JSON |
| 实现查询与过滤 (query) | ⏳ | P0 | 3h | 按日期/模型筛选 |
| 实现 CSV 导出 | ⏳ | P0 | 2h | exportCSV() |
| 实现费用计算 | ⏳ | P1 | 2h | 根据 token 估算 |
| 实现 UI 展示 (Webview) | ⏳ | P1 | 4h | 统计面板 |
| 单元测试 - 日志记录 | ⏳ | P0 | 2h | Mock 数据 |

---

## 10. Git 同步功能 (F10)

### 10.1 GitSyncService

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 Git 仓库检测 | ⏳ | P0 | 2h | rev-parse --is-inside-work-tree |
| 实现 git init 命令 | ⏳ | P0 | 2h | ensureRepo() |
| 实现 git status 命令 | ⏳ | P0 | 2h | status() |
| 实现 git pull 命令 | ⏳ | P0 | 3h | pull() + 冲突检测 |
| 实现 git commit 命令 | ⏳ | P0 | 3h | commit(message) |
| 实现 git push 命令 | ⏳ | P0 | 3h | push() + 失败处理 |
| 实现同步全部 (pull→commit→push) | ⏳ | P0 | 2h | syncAll() |
| 实现状态栏显示 | ⏳ | P0 | 2h | StatusBarItem |
| 实现独立 Output Channel | ⏳ | P0 | 1h | Git Sync 日志 |
| 实现超时与取消机制 | ⏳ | P0 | 2h | maxExecutionTime |
| 实现冲突提示与解决引导 | ⏳ | P1 | 3h | 友好提示 |
| 单元测试 - Git 命令 | ⏳ | P0 | 4h | Mock simple-git |

---

## 11. 快速打开设置 (F12)

### 11.1 SettingsService

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 openSettings 命令 | ⏳ | P0 | 1h | workbench.action.openSettings |
| 实现命令面板入口 | ⏳ | P0 | 1h | 注册命令 |
| 实现 TreeView 工具栏图标 | ⏳ | P0 | 1h | settings-gear icon |
| 实现状态栏警告提示 | ⏳ | P0 | 2h | 配置缺失时显示 |
| 实现右键菜单入口 | ⏳ | P0 | 1h | 上下文菜单 |
| 单元测试 - 设置打开 | ⏳ | P0 | 1h | Mock executeCommand |

---

## 12. 命令注册与架构 (CommandRegistrar)

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 CommandRegistrar 类 | ⏳ | P0 | 3h | 集中注册所有命令 |
| 实现依赖注入容器 | ⏳ | P0 | 3h | 服务层依赖管理 |
| 注册所有核心命令 | ⏳ | P0 | 2h | 参考 requirements.md 第14章 |
| 实现命令参数验证 | ⏳ | P1 | 2h | 类型检查 |
| 单元测试 - 命令注册 | ⏳ | P0 | 2h | Mock 注册逻辑 |

---

## 13. 单元测试与集成测试 (F8)

### 13.1 单元测试

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 编写 PromptStorageService 测试 | ⏳ | P0 | 4h | CRUD + 冲突处理 |
| 编写 SelectionParser 测试 | ⏳ | P0 | 3h | 标记识别 |
| 编写 OnboardingWizard 测试 | ⏳ | P0 | 4h | 流程模拟 |
| 编写 AIService 测试 | ⏳ | P0 | 4h | Mock HTTP |
| 编写 GitSyncService 测试 | ⏳ | P0 | 4h | Mock git 命令 |
| 编写 ConfigurationService 测试 | ⏳ | P0 | 2h | Mock VSCode API |
| 达到 70% 覆盖率目标 | ⏳ | P0 | - | 整体覆盖率 |

### 13.2 集成测试

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 搭建 VSCode Test Host 环境 | ⏳ | P0 | 3h | @vscode/test-electron |
| 编写创建→编辑→删除流程测试 | ⏳ | P0 | 4h | 完整链路 |
| 编写新建模板→保存→同步测试 | ⏳ | P0 | 3h | F9 流程 |
| 编写 Git 同步集成测试 | ⏳ | P1 | 4h | 模拟 Git 仓库 |
| 编写首次引导集成测试 | ⏳ | P0 | 3h | 完整向导流程 |

---

## 14. UI/UX 优化

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 设计插件图标 | ⏳ | P1 | 2h | icon.png |
| 设计 TreeView 图标集 | ⏳ | P1 | 2h | 不同节点类型 |
| 优化通知提示文案 | ⏳ | P1 | 2h | 统一语气 |
| 优化错误提示信息 | ⏳ | P1 | 2h | 提供可操作建议 |
| 实现 Diff 视图 (AI 优化对比) | ⏳ | P1 | 4h | 显示修改前后 |
| 实现 Webview 统计面板 | ⏳ | P2 | 6h | AI 消耗可视化 |

---

## 15. 文档与发布

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 编写 README.md | ⏳ | P0 | 3h | 功能介绍 + 截图 |
| 编写 CHANGELOG.md | ⏳ | P0 | 1h | 版本历史 |
| 录制使用演示视频 | ⏳ | P1 | 4h | GIF 或 MP4 |
| 准备 VSCode Marketplace 素材 | ⏳ | P0 | 2h | 描述 + 截图 + 图标 |
| 配置 VSIX 打包脚本 | ⏳ | P0 | 2h | vsce package |
| 首次发布到 Marketplace | ⏳ | P0 | 2h | 版本 0.1.0 |
| 编写贡献指南 (CONTRIBUTING.md) | ⏳ | P2 | 2h | 开源协作 |

---

## 16. 性能优化

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 优化 TreeView 刷新性能 | ⏳ | P1 | 3h | 虚拟滚动或分页 |
| 优化命令面板搜索性能 | ⏳ | P1 | 2h | 索引预构建 |
| 实现 Prompt 懒加载 | ⏳ | P2 | 3h | 大数据集优化 |
| 实现文件监听防抖 | ⏳ | P1 | 2h | 避免频繁写入 |
| 性能测试 (1000+ Prompt) | ⏳ | P1 | 3h | 压力测试 |

---

## 17. 安全与容错

| 任务 | 状态 | 优先级 | 估计工时 | 备注 |
|------|------|--------|----------|------|
| 实现 API Key 安全存储 | ⏳ | P0 | 已包含在 ConfigurationService | SecretStorage |
| 实现文件写入原子操作 | ⏳ | P0 | 已包含在 PromptStorageService | 临时文件 + 重命名 |
| 实现 Git 凭据不记录日志 | ⏳ | P0 | 1h | 日志脱敏 |
| 实现错误边界与降级 | ⏳ | P1 | 3h | try-catch + fallback |
| 实现输入验证与清理 | ⏳ | P1 | 2h | 防止注入攻击 |

---

## 里程碑与时间线

### Milestone 1：核心功能开发 (预计 4 周)
- ✅ 需求设计完成
- ⏳ 项目初始化
- ⏳ 存储服务 (PromptStorageService)
- ⏳ 配置管理 (ConfigurationService)
- ⏳ 选区创建 Prompt (F1, F13)
- ⏳ TreeView 实现 (F5)

**目标**：实现基础的 Prompt 创建、存储、展示功能

---

### Milestone 2：增强功能开发 (预计 3 周)
- ⏳ 首次使用引导 (F11)
- ⏳ 空白 Prompt 模板 (F9)
- ⏳ AI 辅助功能 (F6, F7)
- ⏳ Git 同步功能 (F10)
- ⏳ 快速打开设置 (F12)

**目标**：完成所有核心功能，达到可发布状态

---

### Milestone 3：测试与优化 (预计 2 周)
- ⏳ 单元测试 (覆盖率 ≥70%)
- ⏳ 集成测试
- ⏳ 性能优化
- ⏳ UI/UX 优化
- ⏳ Bug 修复

**目标**：确保稳定性与用户体验

---

### Milestone 4：发布准备 (预计 1 周)
- ⏳ 文档完善
- ⏳ 演示视频录制
- ⏳ Marketplace 素材准备
- ⏳ 首次发布 (v0.1.0)

**目标**：正式发布到 VSCode Marketplace

---

## 优先级说明

- **P0 (Critical)**：核心功能，必须完成才能发布
- **P1 (High)**：重要功能，显著提升用户体验
- **P2 (Medium)**：增强功能，可在后续版本实现
- **P3 (Low)**：锦上添花，长期规划

---

## 工时统计

| 模块 | 预估总工时 |
|------|-----------|
| 项目初始化与配置 | 12h |
| 核心存储服务 | 30h |
| 配置管理 | 10h |
| 首次使用引导 | 26h |
| 选区创建 Prompt | 20h |
| 活动栏 TreeView | 23h |
| 命令面板搜索 | 12h |
| 空白 Prompt 模板 | 17h |
| AI 辅助功能 | 38h |
| Git 同步功能 | 29h |
| 快速打开设置 | 7h |
| 命令注册与架构 | 12h |
| 单元测试与集成测试 | 38h |
| UI/UX 优化 | 20h |
| 文档与发布 | 16h |
| 性能优化 | 13h |
| 安全与容错 | 6h |
| **总计** | **≈329h (约 8-10 周，单人全职)** |

---

## 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| VSCode API 变更 | 高 | 使用稳定 API，关注变更日志 |
| AI Provider API 不稳定 | 中 | 实现降级策略，提供 Mock |
| Git 命令跨平台兼容性 | 中 | 测试 Windows/macOS/Linux |
| 测试覆盖不足 | 高 | CI 强制覆盖率要求 |
| 用户配置迁移问题 | 中 | 提供 migrate() 钩子 |

---

## 贡献者

| 角色 | 负责人 | 联系方式 |
|------|--------|----------|
| 项目负责人 | - | - |
| 前端开发 | - | - |
| 测试工程师 | - | - |
| 文档编写 | - | - |

---

## 更新日志

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2025-01-10 | v1.0 | 初始任务清单创建 |
| 2025-11-11 | v0.1.0-dev | 完成 Markdown 镜像（保存/导出）、新建 Prompt 文件、TreeView 标签分组与右键菜单、AI 生成/优化、Git 同步、搜索增强（fuse.js）、修复多处中文提示与图标 |

---

## 参考文档

- [requirements.md](./requirements.md) - 功能需求详细说明
- [design.md](./design.md) - 架构设计与实现方案
- [test-plan.md](./test-plan.md) - 测试策略与用例
- [user-guide.md](./user-guide.md) - 用户使用手册
