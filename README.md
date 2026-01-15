# Otter Prompt Desk

> VS Code 插件：统一管理 Prompt（本地存储 + Git 同步 + AI 辅助），并提供 Obsidian 追加、今日日志计时、Markdown 快捷指令等效率工具。

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Nita121388.otter)](https://marketplace.visualstudio.com/items?itemName=Nita121388.otter)
[![VS Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/Nita121388.otter)](https://marketplace.visualstudio.com/items?itemName=Nita121388.otter)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 🚀 3 分钟快速开始

1. 安装扩展：在 VS Code 扩展市场搜索 `Otter`（或用 VSIX：在 VS Code 执行“扩展：从 VSIX 安装...”）。
2. 打开配置向导：`Otter: 配置向导`（命令 ID：`otter.startOnboarding`）。
3. 配置至少 2 项（最小可用）：

```jsonc
{
  // Prompt 存储根目录（prompts.json 与 Markdown 文件都在此目录下）
  "otter.storagePath": "~/.otter",

  // 若要用 Obsidian 写入/追加：填 Vault 根目录
  "otter.obsidian.vaultPath": "E:\\\\Obsidian\\\\Vault",

  // 今日日志目录（相对路径会基于 Vault；留空表示 Vault 根目录）
  "otter.dailyLog.directory": "WorkLog"
}
```

4. 验证功能是否已加载：
   - 左侧 Activity Bar 出现 `Otter` 图标，打开后有两个视图：`Prompts` 与 `今日任务`
   - 在任意 `.md` 输入并回车：`@time 修复 A @start`（应写入今日日志并开始计时）

如果你刚升级/安装后发现“设置项不全/今日任务没显示”，先执行一次 `Developer: Reload Window`（见下方 FAQ）。

## ✨ 核心能力（按场景）

### Prompt 管理

- 选区创建 Prompt：支持识别 `# prompt:` 与 Markdown H1 标题
- 侧边栏管理：浏览/搜索/排序（含使用次数统计）
- Markdown 镜像：JSON 存储 + Markdown 文件同步；支持按标题自动重命名（可在 frontmatter 关闭）
- Git 同步：拉取/同步到远端（可配置自动同步）

### 今日任务（今日日志计时）

- 侧边栏 `今日任务`：展示运行中/已完成任务；支持点击结束、点击已完成任务继续
- 计时精确到秒：结束时在文本中追加 `2h 51m 03s`（不删除原文本）
- 今日日志：可配置日志目录与文件名模板

### Markdown 快捷指令（Enter 触发）

在任意 Markdown 文件中输入 `@...` 指令并回车，可触发组合动作（关键字大小写不敏感）。常用示例：

| 输入示例 | 结果 |
|---|---|
| `@time 自动校准-技术支持 @start` | 写入今日日志并开始计时；若同名任务存在则“续”并开始（可弹窗选择） |
| `@time 自动校准-技术支持 @end` | 结束任务并在该行追加精确到秒的时长（支持 `End/end/over`，可自定义关键字） |
| `@add 修复 X to inbox` / `@+ 修复 X to inbox` | 将文本追加到 Obsidian key 对应的文件 |
| `@file test.md to work` | 在 key 对应的文件夹中新建文件（默认扩展名可配置） |
| `@folder 技术支持 to work` | 在 key 对应的文件夹中新建文件夹 |
| `@summary @today` | AI 总结“今日任务文件/当前草稿”，并附带每项任务跨时长（模板可自定义） |

> `to key` 的 `key` 必须是你已配置过的 key；否则 `to` 会按普通文本处理，避免误伤自然语言。

### Obsidian 写入/追加

- 右键选区：新建到 Obsidian / 追加到 Obsidian 文件
- 结合快捷指令：`@add/@+`、`@file/@folder`、`@new` 等无需右键也可落盘

### 一键备份 / 一键恢复

- 默认备份目录：`storagePath/.otter-backup-*`（也支持执行时选择其它目录）
- 一键恢复支持“完全覆盖 / 合并恢复”两种策略（执行时选择）

## 🧭 命令索引（Command Palette）

常用命令（`Ctrl+Shift+P` 搜索 `Otter:`）：

- `otter.searchPrompt`：搜索 Prompt
- `otter.openStorageFolder`：打开 Prompt 仓库文件夹
- `otter.startOnboarding`：配置向导
- `otter.dailyLog.openTodayLog`：打开今日日志
- `otter.dailyLog.record`：记录到今日日志（并开始/继续）
- `otter.dailyLog.endPick`：结束任务（选择运行中任务）
- `otter.backupNow`：一键备份（快照）
- `otter.restoreFromBackup`：一键恢复（从备份恢复）
- `otter.closeAllPromptEditors`：关闭所有已打开 Prompt（默认仅关闭已保存）

## ⚙️ 配置索引（Settings）

> 建议在设置中用 `@ext:Nita121388.otter` 过滤查看全部配置项。

### 必配/常用

- `otter.storagePath`：Prompt 存储根目录
- `otter.obsidian.vaultPath`：Obsidian Vault 根目录（使用写入/追加功能时需要）
- `otter.dailyLog.directory`：今日日志目录（相对 Vault 或绝对路径，见设置说明）
- `otter.quickCmd.enableOnEnter`：是否启用 Enter 触发快捷指令

### 快捷指令关键字（可自定义）

- `otter.quickCmd.startKeywords`：`@start` 关键字集合
- `otter.quickCmd.endKeywords`：`@end/@End/@over` 等关键字集合（英文按单词边界匹配）
- `otter.quickCmd.addKeywords`：`@add/@+` 等关键字集合
- `otter.quickCmd.newKeywords`、`otter.quickCmd.fileKeywords`、`otter.quickCmd.folderKeywords`
- `otter.quickCmd.summaryKeywords`、`otter.quickCmd.todayKeywords`、`otter.quickCmd.filenameKeywords`

### Obsidian QuickAdd key 映射

```jsonc
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

### 其他常用设置（可选）

- `otter.selection.autoDetectPromptName` / `otter.selection.removePromptMarker`：选区创建 Prompt 的智能识别行为
- `otter.time.format` / `otter.time.autoRenderOnEnter`：`@time/@时间` 的时间格式与 Enter 自动渲染
- `otter.ui.sortBy`：侧边栏排序（如按 `usage`）
- `otter.statusBar.enable`：状态栏入口开关
- `otter.git.enableSync` / `otter.git.remoteUrl`：Git 同步开关与远端地址
- `otter.ai.provider`：AI Provider（远端 Key / 本地 CLI）
- `otter.summary.template`：`@summary` 自定义总结模板

## 🗂️ Prompt 文件格式（frontmatter）

### tags 支持多行列表（Obsidian 写法）

```yaml
---
id: 1767745318604-cm13zos
type: prompt
tags:
  - prompt
aliases:
  - 🧰-Go 修改仅用补丁
---
```

### 关闭单文件自动重命名

```yaml
---
rename: false
---
```

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

## ⚙️ 常用配置示例

### storagePath 写法（支持变量）

- 绝对路径：`D:\\Prompts` / `/Users/me/prompts`
- 用户目录：`~/.otter`
- 工作区变量：`${workspaceFolder}/.prompts`
- 环境变量：`${env:MY_DIR}` / `$MY_DIR` / `%MY_DIR%`（Windows）

### 选区智能识别

```jsonc
{
  "otter.selection.autoDetectPromptName": true,
  "otter.selection.removePromptMarker": true
}
```

### 时间命令（@time/@时间）

```jsonc
{
  "otter.time.format": "YYYY-MM-DD HH:mm:ss",
  "otter.time.autoRenderOnEnter": true
}
```

### 侧边栏排序（按使用次数）

```jsonc
{
  "otter.ui.sortBy": "usage"
}
```

### 自定义今日总结模板（@summary）

`otter.summary.template` 支持多行 Markdown，常用占位符：
- `{date}`：YYYY-MM-DD
- `{draftFile}`：当前草稿文件名
- `{timedTasksTable}`：计时任务表（插件生成，含每项时长）
- `{ai}`：AI 生成内容插入点（建议保留）

### AI 批量参数（可选）

```jsonc
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

## ❓ FAQ（常见问题）

### 1) 安装/升级后“设置项不全”或“今日任务”不显示

这通常是 VS Code 扩展宿主的缓存/视图布局未刷新导致：

1. 执行一次 `Developer: Reload Window`
2. 在 Activity Bar 空白处右键，确认 `Otter` 没有被隐藏
3. 命令面板执行 `Otter: 刷新今日任务`（`otter.dailyLog.refreshTasks`）
4. 若是远程窗口（WSL/SSH/Dev Container），请确认扩展已安装到“远程端”

### 2) VSIX 无法安装/打开了 Visual Studio 的 VSIXInstaller

`Otter` 是 **VS Code 扩展**，不要用 Visual Studio 的 `VSIXInstaller.exe` 安装。请在 VS Code 内使用：

- 扩展视图右上角 `...` → “从 VSIX 安装...”
