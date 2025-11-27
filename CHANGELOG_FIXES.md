# 修复日志 - 侧边栏不显示新建Prompt问题

## 📅 修复日期
2025-11-13

## 🐛 问题描述

**用户反馈的Bug**:
1. 侧边栏界面，点击新建Prompt，创建完保存后，侧边栏不显示新建的prompt
2. md文件的名称需要和Prompt标题关联，便于管理

## 🔍 根本原因

通过添加调试日志发现，问题出在 `promptHub.markdown.enableMirror` 配置：
- 默认值为 `false` (关闭状态)
- 导致新建的Markdown文件保存时不会同步到JSON存储
- 因此侧边栏无法显示新建的Prompt

### 为什么默认关闭？

最初设计考虑：
1. 避免干扰用户的其他Markdown文件
2. 性能考虑
3. 让用户明确选择同步模式
4. 渐进式功能启用

### 为什么应该默认开启？

实际使用发现：
1. ✅ 核心功能依赖（新建→显示）
2. ✅ 路径限制足够安全（仅处理存储目录内文件）
3. ✅ 符合用户直觉期望
4. ✅ 降低新用户学习成本

## ✅ 修复内容

### 1. 修复问题1: 新建Prompt后侧边栏不显示

#### 1.1 添加ID标记到新建文件

**文件**: `src/services/PromptFileService.ts`

**修改**: 在创建文件时自动添加ID标记

