# Prompt Hub 测试用例（基于项目功能）

> 适用范围：VSCode 扩展 `Prompt Hub`（本地存储、Markdown 镜像、Git 同步、AI 生成/优化、TreeView 管理、首次使用向导等）
>
> 用途：作为手工回归用例清单，也可按模块逐步转化为自动化（单元/集成/E2E）。

## 1. 测试约定

- 用例编号：`PH-xxx`
- 优先级：P0（阻断/核心链路）/ P1（重要）/ P2（一般）
- 类型：功能 / 异常 / 兼容 / 性能 / 安全
- 用例格式：
  - **前置条件**：环境、配置、数据准备
  - **步骤**：可直接执行的操作序列
  - **预期结果**：可观察结果（UI、文件、日志、行为）

## 2. 测试环境与数据准备（建议）

- VSCode：`1.85+`（最低）+ 至少 1 个较新版本（如 `1.90+`）
- OS：Windows / macOS / Linux 各至少 1 台（或 CI/E2E 覆盖）
- Git：本机安装 `git`，准备 1 个可读写远程仓库（GitHub/GitLab 均可）
- AI：
  - 云端：准备 1 个可用的 OpenAI 兼容 Key（或使用无 Key 的异常回归）
  - 本地：可选安装 `Claude Code CLI`/`Codex CLI`（用于 local provider 场景）
- 测试数据：
  - 存储目录（`promptHub.storagePath`）准备 5~10 个 Markdown Prompt 文件（含/不含 frontmatter、含/不含 emoji、含非法文件名字符等）
  - 准备 1 份远程仓库数据：包含 `prompts.json` 与若干 `.md`，用于 Git 导入/同步

## 3. 用例列表

### 3.1 激活与存储初始化（PromptStorageService）

#### PH-001（P0 / 功能）首次激活自动创建存储目录与 `prompts.json`
- 前置条件：`promptHub.storagePath` 指向一个不存在的目录；`promptHub.storage.autoCreate=true`
- 步骤：
  1. 启动 VSCode（确保扩展被激活）
- 预期结果：
  - 存储目录被创建
  - 生成 `prompts.json`，内容为合法 JSON，`prompts` 为数组
  - TreeView 能正常显示（空列表或“暂无 Prompt”提示）

#### PH-002（P0 / 异常）关闭自动创建时，存储目录不存在应提示错误
- 前置条件：`promptHub.storagePath` 指向一个不存在的目录；`promptHub.storage.autoCreate=false`
- 步骤：
  1. 启动 VSCode
- 预期结果：
  - 扩展激活失败被捕获并提示（error message）
  - 不应创建存储目录与 `prompts.json`

#### PH-003（P0 / 异常）`prompts.json` 损坏时的失败提示
- 前置条件：存储目录存在；手动将 `prompts.json` 写成非 JSON（如少一个括号）
- 步骤：
  1. 启动 VSCode
- 预期结果：
  - 扩展激活失败被捕获并提示（error message）
  - 不应静默覆盖损坏文件（便于用户恢复）

#### PH-004（P0 / 功能）切换 `storagePath` 后数据与视图正确刷新
- 前置条件：准备 A/B 两个不同存储目录，分别包含不同 Prompt 数据
- 步骤：
  1. 在 VSCode 设置中修改 `promptHub.storagePath` 为另一个目录
- 预期结果：
  - 提示“已切换存储路径”
  - TreeView 列表刷新为新目录内容
  - `prompts.json` 与 Markdown 导入/清理逻辑在新目录生效

### 3.2 Markdown 导入与缺失清理（import/prune）

#### PH-010（P0 / 功能）启动时自动导入存储目录已有 Markdown Prompt
- 前置条件：存储目录内存在若干 `.md`，包含合法 frontmatter（`id:`/`tags:`）与 `# 标题`
- 步骤：
  1. 启动 VSCode
- 预期结果：
  - `.md` 被导入到 `prompts.json`
  - TreeView 展示导入的 Prompt（含标签分组）

#### PH-011（P1 / 兼容）Markdown 无 frontmatter 时仍可导入
- 前置条件：存储目录内存在 `.md`，不包含 `---` frontmatter，仅包含 `# 标题` 与正文
- 步骤：
  1. 启动 VSCode 或执行“刷新视图”
