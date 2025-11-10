# VSCode Prompt 管理插件 - 用户手册

## 1. 安装与初始化

### 1.1 安装插件
1. 打开 VSCode → 扩展市场搜索"Prompt Hub"（暂定名）→ 安装。
2. 安装完成后，插件会自动激活。

### 1.2 首次使用引导
首次安装后，插件会在 1 秒后自动启动配置向导，帮助您快速完成初始化设置：

**步骤 1：欢迎页面**
- 选择"开始配置"进入详细配置流程
- 选择"使用默认设置"快速完成，使用推荐配置
- 选择"稍后提醒"跳过向导，下次启动时继续提示

**步骤 2：存储路径配置**
- **本地存储**（推荐）：使用默认路径 `~/.prompt-hub/prompts.json`
- **云盘同步**：选择 OneDrive/坚果云等同步目录，实现跨设备同步
- **项目级别**：使用工作区路径 `${workspaceFolder}/.prompts/`，适合团队协作
- 支持浏览文件夹自定义路径

**步骤 3：Git 仓库配置**
- 自动检测选择的存储路径是否已是 Git 仓库
- 如已检测到仓库，显示"已检测到 Git 仓库"并配置远程 URL
- 如未检测到，提供"初始化 Git 仓库"选项
- 可选择"稍后配置"跳过 Git 设置

**步骤 4：AI Provider 配置**
- 选择 AI 提供商：OpenAI、Azure OpenAI、通义千问、自定义
- 输入 API Key（安全存储在 VSCode SecretStorage）
- 配置 Base URL、模型名称
- 点击"测试连接"验证配置是否正确

**步骤 5：完成**
- 显示配置摘要
- 提供快速开始指南
- 点击"完成"保存所有配置

**提示**：
- 向导可随时通过命令"Prompt Hub: 重新开始引导"重新启动
- 中途取消会保留已配置的部分，下次启动继续提示
- 所有配置都可以稍后在设置中修改

## 2. 快速上手

### 2.1 从选区创建 Prompt

**标准方式**：
1. 在 Markdown/代码文件中选中文本
2. 右键选择"Prompt → 创建为新 Prompt"
3. 填写名称、emoji、标签
4. （可选）勾选"使用 AI 生成"自动生成标题和 emoji
5. 点击保存

**智能识别方式**（推荐）：
如果您希望在选区中预定义 Prompt 名称，可以在选中文本的第一行添加标记：

```markdown
# prompt: 🖨️ 这里是您的 Prompt 名称
这里是 Prompt 的具体内容
可以有多行...
```

创建时插件会自动：
- 提取名称"这里是您的 Prompt 名称"并预填充
- 提取 emoji 🖨️ 并预填充
- 移除标记行，仅保留正文内容

**标记格式说明**：
- 支持模糊匹配：`# PROMPT:`、`# Prompt:`、`#prompt:` 均可识别
- 忽略多余空格：`#  prompt  :` 也能正确识别
- emoji 可选：`# prompt: 名称` 或 `# prompt: 😊 名称` 都可以

**配置选项**：
- `promptHub.selection.autoDetectPromptName`：启用/禁用智能识别（默认启用）
- `promptHub.selection.removePromptMarker`：是否移除标记行（默认移除）

### 2.2 命令面板管理
按 `Ctrl+Shift+P`（Mac: `Cmd+Shift+P`）输入"Prompt"即可看到所有可用命令：
- **复制 Prompt**：快速复制到剪贴板
- **编辑 Prompt**：打开编辑器修改
- **删除 Prompt**：删除选中的 Prompt（需确认）
- **AI 优化**：使用 AI 优化内容
- **查看 AI 消耗**：查看 AI 调用统计

命令面板支持模糊搜索，输入关键词即可快速筛选。

