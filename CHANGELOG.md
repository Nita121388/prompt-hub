# 更新日志

所有重要的项目更改都将记录在此文件中。
格式基于 Keep a Changelog，并且本项目遵循语义化版本。

## [未发布]

### 新增
- 项目初始化和基础架构搭建
- 核心存储服务 (PromptStorageService)
- 配置管理服务 (ConfigurationService)
- 从选区创建 Prompt 功能
- 活动栏 TreeView 展示（支持标签分组、右键快捷操作）
- 命令面板搜索（fuse.js 模糊搜索）
- 选区智能识别 (# prompt: 标记和标准 Markdown H1 标题)
- 新建 Prompt 文件（模板占位符 {timestamp}/{date}/{name}/{emoji}）
- Markdown 镜像（保存导入 + 存储变更导出，ID 注释）
- AI 功能：生成标题/emoji、优化内容（OpenAI 兼容接口，SecretStorage 存储 API Key）
- Git 同步（最小可用：add/commit/pull/push）
- 首次使用引导向导（占位，待完善）
- TreeView 工具栏新增"打开 Prompt 仓库文件夹"按钮（📂 图标）
- TreeView 每行后添加快速操作按钮（鼠标悬停显示）：
  - 📋 复制内容 ($(copy))
  - ✏️ 编辑 Prompt ($(edit))
  - ✨ AI 优化 ($(sparkle))
  - 🗑️ 删除 ($(trash))
- 新增编辑 Prompt 命令，可直接打开源文件进行编辑

### 改进
- 选区解析器现在支持标准 Markdown H1 标题（如 `# Test3`）作为 Prompt 名称
- 优先匹配 `# prompt:` 标记，回退到标准 Markdown H1 标题
- 两种格式均支持 emoji 提取
- 右键菜单扁平化：移除"AI & 更多"子菜单，所有操作直接显示在顶层
- 菜单项按功能分组显示（基础操作 / AI 功能 / 危险操作）
- TreeView inline 按钮提供快速访问常用操作，无需打开右键菜单
- 编辑 Prompt 功能支持直接打开关联的 Markdown 源文件

### 待实现
- 标签编辑与管理
- 冲突策略与提示（镜像）
- 单元测试与集成测试

## [0.1.0] - 待发布

### 新增
- 初始版本发布

