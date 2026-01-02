# 本地 AI 集成指南

## 概述

Prompt Hub 现已支持调用本地安装的 **Claude Code** 和 **Codex**，您可以无需配置 API Key 即可使用强大的 AI 功能。

## 支持的本地 AI 工具

### 1. Claude Code CLI（推荐）
- **优点**：功能强大，模型新颖（Claude Sonnet 4.5）
- **安装位置**：通常在 `~/.claude` 或 `C:\Users\<username>\.claude`
- **自动检测**：Prompt Hub 会自动检测常见安装路径
- **无需 API Key**：直接使用本地 Claude Code 的认证

### 2. Codex
- **优点**：专为代码任务优化
- **安装位置**：通常在 `~/.codex` 或 `C:\Users\<username>\.codex`
- **自动检测**：Prompt Hub 会自动检测常见安装路径
- **无需 API Key**：直接使用本地 Codex 的认证

## 快速开始

### 方式一：使用配置向导（推荐）

1. **首次打开 Prompt Hub 时**
   - 会自动弹出配置向导
   - 在 AI 提供商步骤中，选择「💻 本地 Claude Code（推荐）」或「⚡ 本地 Codex」

2. **或手动启动向导**
   ```
   Ctrl+Shift+P → Prompt Hub: 配置向导
   ```

3. **工具会自动检测**
   - 如果检测成功，会显示确认消息
   - 如果检测失败，您可以在设置中手动配置路径

### 方式二：手动配置

打开 VSCode 设置（`Ctrl+,`），搜索 `promptHub.ai.provider`，选择相应的选项：

```json
{
  "promptHub.ai.provider": "local-claude"
}
```

或

```json
{
  "promptHub.ai.provider": "local-codex"
}
```

## 配置项详解

### 基础配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `promptHub.ai.provider` | AI 提供商 | （未配置） |
| `promptHub.ai.model` | 模型名称 | `claude-sonnet-4.5` |

### 本地 AI 专用配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `promptHub.local.claudePath` | Claude Code CLI 路径（留空自动检测） | （空） |
| `promptHub.local.codexPath` | Codex 可执行文件路径（留空自动检测） | （空） |
| `promptHub.local.codexModel` | Codex 使用的模型名称 | `claude-sonnet-4.5` |

## 自动检测路径

### Claude Code 自动检测路径

**Windows：**
- `C:\Users\<username>\.claude\claude.exe`
- `C:\Users\<username>\.claude\bin\claude.exe`
- `C:\Program Files\Claude Code\claude.exe`

**macOS/Linux：**
- `~/.claude/claude`
- `~/.claude/bin/claude`
- `/usr/local/bin/claude`
- `/opt/claude/claude`

### Codex 自动检测路径

**Windows：**
- `C:\Users\<username>\.codex\codex.exe`
- `C:\Users\<username>\.codex\bin\codex.exe`
- `C:\Tools\codex\codex.exe`
- `C:\Program Files\Codex\codex.exe`

**macOS/Linux：**
- `~/.codex/codex`
- `~/.codex/bin/codex`
- `/usr/local/bin/codex`
- `/opt/codex/codex`

## 手动配置路径

如果自动检测失败，您可以手动配置工具路径。

### 在 settings.json 中配置

```json
{
  "promptHub.local.claudePath": "C:\\Users\\break\\.claude\\claude.exe",
  "promptHub.local.codexPath": "C:\\Users\\break\\.codex\\codex.exe"
}
```

### 支持的路径格式

- ✅ 绝对路径：`C:\Users\break\.claude\claude.exe`
- ✅ 用户目录：`~/.claude/claude`
- ✅ 环境变量：`${USERPROFILE}/.claude/claude.exe`（Windows）

## 使用本地 AI 的功能

### 生成 Prompt 标题和 Emoji

1. 创建新 Prompt 时
2. 点击「AI 生成标题」按钮
3. Prompt Hub 会调用本地 Claude Code 或 Codex 生成标题和 emoji

### 优化 Prompt 内容

1. 在 TreeView 中右键点击 Prompt
2. 选择「✨ AI 优化」
3. 使用本地工具优化内容

### 批量生成标题

1. 选中多个 Prompt
2. 使用「批量生成标题和图标」命令
3. 本地工具会逐个处理

## 故障排查

### 问题 1：错误 "未找到 Claude Code CLI"

**原因**：
- Claude Code 未安装
- 安装路径不在常见位置

**解决方案**：
1. 确认已安装 Claude Code
2. 手动配置路径：`promptHub.local.claudePath`
3. 使用完整路径，例如：`C:\Users\break\.claude\claude.exe`

### 问题 2：错误 "未找到 Codex CLI"

**原因**：
- Codex 未安装
- 安装路径不在常见位置

**解决方案**：
1. 确认已安装 Codex
2. 手动配置路径：`promptHub.local.codexPath`
3. 使用完整路径，例如：`C:\Users\break\.codex\codex.exe`

### 问题 3：调用超时

**原因**：
- 本地工具响应慢
- 网络或系统资源不足

**解决方案**：
1. 等待几秒钟重试
2. 检查系统资源使用情况
3. 考虑切换到云端 API（OpenAI、Azure 等）

### 问题 4：生成结果不符合预期

**原因**：
- 提示词内容过复杂
- 本地工具版本较旧

**解决方案**：
1. 简化输入内容
2. 升级本地工具到最新版本
3. 调整模型设置：`promptHub.local.codexModel`

## 性能提示

### 本地 AI vs 云端 API

| 维度 | 本地 Claude Code / Codex | 云端 API（OpenAI 等） |
|------|------------------------|-----------------------|
| 响应速度 | 取决于硬件 | 通常 1-5 秒 |
| API Key | 无需 | 必需 |
| 隐私性 | 最高（完全本地） | 数据上传服务器 |
| 功能完整性 | 完整 | 完整 |
| 成本 | 一次性安装 | 按调用计费 |

### 优化建议

1. **使用本地 AI 的场景**
   - 频繁生成大量 Prompt
   - 对隐私有严格要求
   - 已安装本地工具

2. **使用云端 API 的场景**
   - 需要最新的模型能力
   - 本地硬件资源有限
   - 需要与团队云端配置同步

## 相关命令

| 命令 | 说明 |
|------|------|
| `Prompt Hub: 配置向导` | 启动配置向导 |
| `Prompt Hub: 打开设置` | 快速打开插件设置 |
| `Prompt Hub: AI 生成标题` | 为当前 Prompt 生成标题 |
| `Prompt Hub: AI 优化内容` | 优化当前 Prompt 内容 |

## 更多帮助

- **VSCode 命令面板**：`Ctrl+Shift+P` 搜索相关命令
- **插件设置**：`Ctrl+,` 搜索 `promptHub`
- **问题反馈**：在 GitHub Issues 中提交反馈

---

祝您使用愉快！🚀