### 2.3 活动栏视图
点击左侧活动栏的"Prompt Hub"图标浏览所有 Prompt：
- **单击**：复制到剪贴板
- **双击**：打开编辑器
- **右键菜单**：
  - 复制
  - 编辑
  - 删除（需确认）
  - AI 优化
  - 打开设置
  - 查看日志

**TreeView 工具栏**：
- **新建 Prompt**：创建空白 Prompt 文件
- **刷新**：重新加载列表
- **设置图标**：快速打开插件设置
- **同步图标**（如启用 Git）：执行 Git 同步

### 2.4 空白 Prompt 模板
执行命令"Prompt: 新建 Prompt 文件"：
1. 系统提供默认文件名（如 `prompt-20250110-143022.md`）
2. 可自定义文件名或直接回车使用默认名
3. 文件创建后自动打开编辑器
4. 如启用"自动生成标题"，文末会插入 AI 生成的 `## {emoji}{标题}`
5. 光标自动定位到正文区域，方便开始撰写
6. 保存后自动同步到 JSON 存储

**文件名模板**：
可在设置中配置 `promptHub.markdown.filenameTemplate`，支持占位符：
- `{name}`：Prompt 名称
- `{timestamp}`：时间戳
- `{date}`：日期（YYYYMMDD）
- `{emoji}`：emoji 字符

示例：`{date}-{name}.md` → `20250110-我的提示.md`

## 3. AI 辅助功能

### 3.1 自动生成标题/emoji
在创建或编辑 Prompt 时：
1. 勾选"由 AI 生成元信息"
2. 插件会调用配置的 AI 模型分析内容
3. 返回推荐的标题和 emoji
4. 您可以接受推荐或手动修改

**失败处理**：
- 如网络或 API Key 错误，会显示失败提示
- 原有内容保持不变，可手动填写
- 失败信息记录在 Output Channel

### 3.2 内容优化
选中 Prompt 后触发"AI 优化"：
1. 选择优化意图：
   - 润色：改进表达和语法
   - 缩写：精简内容
   - 扩展：增加细节和示例
   - 翻译：转换语言
2. AI 返回优化后的内容
3. 查看差异对比（Diff 视图）
4. 点击"接受"应用更改，或"保留原文"取消

**UsageLog 记录**：
每次 AI 调用都会记录：
- tokens 消耗（输入/输出）
- 预估费用
- 调用耗时
- 成功/失败状态

### 3.3 查看 AI 消耗
执行命令"Prompt: 查看 AI 消耗"：
- 显示所有 AI 调用记录
- 支持按日期、模型筛选
- 显示总计 tokens 和费用
- 可导出为 CSV 文件进行分析

## 4. 配置与同步

### 4.1 快速打开设置
插件提供多种方式快速访问设置：

**方式 1：命令面板**
- 按 `Ctrl+Shift+P`
- 输入"Prompt Hub: 打开设置"
- 回车打开设置页面

**方式 2：TreeView 工具栏**
- 点击活动栏 TreeView 顶部的设置图标（齿轮）
- 自动打开并筛选到 `@ext:publisher.prompt-hub`

**方式 3：状态栏警告**
- 当配置有问题时（如 Git 未配置、API Key 缺失）
- 状态栏会显示可点击的警告图标
- 点击后直接定位到相关配置项

**方式 4：右键菜单**
- 在 TreeView 中右键任意 Prompt
- 选择"打开设置"

### 4.2 关键配置项

**存储配置**：
- `promptHub.storagePath`：JSON 存储路径（支持 `~`、`${workspaceFolder}` 等变量）
- `promptHub.storage.autoCreate`：自动创建不存在的目录
- `promptHub.storage.autoBackup`：定期自动备份

**Markdown 镜像**：
- `promptHub.markdown.enableMirror`：为每个 Prompt 生成 Markdown 文件
- `promptHub.markdown.mirrorDirectory`：镜像文件目录
- `promptHub.markdown.filenameTemplate`：文件名模板
- `promptHub.markdown.askForFilename`：创建时询问文件名

