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
- 选区智能识别 (# prompt: 标记)
- 新建 Prompt 文件（模板占位符 {timestamp}/{date}/{name}/{emoji}）
- Markdown 镜像（保存导入 + 存储变更导出，ID 注释）
- AI 功能：生成标题/emoji、优化内容（OpenAI 兼容接口，SecretStorage 存储 API Key）
- Git 同步（最小可用：add/commit/pull/push）
- 首次使用引导向导（占位，待完善）

### 待实现
- 标签编辑与管理
- 冲突策略与提示（镜像）
- 单元测试与集成测试

## [0.1.0] - 待发布

### 新增
- 初始版本发布

