# 调试指南 - 新建Prompt后侧边栏不显示问题

## 已添加的调试日志

为了帮助追踪"新建Prompt后侧边栏不显示"的问题,已在关键路径添加详细日志:

### 1. PromptFileService (文件创建)

**文件**: `src/services/PromptFileService.ts`

**日志位置**: `createPromptFile()` 方法

**关键日志**:
- `[PromptFileService] 开始创建新 Prompt 文件`
- `[PromptFileService] 存储路径: xxx`
- `[PromptFileService] 文件名模板: xxx`
- `[PromptFileService] 最终文件路径: xxx`
- `[PromptFileService] 文件内容预览: xxx`
- `[PromptFileService] 文件写入成功`
- `[PromptFileService] 新 Prompt 文件创建完成`

### 2. MarkdownMirrorService (保存同步)

**文件**: `src/services/MarkdownMirrorService.ts`

**日志位置**: `onDidSave()` 方法

**关键日志**:
- `[MarkdownMirrorService] 检测到文件保存事件: xxx`
- `[MarkdownMirrorService] Markdown镜像是否启用: true/false` ⚠️ **必须为true**
- `[MarkdownMirrorService] 路径检查 - 是否在存储目录内: true/false` ⚠️ **必须为true**
- `[MarkdownMirrorService] 提取的ID标记: xxx` ⚠️ **必须有值**
- `[MarkdownMirrorService] 查找已存在的Prompt: 找到/未找到`
- `[MarkdownMirrorService] 创建新Prompt` 或 `[MarkdownMirrorService] 更新现有Prompt`
- `[MarkdownMirrorService] 新Prompt创建成功` 或 `[MarkdownMirrorService] Prompt更新成功`

### 3. PromptStorageService (存储操作)

**文件**: `src/services/PromptStorageService.ts`

**日志位置**: `add()`, `update()`, `save()` 方法

**关键日志**:
- `[PromptStorageService] 添加新Prompt - id: xxx, name: xxx`
- `[PromptStorageService] Prompt已添加到内存，当前总数: xxx`
- `[PromptStorageService] 开始保存数据，Prompt总数: xxx`
- `[PromptStorageService] 临时文件写入成功`
- `[PromptStorageService] 文件重命名成功`
- `[PromptStorageService] 触发变更事件 _onDidChangePrompts.fire()`
- `[PromptStorageService] 变更事件已触发` ⚠️ **关键步骤**

### 4. PromptTreeProvider (侧边栏刷新)

**文件**: `src/providers/PromptTreeProvider.ts`

**日志位置**: `constructor()`, `refresh()`, `getChildren()` 方法

**关键日志**:
- `[PromptTreeProvider] 初始化TreeProvider`
- `[PromptTreeProvider] 收到存储变更事件，触发刷新` ⚠️ **必须触发**
- `[PromptTreeProvider] 执行refresh()，触发 _onDidChangeTreeData.fire()`
- `[PromptTreeProvider] 树视图刷新事件已触发`
- `[PromptTreeProvider] getChildren被调用`
- `[PromptTreeProvider] 获取到的Prompt数量: xxx` ⚠️ **应该包含新建的Prompt**

## 如何查看日志

### 方法1: VSCode 开发者工具控制台

1. 按 `F1` 打开命令面板
2. 输入 `Developer: Toggle Developer Tools`
3. 选择 `Console` 标签
4. 筛选包含 `[Prompt` 的日志

### 方法2: VSCode 输出面板

1. 按 `Ctrl+Shift+U` 打开输出面板
2. 在下拉菜单中选择 `Extension Host`
3. 查看控制台输出

## Git 拉取/导入/同步调试（建议开启）

当你遇到以下问题时：

- “Git 拉取/导入”提示 `cannot pull with rebase: You have unstaged changes`
- 误删本地文件后，拉取似乎“拉不下来”/远端文件没恢复
- 拉取策略选择后结果与预期不一致

建议开启更详细的 Git 诊断日志：

1. 打开 VS Code 设置，搜索 `promptHub.git.debugLog` 并开启
2. 重新执行一次相关命令：
   - “Git 拉取/导入”
   - “Git 同步”
3. 在日志中重点关注两类前缀：
   - `[CommandRegistrar][GitPull]`：记录 UI 选择的拉取策略与关键分支决策（不会输出远程 URL 明文，避免泄露凭据）
   - `[GitSyncService]` / `[GitSyncService][诊断]`：记录实际执行的 git 命令与仓库诊断快照

### “Git 拉取/导入”三种策略说明（会出现在弹窗里）

当检测到本地存在未提交改动时，会提示你选择策略：

1. **保留本地改动并拉取（推荐）**
   - 行为：`git pull --rebase`（默认带 `--autostash`）
   - 适合：你想保留本地新增/修改的 Prompt，同时合并远端更新
   - 风险：可能出现冲突；如果本地“删除文件”很多，删除也会被保留，导致远端文件恢复后又被本地删除覆盖

2. **保留本地未跟踪文件，仅恢复远端内容**
   - 行为：备份未跟踪文件 → 丢弃其它未提交改动（包括删除/修改）→ 以远端为准恢复 → 再把未跟踪文件放回
   - 适合：你误删了大量文件，但只想保留你新建的那个 Prompt 文件，同时把远端文件完整恢复下来
   - 风险：若未跟踪文件与远端同名，会自动改名保留；备份目录会打印在日志/提示中便于回溯