- 预期结果：
  - Prompt 仍被创建（ID 自动生成）
  - 名称可来自 H1 标题；无标题时回退为文件名

#### PH-012（P1 / 异常）Markdown `id` 冲突时不覆盖已有 Prompt
- 前置条件：存储目录内存在两个 `.md` 使用相同 `id:`（或与 `prompts.json` 中已有 Prompt ID 冲突）
- 步骤：
  1. 启动 VSCode 或执行“刷新视图”
- 预期结果：
  - 导入逻辑不会覆盖已有 Prompt
  - 冲突项会生成新的唯一 ID（数据不丢失）

#### PH-013（P0 / 功能）源文件缺失时自动清理残留 Prompt（避免 TreeView 残留）
- 前置条件：某 Prompt 在 `prompts.json` 中 `sourceFile` 指向一个已不存在的 `.md`
- 步骤：
  1. 执行“刷新视图”
- 预期结果：
  - 该 Prompt 被自动从列表中移除
  - TreeView 不再展示该项

### 3.3 TreeView 展示与排序（PromptTreeProvider）

#### PH-020（P0 / 功能）按标签分组展示，“未分组”兜底生效
- 前置条件：准备 1 个带 tags 的 Prompt + 1 个不带 tags 的 Prompt
- 步骤：
  1. 打开 Prompt Hub TreeView
- 预期结果：
  - tags 各自形成分组节点
  - 无 tags 的 Prompt 归入“未分组”

#### PH-021（P1 / 功能）排序：recent / name / created / usage
- 前置条件：准备多个 Prompt；并产生不同的使用次数（复制/搜索会记录 usage log）
- 步骤：
  1. 分别设置 `promptHub.ui.sortBy=recent|name|created|usage`
  2. 观察 TreeView 顺序
- 预期结果：
  - `recent`：按 `updatedAt` 倒序
  - `name`：按名称字典序
  - `created`：按 `createdAt` 倒序
  - `usage`：按使用次数倒序（高频在前）

#### PH-022（P0 / 功能）TreeItem 单击复制、双击编辑
- 前置条件：TreeView 中存在至少 1 个 Prompt 且 `sourceFile` 可打开
- 步骤：
  1. 单击 Prompt
  2. 在 350ms 内再次单击同一 Prompt（形成双击）
- 预期结果：
  - 单击：Prompt 内容写入剪贴板并提示成功
  - 双击：打开对应 Markdown 文件进入编辑

### 3.4 “从选区创建 Prompt”（SelectionParser + CommandRegistrar）

#### PH-030（P0 / 异常）无编辑器或无选区时的提示
- 前置条件：无活动编辑器，或编辑器无选区
- 步骤：
  1. 执行命令“从选区创建”
- 预期结果：
  - 提示用户先打开编辑器或选择文本
  - 不应创建任何 Prompt

#### PH-031（P0 / 功能）识别 `# prompt:` 标记并提取 emoji + 名称
- 前置条件：`promptHub.selection.autoDetectPromptName=true`；选区第一行形如 `# prompt: 😄 我的标题`
- 步骤：
  1. 选中包含该首行的文本，执行“从选区创建”
- 预期结果：
  - 输入框默认填充标题与 emoji
  - 若 `promptHub.selection.removePromptMarker=true`：保存内容不包含首行标记

#### PH-032（P1 / 兼容）回退识别 Markdown H1（`# 标题`）
- 前置条件：选区第一行为 `# 😄 标题`（无 `# prompt:`）
- 步骤：
  1. 执行“从选区创建”
- 预期结果：
  - 自动提取 emoji 与标题
  - 内容按配置决定是否移除首行

#### PH-033（P1 / 功能）关闭自动识别后不提取标题
- 前置条件：`promptHub.selection.autoDetectPromptName=false`
- 步骤：
  1. 选中带 `# prompt:` 的文本，执行“从选区创建”
- 预期结果：
  - 不自动填充标题/emoji（仅保存选区内容）

#### PH-034（P0 / 异常）用户取消任一输入框，不应创建 Prompt
- 前置条件：正常选区
- 步骤：
  1. 执行“从选区创建”，在“名称/emoji/tags”任一步点击取消
- 预期结果：
  - 不写入 `prompts.json`
  - TreeView 无变化

