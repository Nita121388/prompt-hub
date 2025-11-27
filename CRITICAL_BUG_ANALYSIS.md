# 关键Bug分析 - MarkdownMirrorService 保存事件未触发

## 🚨 当前状态

**问题**: 新建Prompt文件后，即使调用了 `doc.save()`，`MarkdownMirrorService.onDidSave` 事件也没有触发，导致Prompt无法同步到侧边栏。

## 📊 日志分析

### 你的日志显示：

```
[PromptFileService] 文档已保存，应该触发MarkdownMirrorService.onDidSave事件
[PromptFileService] 新 Prompt 文件创建完成
```

### 缺失的日志（应该出现但没有出现）：

```
❌ [MarkdownMirrorService] 开始绑定保存事件监听器
❌ [MarkdownMirrorService] 保存事件监听器已绑定
❌ [MarkdownMirrorService] ===== 保存事件触发 =====
```

## 🔍 可能的原因

### 1. MarkdownMirrorService 没有初始化
- `mirrorService.bindOnSave(context)` 可能没有执行
- 或者执行时发生了异常但被吞掉了

### 2. 编译产物没有更新
- 修改的代码没有被重新编译
- 或者VSCode加载的是旧版本

### 3. 插件激活流程有问题
- extension.ts 的 activate 函数可能提前返回
- 或者抛出异常导致后续代码没执行

## 🧪 诊断步骤

### 第1步: 确认插件完整激活

在重新启动调试后，查找这些关键日志：

```
✅ 必须出现：
Prompt Hub 插件正在激活...
Prompt 存储初始化成功，加载了 X 个 Prompt
[PromptTreeProvider] 初始化TreeProvider
Prompt Hub 已激活
Prompt Hub 插件激活成功
```

如果缺少任何一行，说明激活过程中出错了。

### 第2步: 检查 MarkdownMirrorService 初始化

**需要添加的日志**（我已经在代码中添加，需要重新编译）：

在 `extension.ts` 第37-40行应该有：
```typescript
console.log('[Extension] 开始初始化 MarkdownMirrorService');
const mirrorService = new MarkdownMirrorService(storageService, configService);
console.log('[Extension] MarkdownMirrorService 已创建');
mirrorService.bindOnSave(context);
console.log('[Extension] bindOnSave 已调用');
mirrorService.bindOnStorageChange(context);
console.log('[Extension] bindOnStorageChange 已调用');
```

然后在 `MarkdownMirrorService.ts` 的 `bindOnSave()` 方法中：
```typescript
console.log('[MarkdownMirrorService] 开始绑定保存事件监听器');
// ... 绑定代码 ...
console.log('[MarkdownMirrorService] 保存事件监听器已绑定');
```

### 第3步: 验证保存事件

创建文件后应该看到：
```
[MarkdownMirrorService] ===== 保存事件触发 =====
[MarkdownMirrorService] 触发文件: C:\Users\break\.prompt-hub\prompt-xxx.md
```

## 🛠️ 手动修复步骤

如果自动编译有问题，请手动执行：

### 1. 停止当前调试
```
按 Shift+F5
```

### 2. 清理并重新编译
```bash
cd f:\File\Projects\prompt-hub\upstream
npm run compile
```

### 3. 检查编译输出
```bash
# 确认 out/ 目录已更新
ls -l out/extension.js
ls -l out/services/MarkdownMirrorService.js
```

### 4. 重新启动调试
```
按 F5
```

### 5. 收集完整日志

从调试开始，收集以下所有日志：
```
1. 插件激活日志
2. MarkdownMirrorService 初始化日志
3. 新建文件日志
4. 保存事件日志
```

## 🔧 临时解决方案

如果事件监听器有问题，可以尝试这个临时方案：

### 方案A: 手动触发同步

修改 `PromptFileService.ts`，在保存后直接调用同步方法：

```typescript
// 自动保存文档
await doc.save();

// 临时方案：直接触发同步（绕过事件）
const mirrorService = new MarkdownMirrorService(
  storageService,
  configService
);
await mirrorService['onDidSave'](doc);
```

但这需要传递 `storageService` 到 `PromptFileService`。

### 方案B: 使用轮询检测

在 `PromptFileService.createPromptFile()` 中添加：

```typescript
// 保存后等待一下，然后检查
await doc.save();
await new Promise(resolve => setTimeout(resolve, 500));

// 检查是否已同步
const prompts = storageService.list();
const synced = prompts.some(p => p.sourceFile === filepath);
if (!synced) {
  vscode.window.showWarningMessage(
    '⚠️ Prompt可能未同步，请手动保存文件（Ctrl+S）'
  );
}
```

## 📋 下一步行动

请按顺序执行：

1. ✅ **重新编译**
   ```bash
   cd f:\File\Projects\prompt-hub\upstream
   npm run compile
   ```

2. ✅ **重新启动调试** (Shift+F5 然后 F5)

3. ✅ **收集插件激活日志**
   - 打开开发者工具
   - 清空控制台
   - 查看从 "Prompt Hub 插件正在激活..." 开始的所有日志

4. ✅ **尝试新建Prompt**
   - 点击"新建 Prompt 文件"
   - 记录所有日志

5. ✅ **将完整日志发给我**
   - 从插件激活到文件创建的所有日志
   - 特别注意有没有红色的错误

## 🐛 可能的Bug位置

如果经过上述步骤后问题仍然存在，可能的bug位置：

1. **extension.ts**: activate 函数提前返回或异常
2. **MarkdownMirrorService.ts**: bindOnSave 方法有bug
3. **VSCode API**: onDidSaveTextDocument 事件在特定情况下不触发
4. **编译配置**: tsconfig.json 或编译流程问题

## 💡 调试建议

添加全局异常捕获：

```typescript
// 在 extension.ts 的 activate 函数最开始
process.on('uncaughtException', (err) => {
  console.error('[Extension] 未捕获的异常:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Extension] 未处理的Promise拒绝:', reason);
});
```

这样可以捕获任何被吞掉的异常。
