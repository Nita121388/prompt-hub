# VSCode Prompt 管理插件 - 测试方案

## 1. 测试策略
1. **单元测试**：针对 Storage、AI、UsageLog、PromptFile 等服务层逻辑,使用 mock 验证边界条件。
2. **集成测试**：借助 VSCode Test Host，模拟命令执行、TreeView 交互与 Markdown 文件写入流程。
3. **手工回归**：验证 UI 体验、状态栏/通知提示、AI 失败回退、多平台差异。
4. **性能与稳定性**：构造 ≥1000 条 Prompt 的数据集，评估列表刷新、命令延迟；模拟频繁 AI 调用与文件冲突。

## 2. 测试环境
- OS：Windows 11、macOS Sonoma、Ubuntu 22.04。
- VSCode：1.85（最低支持）、1.90（稳定）、Insiders。
- Node.js：18 LTS。
- AI：Mock Server（默认）、OpenAI GPT-4o、Azure GPT-4o、通义千问。
- 文件系统：本地磁盘 + OneDrive/坚果云等同步盘（验证共享场景）。
- Git：2.40+（CLI），GitHub/GitLab 仓库，模拟冲突与 push 失败。

## 3. 用例列表
| 用例 | 场景 | 步骤摘要 | 期望结果 |
| --- | --- | --- | --- |
| TC01 | 选区创建成功 | 选中 Markdown 文本 → 右键创建 → 填写名称/emoji → 保存 | Prompt 写入 JSON；TreeView 即时刷新；状态栏提示成功 |
| TC02 | 名称重复校验 | 分别创建两个同名 Prompt | 第二次保存被拒并提示重命名 |
| TC03 | 命令面板筛选/复制 | Ctrl+Shift+P → 输入关键字 → 复制 | 剪贴板获得正文；最近使用列表更新 |
| TC04 | 活动栏操作 | 在 TreeView 中编辑、删除、撤销 | 编辑更新 updatedAt；删除弹出确认→可撤销 |
| TC05 | AI 生成 emoji/标题 | 触发 AI 生成 → 成功/失败 | 成功返回推荐；失败给出错误提示且保持原值 |
| TC06 | AI 优化内容 | 触发优化 → 查看差异 → 接受 | 正文更新，可撤销；UsageLog 记录 tokens/费用 |
| TC07 | AI 调用失败 | 断网或填错 API Key 后触发 AI 功能 | 显示失败提示；UsageLog status=failed；不影响本地操作 |
| TC08 | JSON ↔ Markdown 同步 | 开启镜像 → 编辑 JSON 后导出 Markdown / 编辑 Markdown 保存 | 内容保持一致；冲突时提示用户选择策略 |
| TC09 | 空白 Prompt 模板 | 运行"新建 Prompt 文件"命令 → 接受默认文件名/输入自定义 → 自动生成标题 | 创建的 Markdown 文件自动打开并插入标题；同时写入 JSON 草稿；保存后 JSON 内容与 Markdown 匹配 |
| TC10 | AI 耗费导出 | 连续调用 AI → 执行"查看 AI 消耗"→ 导出 CSV | 列表显示正确条目并可导出 |
| TC11 | 性能 | 使用 1000+ Prompt，执行 TreeView 刷新/命令筛选 | 操作耗时符合 <200ms 目标，无 UI 卡顿 |
| TC12 | 单元测试脚本 | npm test | 所有测试通过，覆盖率 ≥70% |
| TC13 | GitHub 同步 | 在 Git 仓库中启用同步功能，测试 pull、冲突、自动提交、commit/push | 同步日志显示正确操作，冲突时友好提示。pull 后不会影响本地操作 |
| TC14 | 首次使用引导 - 完整流程 | 全新安装插件 → 1秒后启动向导 → 依次完成 5 步配置 → 点击"完成" | globalState 记录 onboardingCompleted=true；配置项正确写入；向导不再自动弹出 |
| TC15 | 首次使用引导 - 跳过步骤 | 向导步骤 2 点击"使用默认设置" | 跳过后续步骤，直接跳转到完成页面；使用默认配置；可通过命令重新启动向导 |
| TC16 | 首次使用引导 - 中途取消 | 向导步骤 3 关闭 QuickPick | 已配置的前 2 步保留；onboardingCompleted=false；下次激活继续弹出向导 |
| TC17 | 首次使用引导 - 重启向导 | 执行"Prompt Hub: 重新开始引导"命令 | 清除 onboardingCompleted 标记；重新启动 5 步向导；可重新配置所有选项 |
| TC18 | 首次使用引导 - Git 检测 | 向导步骤 3 自动检测存储路径 | 如已是 Git 仓库，显示"已检测到 Git 仓库"；否则提供"初始化"选项 |
| TC19 | 快速打开设置 - 命令面板 | Ctrl+Shift+P → 输入"Prompt Hub: 打开设置" | 打开 VSCode 设置页面并筛选到 @ext:publisher.prompt-hub |
| TC20 | 快速打开设置 - TreeView 工具栏 | 点击活动栏 TreeView 顶部设置图标 | 打开 VSCode 设置页面并筛选到插件配置 |
| TC21 | 快速打开设置 - 状态栏警告 | 配置 Git 未设置 → 状态栏显示警告图标 → 点击 | 打开设置页面并定位到 Git 相关配置项 |
| TC22 | 快速打开设置 - 右键菜单 | TreeView 右键任意 Prompt → 选择"打开设置" | 打开 VSCode 设置页面 |
| TC23 | 选区智能识别 - 标准标记 | 选中文本第一行为 `# prompt: 🖨️ 打印配置` → 创建 Prompt | 名称预填充"打印配置"；emoji 预填充 🖨️；正文不包含标记行 |
| TC24 | 选区智能识别 - 不区分大小写 | 选中文本第一行为 `# PROMPT: 测试名称` → 创建 Prompt | 正确识别名称"测试名称"；标记行被移除 |
| TC25 | 选区智能识别 - 忽略空格 | 选中文本第一行为 `#  prompt  :  名称` → 创建 Prompt | 正确识别名称"名称"；多余空格被忽略 |
| TC26 | 选区智能识别 - 无标记 fallback | 选中普通文本（无 `# prompt:` 标记）→ 创建 Prompt | 使用默认名称生成流程；正文包含所有选中内容 |
| TC27 | 选区智能识别 - emoji 提取 | 选中文本第一行为 `# prompt: 😊 快乐提示` → 创建 Prompt | emoji 字段为"😊"；name 字段为"快乐提示"（不含 emoji） |
| TC28 | 选区智能识别 - 配置开关 | promptHub.selection.autoDetectPromptName=false → 选中带标记文本 → 创建 Prompt | 不进行智能识别；使用默认流程；标记行保留在正文中 |
| TC29 | 选区智能识别 - 标记移除配置 | promptHub.selection.removePromptMarker=false → 选中带标记文本 → 创建 Prompt | 识别名称和 emoji；但标记行保留在正文中 |