3. **以远端覆盖本地（危险）**
   - 行为：丢弃所有未提交改动并清理未跟踪文件，最终工作区与远端一致
   - 适合：你确认不需要保留本地任何改动，只要“回到远端最新”
   - 风险：可能造成数据不可逆丢失（包含你新建的 Prompt 文件），务必先自行备份

## 本地 Claude/Codex 终端自检（无需打开 VSCode）

为方便定位“本地 Claude Code / 本地 Codex 调用失败”的问题，项目提供一个可直接在终端运行的诊断脚本：`scripts/ai-doctor.js`。

- 仅探测路径（无网络/无调用副作用）：
  - `cd upstream && npm run ai:doctor`
  - （在仓库根目录执行）`pnpm -C upstream run ai:doctor`
  - （已在 upstream 目录内）`pnpm run ai:doctor`

- 真实执行一次最小调用（会触发 CLI 自身的登录/网络行为）：
  - `cd upstream && npm run ai:doctor:probe`
  - （在仓库根目录执行）`pnpm -C upstream run ai:doctor:probe`
  - （已在 upstream 目录内）`pnpm run ai:doctor:probe`
  - 自定义超时：`node upstream/scripts/ai-doctor.js --probe --timeout-ms 300000`

如果 Claude 输出提示需要登录/授权，建议先在终端手动运行：`claude -p "你好"` 完成登录。

## 完整的执行流程

正常情况下,新建Prompt的日志应该按以下顺序出现:

```
1. [PromptFileService] 开始创建新 Prompt 文件
2. [PromptFileService] 存储路径: ...
3. [PromptFileService] 文件写入成功
4. [PromptFileService] 新 Prompt 文件创建完成
   ↓ (用户编辑标题并保存 Ctrl+S)
5. [MarkdownMirrorService] 检测到文件保存事件: ...
6. [MarkdownMirrorService] Markdown镜像是否启用: true  ⚠️
7. [MarkdownMirrorService] 路径检查 - 是否在存储目录内: true  ⚠️
8. [MarkdownMirrorService] 提取的ID标记: 1731487123456-abc7def  ⚠️
9. [MarkdownMirrorService] 查找已存在的Prompt: 找到 (id: ...)
10. [MarkdownMirrorService] 更新现有Prompt ...
    或
    [MarkdownMirrorService] 创建新Prompt
11. [PromptStorageService] 添加新Prompt ...
12. [PromptStorageService] 开始保存数据 ...
13. [PromptStorageService] 触发变更事件 _onDidChangePrompts.fire()  ⚠️
14. [PromptTreeProvider] 收到存储变更事件，触发刷新  ⚠️
15. [PromptTreeProvider] 执行refresh()，触发 _onDidChangeTreeData.fire()
16. [PromptTreeProvider] getChildren被调用
17. [PromptTreeProvider] 获取到的Prompt数量: X (应该+1)
```

## 常见问题排查

### 问题1: Markdown镜像未启用

**症状**: 日志显示 `[MarkdownMirrorService] Markdown镜像未启用，跳过同步`

**解决方案**:
1. 打开 VSCode 设置 (Ctrl+,)
2. 搜索 `promptHub.markdown.enableMirror`
3. 勾选启用

### 问题2: 文件不在存储目录内

**症状**: 日志显示 `[MarkdownMirrorService] 文件不在存储目录内，跳过处理`

**解决方案**:
1. 检查 `promptHub.storagePath` 配置
2. 确保新建的文件在该目录下

### 问题3: 未提取到ID标记

**症状**: 日志显示 `[MarkdownMirrorService] 提取的ID标记: undefined`

**原因**: 文件内容缺少 `<!-- PromptHub:id=xxx -->` 标记

**解决方案**: 已修复,新建文件时会自动添加ID标记

### 问题4: 事件未触发

**症状**: 看不到 `[PromptTreeProvider] 收到存储变更事件` 日志

**可能原因**:
1. `save()` 方法执行失败
2. 事件监听器未正确绑定

**排查步骤**:
1. 检查是否有 `[PromptStorageService] 保存失败` 错误日志
2. 检查 `[PromptTreeProvider] 初始化TreeProvider` 是否出现

## 测试步骤

1. 启动插件 (按 F5 进入调试模式)
2. 打开开发者工具 (`Developer: Toggle Developer Tools`)
3. 点击侧边栏的"新建 Prompt 文件"按钮
4. 查看日志步骤 1-4
5. 修改标题为 `# prompt: 测试标题`
6. 保存文件 (Ctrl+S)
7. 查看日志步骤 5-17
8. 检查侧边栏是否显示新的 Prompt

## 注意事项

⚠️ **重要**: 标记为 ⚠️ 的日志是关键步骤,如果这些日志显示异常,问题就出在这里。

## 联系方式

如果问题仍未解决,请提供完整的日志输出,包括:
- 从 `[PromptFileService] 开始创建新 Prompt 文件` 开始
- 到 `[PromptTreeProvider] 获取到的Prompt数量` 结束
- 以及所有中间的日志和错误信息