**Git 同步**：
- `promptHub.git.enableSync`：启用 Git 同步功能
- `promptHub.git.autoPullOnStartup`：启动时自动 pull
- `promptHub.git.commitMessageTemplate`：提交信息模板
- `promptHub.git.autoCommit`：自动提交更改

**AI Provider**：
- `promptHub.ai.provider`：选择 AI 提供商（openai/azure/custom）
- `promptHub.ai.model`：模型名称
- `promptHub.ai.baseUrl`：API 基础 URL
- `promptHub.ai.temperature`：生成温度（0-2）
- `promptHub.ai.maxTokens`：最大 token 数

**选区识别**：
- `promptHub.selection.autoDetectPromptName`：自动识别 `# prompt:` 标记
- `promptHub.selection.removePromptMarker`：移除标记行

**UI 交互**：
- `promptHub.ui.showEmojiPicker`：显示 emoji 选择器
- `promptHub.ui.defaultView`：默认视图（tree/list）
- `promptHub.ui.sortBy`：排序方式（name/date/usage）

### 4.3 多项目共享
如需在多个项目间共享 Prompt：
1. 将所有项目的 `promptHub.storagePath` 设置为同一路径
2. 建议使用绝对路径或 `~` 开头的用户目录路径
3. 如使用云盘，请避免多台电脑同时写入

## 5. Git 同步

### 5.1 初始化 Git 仓库
如存储目录尚未初始化为 Git 仓库：
1. 执行命令"Prompt Hub: 初始化 Git 仓库"
2. 配置远程仓库 URL（可选）
3. 插件会自动执行 `git init` 和 `git remote add origin`

### 5.2 同步到远程
执行命令"Prompt Hub: 同步到 GitHub"：
1. 插件先执行 `git pull` 拉取远程更改
2. 如有冲突，提示手动解决
3. 输入提交信息（或使用默认模板）
4. 执行 `git commit` 和 `git push`
5. 在 Output Channel 查看同步日志

**自动同步**：
- 启用 `promptHub.git.autoCommit` 后，每次保存 Prompt 自动提交
- 启用 `promptHub.git.autoPullOnStartup` 后，启动时自动 pull

### 5.3 查看同步状态
- 状态栏显示 Git 同步状态（同步中/成功/失败）
- TreeView 工具栏显示同步图标
- Output Channel - Prompt Hub Git Sync 记录详细日志

## 6. Markdown 镜像与手动编辑

### 6.1 启用 Markdown 镜像
1. 打开设置，启用 `promptHub.markdown.enableMirror`
2. 配置镜像目录 `promptHub.markdown.mirrorDirectory`
3. 配置文件名模板 `promptHub.markdown.filenameTemplate`
4. 每次保存 Prompt 时，插件会自动生成对应的 Markdown 文件

### 6.2 手动编辑 Markdown
1. 直接在 VSCode 中打开 Markdown 镜像文件
2. 编辑正文内容
3. 保存文件（`Ctrl+S`）
4. 插件会自动解析 Markdown 并更新 JSON 存储

**同步规则**：
- 如 JSON 和 Markdown 同时被修改，以较新时间戳为准
- 插件会提示用户选择保留哪个版本或合并

### 6.3 导入已有 Markdown
执行命令"Prompt: 导入 Markdown"：
1. 选择单个文件或整个目录
2. 插件解析 front-matter 和标题
3. 自动生成 Prompt 记录并写入 JSON
4. 显示导入结果统计

## 7. 常见问题

### 7.1 无法写入存储文件
**问题**：提示"无法写入 prompts.json"
**解决方案**：
- 检查路径权限，确保 VSCode 有写入权限
- 如存储在同步盘，确认无其他进程锁定文件
- 尝试手动创建目录或更换存储路径

