# 修复重复ID标记问题

## 🐛 问题描述

由于之前的bug，每次保存Markdown文件时都会追加新的ID标记，导致文件中出现多个重复的ID：

```markdown
# prompt: test2-1

在此编写 Prompt 正文内容...

<!-- PromptHub:id=1763035283306-55j7id9 -->

<!-- PromptHub:id=1763035293146-hab7sbh -->

<!-- PromptHub:id=1763035303909-2c42piv -->
```

## ✅ 已修复的问题

### 1. 禁用了自动导出功能

**文件**: `src/services/MarkdownMirrorService.ts`

**原因**: `bindOnStorageChange()` 方法会在每次存储变更时自动导出所有Prompt到Markdown文件，这会：
- 覆盖用户正在编辑的文件
- 触发新的保存事件
- 导致无限循环

**修复**: 禁用了自动导出功能，改为仅单向同步（Markdown → JSON）

```typescript
bindOnStorageChange(context: vscode.ExtensionContext): void {
  // 暂时禁用自动导出，避免循环触发和覆盖用户编辑
  console.log('[MarkdownMirrorService] 跳过绑定存储变更事件（避免覆盖用户编辑）');
}
```

### 2. 优化了重命名逻辑

**问题**: 重命名文件时调用 `storage.update()` 会触发变更事件，可能导致循环

**修复**: 直接修改prompt对象并手动保存，不触发事件

```typescript
// 直接修改，不调用update以避免触发事件
prompt.sourceFile = newPath;
// 手动保存，但不触发事件
await this.storage['save']();
```

## 🔧 如何修复已存在的文件

### 方法1: 使用自动修复脚本（推荐）

**步骤**:

1. 打开终端，进入项目目录
   ```bash
   cd f:\File\Projects\prompt-hub\upstream
   ```

2. 运行修复脚本
   ```bash
   node scripts/fix-duplicate-ids.js
   ```

3. 查看输出，确认修复结果
   ```
   扫描完成！
     总计: 10 个Markdown文件
     修复: 3 个文件
     跳过: 7 个文件（无需修复）
   ```

**自定义存储路径**:
```bash
node scripts/fix-duplicate-ids.js "C:\Users\你的用户名\.prompt-hub"
```

### 方法2: 手动修复

**步骤**:

1. 打开有问题的Markdown文件
2. 找到所有的ID标记行（格式: `<!-- PromptHub:id=xxx -->`）
3. 保留第一个ID标记
4. 删除其他所有重复的ID标记
5. 保存文件

**示例**:

修复前:
```markdown
# prompt: test2-1

在此编写 Prompt 正文内容...

<!-- PromptHub:id=1763035283306-55j7id9 -->
<!-- PromptHub:id=1763035293146-hab7sbh -->
<!-- PromptHub:id=1763035303909-2c42piv -->
```

修复后:
```markdown
# prompt: test2-1

在此编写 Prompt 正文内容...

<!-- PromptHub:id=1763035283306-55j7id9 -->
```

## 📊 修复脚本的工作原理

```javascript
1. 扫描指定目录下的所有.md文件
   ↓
2. 读取每个文件的内容
   ↓
3. 查找所有ID标记行（使用正则表达式）
   ↓
4. 如果找到多个ID标记
   ├─ 保留第一个ID标记
   └─ 删除所有其他ID标记
   ↓
5. 写回文件
   ↓
6. 报告修复结果
```

## 🎯 验证修复

修复后，请验证：

1. ✅ 每个Markdown文件只有一个ID标记
2. ✅ 保存文件后不会再出现新的ID标记
3. ✅ 侧边栏正常显示Prompt
4. ✅ 文件名正常关联标题

## 🔍 调试

如果问题仍然存在，请检查日志：

```
1. 按 F1 → Developer: Toggle Developer Tools
2. 查看 Console 标签
3. 筛选 [MarkdownMirrorService] 日志
4. 查看是否有异常或错误
```

关键日志：
```
[MarkdownMirrorService] 跳过绑定存储变更事件（避免覆盖用户编辑）
[MarkdownMirrorService] 检测到文件保存事件: ...
[MarkdownMirrorService] 提取的ID标记: ...
```

## 📚 技术细节

### 为什么会出现重复ID？

**原始设计流程**:
```
1. 用户保存Markdown文件
   ↓
2. MarkdownMirrorService.onDidSave() 触发
   ↓
3. 同步到JSON存储
   ↓
4. 触发 storage.onDidChangePrompts 事件
   ↓
5. MarkdownMirrorService.exportAllToMarkdown() 触发
   ↓
6. 重新导出所有Prompt到Markdown文件
   ↓
7. 覆盖用户刚刚编辑的文件（添加新的ID标记）
   ↓
8. 回到步骤1（触发新的保存事件）
   ↓
9. 无限循环 ❌
```

### 修复后的流程

**新流程**（单向同步）:
```
1. 用户保存Markdown文件
   ↓
2. MarkdownMirrorService.onDidSave() 触发
   ↓
3. 同步到JSON存储
   ↓
4. 触发 storage.onDidChangePrompts 事件
   ↓
5. 刷新侧边栏
   ↓
6. 结束 ✅（不再导出到Markdown）
```

## 🎉 总结

通过这次修复：

1. ✅ 禁用了会导致循环的自动导出功能
2. ✅ 优化了重命名逻辑，避免触发多余事件
3. ✅ 提供了自动修复脚本清理历史问题
4. ✅ 添加了详细的日志帮助调试

现在保存Markdown文件时：
- ✅ 只会同步到JSON存储
- ✅ 不会再追加新的ID标记
- ✅ 不会覆盖用户的编辑内容
- ✅ 侧边栏正常刷新显示