#### PH-035（P1 / 功能）名称为空时生成默认名称且避免冲突
- 前置条件：存在若干 Prompt；选区内容可生成默认名
- 步骤：
  1. 执行“从选区创建”，名称输入框留空直接回车
- 预期结果：
  - 自动生成形如 `xxx #1/#2` 的默认名称
  - 若存在同名，自动递增避免冲突

#### PH-036（P1 / 功能）tags 输入支持中英文逗号与空格并去重
- 前置条件：正常选区
- 步骤：
  1. tags 输入：`代码, 审查  团队，代码`
- 预期结果：
  - tags 被解析为去重后的数组（顺序可不严格，但不应包含空串）

#### PH-037（P0 / 异常）Prompt 名称重复时创建失败并提示
- 前置条件：已存在 Prompt 名称 `A`
- 步骤：
  1. 再次创建同名 Prompt（名称输入 `A`）
- 预期结果：
  - 创建失败，提示“名称已存在”
  - 不应写入重复数据

### 3.5 “新建 Prompt 文件”（PromptFileService）

#### PH-040（P0 / 功能）使用模板创建 Markdown 文件并自动打开
- 前置条件：`promptHub.markdown.filenameTemplate=prompt-{timestamp}.md`
- 步骤：
  1. 执行“新建 Prompt 文件”
- 预期结果：
  - 存储目录生成新的 `.md`
  - 文件包含 frontmatter（`id/type/tags`）与标题占位符
  - 文件在编辑器中打开，光标/选区定位到“在此填写标题”

#### PH-041（P1 / 功能）询问文件名 + 非法字符清洗 + 自动补 `.md`
- 前置条件：`promptHub.markdown.askForFilename=true`
- 步骤：
  1. 执行“新建 Prompt 文件”
  2. 输入 `我的:Prompt*测试`（不带 `.md`）
- 预期结果：
  - 最终文件名被清洗为合法文件名并自动补全 `.md`
  - 若文件名冲突，自动追加 `-1/-2/...`

#### PH-042（P1 / 异常）模板依赖 `{name}/{emoji}` 但为空时应兜底
- 前置条件：`promptHub.markdown.filenameTemplate={name}.md` 或 `{emoji}-{name}.md`
- 步骤：
  1. 执行“新建 Prompt 文件”（此时无上下文 name/emoji）
- 预期结果：
  - 不应生成 `.md` 或 `-.md` 这种无意义文件名
  - 回退为 `prompt-{timestamp}.md` 风格

### 3.6 搜索与复制（Fuse.js + Clipboard）

#### PH-050（P1 / 功能）无 Prompt 时搜索提示
- 前置条件：列表为空
- 步骤：
  1. 执行“搜索 Prompt”
- 预期结果：
  - 提示“暂无 Prompt”

#### PH-051（P0 / 功能）搜索：优先用编辑器选区作为查询词
- 前置条件：存在 Prompt；当前编辑器选中一个关键字
- 步骤：
  1. 执行“搜索 Prompt”
- 预期结果：
  - 不弹出输入框（或直接以选区为 query）
  - QuickPick 展示匹配结果，选择后复制内容

#### PH-052（P1 / 功能）搜索结果数量上限与空查询
- 前置条件：存在超过 50 个 Prompt
- 步骤：
  1. 执行“搜索 Prompt”，输入框留空回车
- 预期结果：
  - 结果可展示全部（但列表最多取前 50 项显示）

#### PH-053（P0 / 功能）复制 Prompt 内容到剪贴板并提示
- 前置条件：可通过 TreeView 或搜索选中 Prompt
- 步骤：
  1. 执行“复制内容”
- 预期结果：
  - 剪贴板内容等于 Prompt 正文
  - 弹出成功提示
  - 使用记录写入（用于后续 `usage` 排序）

#### PH-054（P1 / 异常）无效上下文执行“复制内容”应提示错误
- 前置条件：从非 Prompt 上下文触发（或模拟传参缺失）
- 步骤：
  1. 执行“复制内容”
- 预期结果：
  - 提示“无法确定要复制的 Prompt”

### 3.7 编辑 / 重命名 / 删除（CommandRegistrar + PromptStorageService）

#### PH-060（P0 / 功能）编辑 Prompt：打开关联 Markdown 文件
- 前置条件：Prompt 存在且 `sourceFile` 指向有效 `.md`
- 步骤：
  1. 执行“编辑 Prompt”