```typescript
private defaultMarkdownContent(): string {
  const id = generateId();
  return `# prompt: 在此填写标题\n\n在此编写 Prompt 正文内容...\n\n<!-- PromptHub:id=${id} -->\n`;
}
```

**作用**: 确保每个新建文件都有唯一ID，方便MarkdownMirrorService识别和同步。

#### 1.2 修改默认配置

**文件**: `package.json`

**修改**: 将 `promptHub.markdown.enableMirror` 默认值从 `false` 改为 `true`

```json
"promptHub.markdown.enableMirror": {
  "type": "boolean",
  "default": true,  // 从 false 改为 true
  "markdownDescription": "是否启用 Markdown 镜像..."
}
```

**作用**: 新安装的用户默认启用Markdown镜像功能。

#### 1.3 智能检测和提示

**文件**: `src/commands/CommandRegistrar.ts`

**修改**: 在点击"新建Prompt"时检查配置，如未启用则提示用户

```typescript
private async newPromptFile(): Promise<void> {
  const enableMirror = this.configService.get<boolean>('markdown.enableMirror', true);

  if (!enableMirror) {
    const result = await vscode.window.showInformationMessage(
      '为了让新建的Prompt显示在侧边栏，需要启用"Markdown镜像"功能。是否现在启用？',
      '启用',
      '取消'
    );

    if (result === '启用') {
      await vscode.workspace.getConfiguration('promptHub').update(
        'markdown.enableMirror',
        true,
        vscode.ConfigurationTarget.Global
      );
      vscode.window.showInformationMessage('✅ 已启用Markdown镜像，现在可以创建Prompt了');
    } else {
      vscode.window.showWarningMessage('已取消创建。提示：如需手动启用，请在设置中搜索 "promptHub.markdown.enableMirror"');
      return;
    }
  }

  const fileService = new PromptFileService(this.configService);
  await fileService.createPromptFile();
}
```

**作用**:
- 如果用户手动关闭了镜像，点击新建时会提示并询问是否启用
- 避免用户困惑"为什么看不到新建的Prompt"
- 提供一键启用功能

### 2. 修复问题2: 文件名与Prompt标题关联

**文件**: `src/services/MarkdownMirrorService.ts`

**新增方法**: `renameFileIfNeeded()`

```typescript
private async renameFileIfNeeded(
  currentPath: string,
  name: string,
  emoji?: string
): Promise<void> {
  const currentFilename = path.basename(currentPath, '.md');

  // 仅对时间戳格式的文件名进行自动重命名
  const timestampPattern = /^prompt-\d{8}-\d{6}(-\d+)?$/;
  if (!timestampPattern.test(currentFilename)) {
    return; // 用户自定义的文件名不覆盖
  }

  // 生成新文件名: emoji-标题.md
  const sanitizedName = this.sanitize(name);
  const emojiPart = emoji ? `${emoji}-` : '';
  const newFilename = `${emojiPart}${sanitizedName}.md`;
  const dir = path.dirname(currentPath);
  let newPath = path.join(dir, newFilename);

  // 处理文件名冲突
  let counter = 1;
  while (true) {
    try {
      await fs.access(newPath);
      if (path.resolve(newPath) === path.resolve(currentPath)) {
        return;
      }
      newPath = path.join(dir, `${emojiPart}${sanitizedName}-${counter}.md`);
      counter++;
    } catch {
      break;
    }
  }

  // 重命名文件并更新存储
  await fs.rename(currentPath, newPath);

  const all = this.storage.list();
  const prompt = all.find((p) => p.sourceFile === currentPath);
  if (prompt) {
    prompt.sourceFile = newPath;
    await this.storage.update(prompt);
  }

  // 关闭旧文档，打开新文档
  const oldDoc = vscode.workspace.textDocuments.find(
    (doc) => doc.uri.fsPath === currentPath
  );
  if (oldDoc) {
    await vscode.window.showTextDocument(oldDoc);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    const newDoc = await vscode.workspace.openTextDocument(newPath);
    await vscode.window.showTextDocument(newDoc, { preview: false });
  }
}
```

**调用位置**: 在 `onDidSave()` 方法更新Prompt后调用

```typescript
if (existing) {
  await this.storage.update(updated);

  // 如果启用了文件名与标题关联，检查是否需要重命名文件
  await this.renameFileIfNeeded(filePath, name, emoji);

  vscode.window.showInformationMessage(`已更新 Prompt：${name}`);
  return;
}
```

**作用**:
- 自动将 `prompt-20251113-194224.md` 重命名为 `😊-我的标题.md`
- 仅对时间戳格式的文件名生效，保护用户自定义的文件名
- 自动处理文件名冲突（添加编号后缀）
- 重命名后自动切换编辑器到新文件

**示例**:
```
创建文件: prompt-20251113-194224.md
编辑标题: # prompt: 😊 代码审查清单
保存后自动重命名为: 😊-代码审查清单.md
```

### 3. 添加调试日志

为了便于问题诊断，在关键路径添加了详细的日志：

**涉及文件**:
- `src/services/PromptFileService.ts` - 文件创建流程
- `src/services/MarkdownMirrorService.ts` - 保存同步流程
- `src/services/PromptStorageService.ts` - 存储操作
- `src/providers/PromptTreeProvider.ts` - 侧边栏刷新

**日志标签**:
- `[PromptFileService]` - 文件创建
- `[MarkdownMirrorService]` - 镜像同步
- `[PromptStorageService]` - 数据存储
- `[PromptTreeProvider]` - 树视图

**查看方式**:
1. 按 `F1` → `Developer: Toggle Developer Tools`
2. 选择 `Console` 标签
3. 筛选包含 `[Prompt` 的日志

## 📖 用户使用流程

### 修复后的正常流程

```
1. 用户点击"新建 Prompt 文件"
   ↓
2. 系统检查 markdown.enableMirror 配置
   - 如果未启用 → 提示用户启用
   - 如果已启用 → 继续
   ↓
3. 创建文件 prompt-20251113-194224.md
   内容包含自动生成的ID标记
   ↓
4. 用户编辑: # prompt: 😊 我的测试Prompt
   ↓
5. 用户保存 (Ctrl+S)
   ↓
6. MarkdownMirrorService 检测到保存事件
   ↓
7. 解析文件内容，提取: name, emoji, content, id
   ↓
8. 同步到 prompts.json
   ↓
9. 自动重命名文件为: 😊-我的测试Prompt.md
   ↓
10. 触发侧边栏刷新
    ↓
11. 侧边栏显示新的Prompt ✅
```

## 🎯 技术细节

### Markdown镜像工作原理

**双向同步**:
```
┌─────────────────┐                    ┌──────────────────┐
│  Markdown文件   │ ←─── 镜像同步 ───→ │  prompts.json    │
│  *.md           │                    │  (JSON存储)       │
└─────────────────┘                    └──────────────────┘
        ↓                                       ↓
   用户编辑保存                             程序读取
        ↓                                       ↓
   自动同步到JSON                          侧边栏显示
```

**ID标记作用**:
- 格式: `<!-- PromptHub:id=1731487123456-abc7def -->`
- 作用: 防止重复创建，确保文件和JSON数据一一对应
- 位置: Markdown文件末尾

**路径安全检查**:
```typescript
const storagePath = this.config.getStoragePath(); // ~/.prompt-hub
if (!this.isInside(storagePath, doc.uri.fsPath)) {
  return; // 跳过处理，不干扰其他文件
}
```

### 文件重命名逻辑

**时间戳检测**:
```typescript
const timestampPattern = /^prompt-\d{8}-\d{6}(-\d+)?$/;
// 匹配: prompt-20251113-194224
// 匹配: prompt-20251113-194224-1
// 不匹配: my-custom-prompt
```

**重命名规则**:
- `prompt-20251113-194224.md` → `标题.md`
- `prompt-20251113-194224.md` + emoji → `😊-标题.md`
- 冲突时: `标题.md` → `标题-1.md` → `标题-2.md` ...

## 📋 测试清单

- [x] 新建Prompt文件包含ID标记
- [x] Markdown镜像默认启用
- [x] 新建Prompt后侧边栏显示
- [x] 文件名自动关联标题
- [x] Emoji前缀正确处理
- [x] 文件名冲突自动处理
- [x] 用户自定义文件名不被覆盖
- [x] 未启用镜像时智能提示
- [x] 调试日志完整准确
- [x] TypeScript编译通过

## 📚 相关文档

- [DEBUG_GUIDE.md](./DEBUG_GUIDE.md) - 调试日志使用指南
- [package.json](./package.json#L241-L246) - 配置说明

## 🔄 后续优化建议

### 1. 首次使用向导
```typescript
// 在插件首次激活时显示
if (isFirstTime) {
  showOnboardingWizard();
}
```

### 2. 配置预设模板
```typescript
// 允许用户选择不同的使用模式
- 纯Markdown模式
- 混合模式（默认）
- 纯JSON模式
```

### 3. 批量导入功能
```typescript
// 支持从现有Markdown文件批量导入
promptHub.importFromFolder()
```

### 4. 文件监视优化
```typescript
// 使用文件监视器替代保存事件
vscode.workspace.createFileSystemWatcher('**/*.md')
```

## ✨ 总结

通过这次修复，我们：

1. ✅ 解决了新建Prompt不显示的核心问题
2. ✅ 实现了文件名与标题自动关联
3. ✅ 添加了完整的调试日志系统
4. ✅ 提供了智能的用户提示
5. ✅ 改善了新用户体验

**核心改进**: 从"需要手动配置才能使用"变为"开箱即用"，大大降低了使用门槛。