### 7.2 AI 调用无响应
**问题**：AI 生成或优化功能无响应
**解决方案**：
- 确认 API Key 配置正确（执行"Prompt: 配置 AI Key"）
- 检查网络连接，确保可访问 API 端点
- 在 Output Channel - Prompt Hub 查看详细错误日志
- 尝试"测试连接"功能验证配置

### 7.3 自动标题生成失败
**问题**：空白 Prompt 创建时标题为"## 新 Prompt"
**解决方案**：
- 这是正常的 fallback 行为，AI 不可用时使用默认标题
- 检查 AI 配置是否正确
- 可手动修改标题
- 确保选择的模型支持中文理解

### 7.4 删除误操作恢复
**问题**：不小心删除了重要的 Prompt
**解决方案**：
- 在删除后 30 秒内执行"Prompt: 撤销最近删除"
- 如超过时间，检查自动备份文件
- 如启用 Git，可从历史提交恢复

### 7.5 JSON 与 Markdown 冲突
**问题**：提示"JSON 与 Markdown 内容冲突"
**解决方案**：
- 说明两处同时被修改
- 在弹窗中选择：
  - "保留 JSON"：使用 JSON 内容覆盖 Markdown
  - "保留 Markdown"：使用 Markdown 内容覆盖 JSON
  - "手动合并"：打开 Diff 视图手动选择

### 7.6 Git 同步失败
**问题**：push 或 pull 失败
**解决方案**：
- 检查网络连接
- 确认远程仓库 URL 正确
- 检查是否有未解决的冲突
- 在 Output Channel - Prompt Hub Git Sync 查看详细错误
- 尝试手动执行 `git pull` 或 `git push` 排查问题

### 7.7 首次引导无法完成
**问题**：向导卡在某一步无法继续
**解决方案**：
- 点击"跳过"使用默认配置
- 关闭向导，手动在设置中配置
- 执行"Prompt Hub: 重置引导"重新开始
- 已配置的步骤会被保留，无需担心数据丢失

## 8. 快捷键与命令

### 8.1 默认快捷键
- `F1`：打开命令面板
- `F2`：编辑选中的 Prompt（在 TreeView 中）
- `F5`：刷新 TreeView
- `Delete`：删除选中的 Prompt（在 TreeView 中）

### 8.2 完整命令列表
- `Prompt Hub: 创建 Prompt`
- `Prompt Hub: 复制 Prompt`
- `Prompt Hub: 编辑 Prompt`
- `Prompt Hub: 删除 Prompt`
- `Prompt Hub: 撤销最近删除`
- `Prompt Hub: 新建 Prompt 文件`
- `Prompt Hub: AI 生成元信息`
- `Prompt Hub: AI 优化内容`
- `Prompt Hub: 查看 AI 消耗`
- `Prompt Hub: 导出 AI 消耗报表`
- `Prompt Hub: 导入 Markdown`
- `Prompt Hub: 导出 Markdown`
- `Prompt Hub: 初始化 Git 仓库`
- `Prompt Hub: 同步到 GitHub`
- `Prompt Hub: 拉取远程更改`
- `Prompt Hub: 提交并推送`
- `Prompt Hub: 查看 Git 日志`
- `Prompt Hub: 打开设置`
- `Prompt Hub: 开始引导`
- `Prompt Hub: 重置引导`
- `Prompt Hub: 配置 AI Key`

## 9. 开发者附录

### 9.1 运行测试
```bash
npm install
npm test
```

### 9.2 打包 VSIX
```bash
npm run package
```

### 9.3 调试
1. 在 VSCode 中打开项目
2. 按 `F5` 启动 Extension Development Host
3. 在 Output Channel - Prompt Hub 查看日志
4. 使用断点调试代码

### 9.4 贡献指南
- 提交 Issue：[GitHub Issues](https://github.com/your-repo/prompt-hub/issues)
- 贡献代码：Fork → Branch → Commit → Pull Request
- 遵循代码风格和测试覆盖率要求

## 10. 更新日志
查看完整更新日志：[CHANGELOG.md](../CHANGELOG.md)