- 预期结果：
  - 对应文件被打开（非 preview）

#### PH-061（P1 / 异常）无 `sourceFile` 的 Prompt 不支持编辑/重命名
- 前置条件：构造一个 `sourceFile` 为空的 Prompt（例如仅 JSON 数据）
- 步骤：
  1. 执行“编辑 Prompt”或“按标题重命名文件”
- 预期结果：
  - 给出明确提示并跳过

#### PH-062（P1 / 安全）仅允许重命名存储目录内文件
- 前置条件：Prompt 的 `sourceFile` 指向存储目录外路径
- 步骤：
  1. 执行“按标题重命名文件”
- 预期结果：
  - 出于安全原因拒绝执行并提示

#### PH-063（P1 / 功能）重命名冲突时自动追加 `-1/-2`
- 前置条件：存储目录内存在同名目标文件
- 步骤：
  1. 执行“按标题重命名文件”
- 预期结果：
  - 实际落盘文件名追加 `-1/-2` 避免覆盖
  - `prompts.json` 的 `sourceFile` 更新为新路径

#### PH-064（P0 / 功能）删除 Prompt 同时删除关联 Markdown 文件
- 前置条件：Prompt 有有效 `sourceFile`
- 步骤：
  1. 执行“删除 Prompt”，在确认弹窗选择“删除”
- 预期结果：
  - Prompt 从列表移除
  - 对应 Markdown 文件被删除

#### PH-065（P1 / 兼容）外部重命名导致 `sourceFile` 失效时的删除兜底
- 前置条件：将 Prompt 的 `.md` 在外部工具（如 Obsidian）重命名，使 `sourceFile` 路径失效；但文件仍在存储目录且 frontmatter `id` 未变
- 步骤：
  1. 在 TreeView 中对该 Prompt 执行“删除 Prompt”
- 预期结果：
  - 扩展能基于 `id` 在存储目录定位真实文件并删除（或至少不报未处理异常）
  - Prompt 数据被移除

### 3.8 Markdown 镜像（MarkdownMirrorService）

#### PH-070（P1 / 功能）关闭镜像后保存 Markdown 不应改动 JSON
- 前置条件：`promptHub.markdown.enableMirror=false`
- 步骤：
  1. 在存储目录内打开某个 `.md` 并保存修改
- 预期结果：
  - 不触发 JSON 同步（TreeView 不变化或不更新内容）

#### PH-071（P0 / 功能）保存存储目录内 Markdown => 同步到 JSON（新增/更新）
- 前置条件：`promptHub.markdown.enableMirror=true`
- 步骤：
  1. 修改存储目录内某个 `.md` 的标题/正文/tags 并保存
- 预期结果：
  - 对应 Prompt 在 `prompts.json` 中被新增或更新
  - TreeView 实时刷新（或保存后可刷新看到变化）

#### PH-072（P1 / 安全）保存非存储目录 Markdown 不应被镜像处理
- 前置条件：`promptHub.storagePath` 指向目录 A；另有目录 B 的 Markdown
- 步骤：
  1. 在目录 B 打开 `.md` 保存
- 预期结果：
  - 不写入/更新 `prompts.json`

#### PH-073（P1 / 功能）从占位符标题改为真实标题后自动重命名文件
- 前置条件：通过“新建 Prompt 文件”创建的 `.md`（标题为“在此填写标题”）
- 步骤：
  1. 将标题改为 `# 😄 我的标题` 并保存
- 预期结果：
  - 文件被自动重命名为 `😄-我的标题.md`（或清洗后的等价命名）
  - `prompts.json` 中该 Prompt 的 `sourceFile` 更新为新路径
  - 编辑器自动切换到新文件

#### PH-074（P1 / 功能）frontmatter `rename: false` 时保存不应触发自动重命名
- 前置条件：`promptHub.markdown.autoRenameOnSave=true`；某 `.md` 的 frontmatter 显式设置 `rename: false`
- 步骤：
  1. 修改该文件标题并保存
- 预期结果：
  - 文件名保持不变
  - JSON 仍会更新 Prompt 的 name/emoji/content（仅不改文件名）

#### PH-075（P1 / 功能）关闭 `markdown.autoRenameOnSave` 后保存不应自动重命名
- 前置条件：`promptHub.markdown.autoRenameOnSave=false`
- 步骤：
  1. 修改存储目录内 `.md` 的标题并保存
