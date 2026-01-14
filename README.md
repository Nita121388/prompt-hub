# Otter

> VSCode 插件，用于统一管理和组织 AI Prompt，支持本地存储、Git 同步、AI 辅助生成（开发测试中）

[![Version](https://img.shields.io/badge/version-0.1.17-blue.svg)](https://marketplace.visualstudio.com/items?itemName=Nita121388.otter)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## ✨ 功能特性

- 📝 **选区创建 Prompt** - 选中文本一键创建 Prompt，支持智能识别 `# prompt:` 标记和标准 Markdown H1 标题
- 🗂️ **活动栏视图** - 侧边栏浏览、搜索、管理所有 Prompt，扁平化右键菜单设计
- 📂 **快速访问仓库** - 一键在系统文件管理器中打开 Prompt 存储文件夹
- 🔗 **一键打开远程仓库** - 从存储目录自动解析 GitHub 远程地址并在浏览器打开
- 📈 **使用次数统计** - “复制到剪贴板”计为一次使用，可按使用次数排序
- 🎨 **Emoji 支持** - 为 Prompt 添加 emoji 图标，快速识别
- 💾 **本地存储** - JSON 格式存储，支持 Markdown 镜像
- 📝 **Markdown 自动重命名** - 保存时默认按标题自动重命名（可在 frontmatter 用 `rename: false` 关闭单文件重命名）
- 🕒 **时间命令** - `@time/@时间` 支持引用块命令与行内替换，按 Enter 自动渲染为时间文本
- 🧩 **Obsidian 写入** - 选中文本右键：新建到 Obsidian / 追加到 Obsidian 文件（需要配置 Vault 路径）
- 🔄 **Git 同步** - 支持 Git 版本控制和远程备份
- 🤖 **AI 辅助** - 自动生成标题、emoji、优化内容（需要先配置 `otter.ai.provider`，并按提供商要求配置 Key 或本地 CLI）
- 🎯 **首次引导** - 友好的配置向导，快速上手
- ⚙️ **高度可配置** - 灵活的配置选项，满足不同需求

## 🚀 快速开始

### 安装

1. 打开 VSCode
2. 搜索扩展市场中的 "Otter"
3. 点击安装

### 使用

#### 1. 从选区创建 Prompt

**标准方式**：
1. 选中文本
2. 右键选择 "Otter: 从选区创建"
3. 输入名称、emoji、标签
4. 保存

**智能识别方式**（推荐）：

在选中文本的第一行添加标记：

```markdown
# prompt: 🖨️ 代码审查清单
在审查代码时，请检查以下方面：
1. 代码质量
2. 安全性
3. 性能
```

或使用标准 Markdown H1 标题：

```markdown
# 🖨️ 代码审查清单
在审查代码时，请检查以下方面：
1. 代码质量
2. 安全性
3. 性能
```

创建时会自动：
- 提取名称 "代码审查清单"
- 提取 emoji 🖨️
- 移除标记行

#### 2. 活动栏管理

- 点击侧边栏 "Otter" 图标
- 单击 Prompt 复制内容（会计入使用次数）
- 双击 Prompt 仅打开文件（不复制、不计次数）
- 鼠标悬停显示快速操作按钮（复制、编辑、优化、删除）
- 右键查看更多操作

#### 3. 命令面板搜索

- 按 `Ctrl+Shift+P`（Mac: `Cmd+Shift+P`）
- 输入 "Otter: 搜索 Prompt"
- 模糊搜索并快速复制

#### 4. 时间命令（按 Enter 自动渲染）

在 Markdown 里输入 `@time/@时间`，回车换行时会自动替换为当前时间（支持大小写与空格容错）。

```markdown
# @time 我的内容XXXX
> @time format=HH:mm TODO
```

#### 5. 选区写入 Obsidian

选中一段文本后右键：
- “Otter: 创建到 Obsidian（选择文件夹）”
- “Otter: 添加到 Obsidian 文件（选择文件）”

## 📖 文档

详细文档请参阅：
- [文档索引](docs/README.md)
- [用户手册](docs/user-guide.md)
- [本地 AI 集成指南](docs/local-ai-integration.md)
- [需求文档](docs/requirements.md)
- [设计文档](docs/design.md)
- [路线图与进度](docs/roadmap.md)
- [测试计划](docs/test-plan.md)
- [测试用例](docs/test-cases.md)

## ⚙️ 配置

### 存储路径

```json
{
  "otter.storagePath": "~/.otter"
}
```

支持的路径格式：
- `~/.otter` - 用户主目录
- `${workspaceFolder}/.prompts` - 项目级别
- `E:/Projects/my-prompts` - 绝对路径

### 选区智能识别

```json
{
  "otter.selection.autoDetectPromptName": true,
  "otter.selection.removePromptMarker": true
}
```

### 时间命令

```json
{
  "otter.time.format": "YYYY-MM-DD HH:mm",
  "otter.time.autoRenderOnEnter": true
}
```

### 使用次数排序

```json
{
  "otter.ui.sortBy": "usage"
}
```

### Obsidian

```json
{
  "otter.obsidian.vaultPath": "E:\\\\File\\\\NitaFile\\\\Obsidian\\\\Obsidian"
}
```

### Markdown 快捷指令（@start/@end/@file/@folder/@add/@new）

先配置 key 映射（示例）：

```json
{
  "otter.obsidian.quickAdd.folders": {
    "work": "Work",
    "proj": "Projects"
  },
  "otter.obsidian.quickAdd.files": {
    "inbox": "Inbox.md"
  },
  "otter.obsidian.quickAdd.defaultNewKey": "work",
  "otter.obsidian.quickAdd.defaultKey": "inbox"
}
```

用法示例（在任意 `.md` 输入后按 Enter）：
- `@time 自动校准-技术支持 @start`：开始/继续并记录到今日日志（会弹窗处理同名任务）
- `@time 自动校准-技术支持 @end`：结束任务并在当前行追加精确到秒的时长
- `@file README to proj`：在 `proj` 映射的文件夹中新建 `README.md`（若文件已存在会弹窗必选处理方式）
- `@folder 技术支持 to work`：在 `work` 映射的文件夹中新建目录
- `@time 修复X @add to inbox` 或 `@time 修复X @+ to inbox`：将文本追加到 key 对应的文件
- `@summary @today`：AI 总结“当前草稿文件”并写回当前文件，同时附带今日日志计时任务清单（含每项时长）
- `@summary @today @filename work`：将总结写入到 `work` key 对应的文件（或写入相对 Vault 的 `work.md`，取决于你的配置）

提示：为了避免误伤自然语言，`to` 只有在后面跟的是你已配置过的 key 时才会被识别为目标参数；`@to` 也可用。

#### 自定义今日总结模板

可通过 `otter.summary.template` 自定义总结模板（Markdown，多行）。占位符：
- `{date}`：YYYY-MM-DD
- `{draftFile}`：当前草稿文件名
- `{timedTasksTable}`：计时任务表（插件生成，含每项时长）
- `{ai}`：AI 生成内容插入点（建议保留）

### AI 批量（本地 CLI 合并调用）

```json
{
  "otter.ai.provider": "local-codex",
  "otter.ai.batchDelayMs": 500,
  "otter.ai.batchChunkSize": 10,
  "otter.ai.batchItemPreviewChars": 600,
  "otter.ai.batchMaxPromptChars": 7000
}
```

## 🛠️ 开发

### 开发测试说明（给参与测试的同学）

- 当前版本处于开发/回归测试阶段，功能、命令与配置项可能会调整（尤其是 AI 相关能力）。
- 建议使用 Extension Development Host（按 `F5`）或独立的 VSCode Profile/测试环境进行验证，避免影响日常工作环境。
- 涉及 Git 导入/同步时请使用专门的测试仓库（或 fork），避免误提交到生产仓库；建议操作前备份存储目录。
- AI 调用可能产生费用：可先在无 Key 情况下回归“提示/回退”类用例，或优先使用本地 Provider（`local-claude` / `local-codex`）验证流程。
- 手工回归用例：`docs/test-cases.md`；批量生成功能专项：`完整测试指南.md`；本地 AI 调试日志：`docs/DEBUG_LOGGING_SUMMARY.md`。
- 反馈问题时建议附上：复现步骤、VSCode 版本/OS、相关设置片段，以及 Output 面板 `Otter` 日志（必要时开启 `otter.git.debugLog`）。

### 环境要求

- Node.js 18+
- VSCode 1.85+

### 本地开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听模式
npm run watch

# 运行测试
npm test

# 打包
npm run package
```

### 调试

按 `F5` 启动 Extension Development Host

## 备份与恢复

### 一键备份

- 命令：`Otter: 一键备份（快照）`（命令 ID：`otter.backupNow`）
- 默认会在 `storagePath` 下创建备份目录：`.otter-backup-YYYYMMDD-HHMMSS`
- 也可以在执行时选择将备份落到其它目录（仍会创建独立的 `.otter-backup-*` 子目录）
- 备份会包含 `storagePath` 下的所有文件与子目录（会跳过已有的 `.otter-backup-*`，避免递归备份）

### 一键恢复

- 命令：`Otter: 一键恢复（从备份恢复）`（命令 ID：`otter.restoreFromBackup`）
- 支持两种策略（执行时选择）：
  - 完全覆盖：回滚到备份时状态（会清空当前 `storagePath`，但会保留旧备份目录）
  - 合并恢复：仅补齐缺失文件，`prompts.json` 按 `id` 补齐缺失 Prompt（不覆盖现有文件）

### 一键关闭 Prompt 文件

- 命令：`Otter: 关闭所有已打开 Prompt`（命令 ID：`otter.closeAllPromptEditors`）
- 默认仅关闭已保存的 Prompt 文件，未保存的会跳过（避免误丢失编辑内容）

## 今日任务（今日日志计时）

- 打开今日日志：`Otter: 打开今日日志`（命令 ID：`otter.dailyLog.openTodayLog`）
- 记录到今日日志：`Otter: 记录到今日日志`（命令 ID：`otter.dailyLog.record`）
  - 无选区：输入任务名后开始计时
  - 有选区：默认用选区首行作为任务名并开始计时；若选区包含“结束/end/over”等关键字则尝试结束任务
- 任意 Markdown：输入 `@结束 xxx` / `@end xxx` / `@over xxx` 后按 Enter，会自动结束任务并在该行补充时长（精确到秒）
- 侧边栏视图“今日任务”：点击运行中任务直接结束；点击已完成任务会提示是否继续任务

## TODO / 待实现
- AI 消耗查看、日志统计目前未实施。
- 首次使用向导的 AI 配置步骤仍在完善中。
- Markdown 新建文件文件名询问、文末 AI 自动生成标题等设计项仍未上线。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

[MIT](LICENSE)

## 🙏 致谢

感谢所有贡献者和用户的支持！