## 4. 缺陷管理与交付
- 所有缺陷进入 issue tracker，标签示例：area/storage、area/ai、area/treeview、area/template、area/onboarding、area/selection。
- 测试报告需包含：执行用例列表、通过率、缺陷摘要、已知风险、AI 调用统计抽样。
- 每次发布前需完成一次完整回归，重点关注 F9 新功能、F11 首次使用引导、F13 选区智能识别与 JSON/Markdown 同步链路。

## 5. 风险与对策
| 风险 | 描述 | 预防/缓解 |
| --- | --- | --- |
| AI 费用不可控 | 用户频繁调用优化功能导致费用飙升 | 默认关闭自动优化；提供 token/费用阈值提醒 |
| 文件同步冲突 | JSON 与 Markdown 同时编辑导致覆盖 | 保存前比较时间戳并提示用户选择；定期备份 |
| 同步盘延迟 | 存储目录位于网盘导致写入冲突 | 提示用户避免多设备同时改写；写入失败自动重试并记录日志 |
| 插件更新兼容性 | 数据版本升级导致旧字段缺失 | PromptStorageService 提供 migrate() 钩子，保存前自动升级版本 |
| 测试覆盖盲区 | 新命令未纳入自动化 | 将命令注册与执行逻辑解耦，便于模拟；CI 阻断未覆盖区域的合并 |
| 首次引导中断 | 用户在向导中途退出导致配置不完整 | 每步立即保存；下次启动恢复到上次位置；提供"重置引导"命令 |
| 选区识别误匹配 | 用户正文中恰好包含 `# prompt:` 但并非标记 | 仅检测第一行；提供配置开关关闭自动识别；用户可手动修改名称 |

## 6. 单元测试要点

### 6.1 OnboardingWizard 测试
- **正常流程**：模拟 5 步完整配置，验证 globalState 正确写入
- **跳过步骤**：验证"使用默认设置"直接跳到完成页面
- **中途取消**：验证已配置部分被保存，未完成部分下次继续
- **重启向导**：验证清除 onboardingCompleted 标记后可重新配置
- **Git 自动检测**：mock isGitRepository 方法，验证检测逻辑

### 6.2 SettingsService 测试
- **打开设置命令**：验证调用 workbench.action.openSettings 并传递正确参数
- **状态栏警告提示**：验证配置缺失时状态栏显示可点击警告

### 6.3 SelectionParser 测试
- **标准标记识别**：`# prompt: 🖨️ 名称` → 正确提取名称和 emoji
- **大小写不敏感**：`# PROMPT:` / `# Prompt:` / `# prompt:` 均可识别
- **空格容错**：`#prompt:` / `#  prompt  :` 均可识别
- **emoji 提取**：`# prompt: 😊 名称` → emoji="😊", name="名称"
- **无标记 fallback**：普通文本返回空 ParseResult
- **标记行移除**：验证返回内容不包含第一行标记
- **配置开关**：验证 autoDetectPromptName=false 时不进行识别
- **标记保留配置**：验证 removePromptMarker=false 时保留标记行