- 预期结果：
  - 文件名保持不变
  - JSON 同步仍正常工作

### 3.9 Git 导入与同步（GitSyncService）

#### PH-080（P0 / 功能）新设备一键导入：非 Git 目录 + 配置远程 => 导入成功
- 前置条件：`storagePath` 不是 Git 仓库；设置 `promptHub.git.remoteUrl` 为可访问远程仓库
- 步骤：
  1. 执行“Git 拉取/导入”
- 预期结果：
  - 自动在 `storagePath` 完成导入/检出（有 `.git`）
  - 导入后刷新存储与 TreeView，可看到 Prompt

#### PH-081（P1 / 功能）同步：有本地改动时自动 add/commit（按配置决定是否 push）
- 前置条件：`storagePath` 已是 Git 仓库；制造 1 个变更（新增/编辑 Prompt）
- 步骤：
  1. 将 `promptHub.git.enableSync=false`，执行“Git 同步”
  2. 将 `promptHub.git.enableSync=true`，再次执行“Git 同步”
- 预期结果：
  - 第 1 次：完成 add/commit，但不进行 pull/push
  - 第 2 次：完成 pull(rebase) + push（远程可见提交）

#### PH-082（P1 / 异常）远程认证失败/网络失败时错误提示清晰
- 前置条件：设置一个无权限或错误的远程 URL
- 步骤：
  1. 执行“Git 拉取/导入”或“Git 同步”
- 预期结果：
  - 显示明确失败提示，不应造成数据损坏

#### PH-083（P1 / 安全）日志中不应泄露带 Token 的远程 URL
- 前置条件：将远程 URL 配置为包含用户名/Token 的 HTTPS URL（用于验证脱敏）
- 步骤：
  1. 开启 `promptHub.git.debugLog=true`
  2. 执行一次 Git 操作
- 预期结果：
  - 诊断日志中的远程 URL 被脱敏（不出现明文 token/password）

#### PH-084（P1 / 功能）自动同步：保存存储目录内 Markdown 后延迟触发 sync
- 前置条件：`promptHub.git.enableSync=true`；`promptHub.git.autoSyncOnSave=true`；`promptHub.git.autoSyncDelaySeconds` 设置为较小值（如 5~10）
- 步骤：
  1. 修改存储目录内 `.md` 并保存
  2. 等待延迟时间
- 预期结果：
  - 自动执行一次 Git 同步，并在状态栏给出提示
  - 存储目录外的保存不应触发自动同步

#### PH-085（P0 / 功能）拉取策略：保留未跟踪文件，仅恢复远端内容（解决“误删后拉不下来”）
- 前置条件：`storagePath` 已是 Git 仓库且已配置 `origin`；本地做出以下状态：
  - 删除若干已跟踪文件（制造大量 `D  xxx`）
  - 新建 1 个未跟踪 Prompt 文件（制造 `?? my-local.md`）
- 步骤：
  1. 执行“Git 拉取/导入”
  2. 在弹窗中选择“保留本地未跟踪文件，仅恢复远端内容”并确认
- 预期结果：
  - 不再出现 `cannot pull with rebase: You have unstaged changes`
  - 远端文件被恢复到本地（工作区与远端一致）
  - 本地未跟踪 Prompt 文件仍保留（若与远端同名则自动改名保留）
  - UI 提示包含备份目录路径（用于回溯）

#### PH-086（P1 / 安全）拉取策略：以远端覆盖本地（确认提示 + 丢数据风险）
- 前置条件：本地存在未提交改动（含未跟踪文件）
- 步骤：
  1. 执行“Git 拉取/导入”
  2. 选择“以远端覆盖本地（危险）”
  3. 在二次确认弹窗中选择“继续”
- 预期结果：
  - 弹窗明确提示“会丢弃未提交改动并可能删除未跟踪文件”
  - 操作完成后本地工作区与远端一致
  - 之前未跟踪文件可能被删除（符合预期风险）

#### PH-087（P1 / 异常）备份目录不应被导入为 Prompt（避免 TreeView 污染）
- 前置条件：存储目录内存在 `.prompt-hub-backup-xxxx` 目录，且其中包含 `.md` 文件（可通过导入备份或手工创建模拟）
- 步骤：
  1. 执行“刷新视图”或触发一次 Git 操作后自动刷新
