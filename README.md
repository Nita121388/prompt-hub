# Prompt Hub

> VSCode 插件，用于统一管理和组织 AI Prompt，支持本地存储、Git 同步、AI 辅助生成

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=your-publisher.prompt-hub)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## ✨ 功能特性

- 📝 **选区创建 Prompt** - 选中文本一键创建 Prompt，支持智能识别 `# prompt:` 标记和标准 Markdown H1 标题
- 🗂️ **活动栏视图** - 侧边栏浏览、搜索、管理所有 Prompt，扁平化右键菜单设计
- 📂 **快速访问仓库** - 一键在系统文件管理器中打开 Prompt 存储文件夹
- 🎨 **Emoji 支持** - 为 Prompt 添加 emoji 图标，快速识别
- 💾 **本地存储** - JSON 格式存储，支持 Markdown 镜像
- 🔄 **Git 同步** - 支持 Git 版本控制和远程备份
- 🤖 **AI 辅助** - 自动生成标题、emoji、优化内容（开发中）
- 🎯 **首次引导** - 友好的配置向导，快速上手
- ⚙️ **高度可配置** - 灵活的配置选项，满足不同需求

## 🚀 快速开始

### 安装

1. 打开 VSCode
2. 搜索扩展市场中的 "Prompt Hub"
3. 点击安装

### 使用

#### 1. 从选区创建 Prompt

**标准方式**：
1. 选中文本
2. 右键选择 "Prompt Hub: 从选区创建"
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

- 点击侧边栏 "Prompt Hub" 图标
- 单击 Prompt 复制内容
- 鼠标悬停显示快速操作按钮（复制、编辑、优化、删除）
- 右键查看更多操作

#### 3. 命令面板搜索

- 按 `Ctrl+Shift+P`（Mac: `Cmd+Shift+P`）
- 输入 "Prompt Hub: 搜索 Prompt"
- 模糊搜索并快速复制

## 📖 文档

详细文档请参阅：
- [用户手册](docs/user-guide.md)
- [需求文档](docs/requirements.md)
- [设计文档](docs/design.md)
- [测试计划](docs/test-plan.md)

## ⚙️ 配置

### 存储路径

```json
{
  "promptHub.storagePath": "~/.prompt-hub"
}
```

支持的路径格式：
- `~/.prompt-hub` - 用户主目录
- `${workspaceFolder}/.prompts` - 项目级别
- `E:/Projects/my-prompts` - 绝对路径

### 选区智能识别

```json
{
  "promptHub.selection.autoDetectPromptName": true,
  "promptHub.selection.removePromptMarker": true
}
```

## 🛠️ 开发

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

## TODO / 待实现
- AI 辅助生成、优化等功能未在当前版本上线，相关按钮、命令、向导步骤不会显示。
- AI 配置项 `promptHub.ai.*` 及 “AI 生成标题/emoji、AI 优化内容” 等命令仍未在 `package.json` 注册，UI 上不可用。
- AI 消耗查看、日志统计目前未实施。
- 首次使用向导目前仅包含存储、Git 配置，AI 配置未能请求。
- Markdown 新建文件文件名询问、文末 AI 自动生成标题等设计项仍未上线。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

[MIT](LICENSE)

## 🙏 致谢

感谢所有贡献者和用户的支持！