- 预期结果：
  - 备份目录下的 `.md` 不会被导入到 `prompts.json`
  - TreeView 不展示备份目录中的 Prompt 项

### 3.10 AI 生成/优化（AIService + 本地 Provider）

#### PH-090（P0 / 异常）未配置 AI Provider 时应给出引导提示并不改变内容
- 前置条件：`promptHub.ai.provider` 为空
- 步骤：
  1. 对某 Prompt 执行“AI 优化”或“生成标题/emoji”
- 预期结果：
  - 提示先运行“配置向导”或设置 `promptHub.ai.provider`
  - Prompt 内容/元信息不被修改

#### PH-091（P1 / 功能）云端 Provider：首次使用会提示输入 Key 并保存到 SecretStorage
- 前置条件：`promptHub.ai.provider=openai`（或其他云端 provider）；SecretStorage 中无对应 Key
- 步骤：
  1. 执行一次 AI 操作
  2. 输入 Key 并确认
  3. 再次执行 AI 操作
- 预期结果：
  - 第 1 次提示输入 Key；第 2 次不再提示（已保存）
  - AI 成功时更新 Prompt（并同步 Markdown 标题/正文）

#### PH-092（P1 / 异常）云端 API 失败（Key 错误/BaseUrl 错误）应回退不改内容
- 前置条件：配置错误 Key 或错误 `promptHub.ai.baseUrl`
- 步骤：
  1. 执行“AI 优化”
- 预期结果：
  - 显示失败提示
  - 返回原内容（不覆盖现有 Prompt）

#### PH-093（P1 / 兼容）本地 Provider：CLI 不可用时提示并回退
- 前置条件：`promptHub.ai.provider=local-claude` 或 `local-codex`；配置一个不存在的可执行路径
- 步骤：
  1. 执行“AI 优化”
- 预期结果：
  - 给出“本地 CLI 调用失败”的提示
  - Prompt 内容保持不变

#### PH-094（P1 / 功能）批量生成/批量优化的进度与统计正确
- 前置条件：TreeView 可多选；至少选中 3 个 Prompt；设置 `promptHub.ai.batchDelayMs` 为较小值
- 步骤：
  1. 执行“批量生成标题和图标（选中）”或“批量优化提示词”
- 预期结果：
  - 显示进度条并逐条处理
  - 成功/失败/跳过计数与结果提示合理
  - 成功项会更新 `prompts.json` 且（若有关联）同步 Markdown

### 3.11 配置向导与状态栏（OnboardingWizard / StatusBarService）

#### PH-100（P1 / 功能）首次使用向导自动弹出与可重置
- 前置条件：清空扩展 `globalState`（或新安装环境）
- 步骤：
  1. 启动 VSCode，等待约 1 秒
  2. 观察向导弹出并按流程完成或选择“稍后”
  3. 执行命令“重置配置向导”
- 预期结果：
  - 首次启动自动弹出向导
  - “稍后”会保留状态，下次可继续提示
  - 重置后 `onboardingCompleted` 变为 false，可再次弹出

#### PH-101（P1 / 功能）状态栏入口显示/隐藏与 QuickPick 操作
- 前置条件：`promptHub.statusBar.enable=true`
- 步骤：
  1. 点击状态栏图标
  2. 依次选择“新建/搜索/从选区创建/刷新/Git 拉取/导入/Git 同步/配置向导/打开设置”
  3. 设置 `promptHub.statusBar.enable=false`
- 预期结果：
  - QuickPick 能正确执行对应操作
  - 关闭配置后状态栏入口隐藏

### 3.12 路径变量解析（ConfigurationService）

#### PH-110（P1 / 兼容）`storagePath` 支持 `~` / `${workspaceFolder}` / 环境变量
- 前置条件：分别设置 `promptHub.storagePath` 为：
  - `~/.prompt-hub`
  - `${workspaceFolder}/.prompts`
  - `${env:USERPROFILE}/.prompt-hub`（Windows）或 `${env:HOME}/.prompt-hub`
  - `%USERPROFILE%\\.prompt-hub`（Windows）
- 步骤：
  1. 逐项设置并重载窗口
- 预期结果：
  - 实际落盘路径解析正确
  - 不出现路径拼接错误或双重分隔符问题
