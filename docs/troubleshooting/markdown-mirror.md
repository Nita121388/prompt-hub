# Markdown 镜像（MarkdownMirrorService）常见问题排查

本页汇总与 **Markdown ⇄ JSON 镜像同步** 相关的常见问题、根因解释与修复手段，用于替代仓库根目录下零散的排障文档。

## 适用范围

- 仅针对 **Prompt 存储目录** 内的 `.md` 文件。
- 依赖配置项：`otter.markdown.enableMirror`。

当你遇到以下现象时，优先按本文排查：

- 新建 Prompt 文件后侧边栏不显示
- 保存 `.md` 后没有同步到 `prompts.json`
- 文件名没有按标题/emoji 自动关联
- `.md` 文件中出现多个 `<!-- Otter:id=... -->` 重复标记（兼容旧版 `PromptHub:id`）

---

## 快速自检（建议按顺序）

1. **确认镜像已启用**
   - 设置里搜索 `otter.markdown.enableMirror`，确认是 `true`。
2. **确认文件在存储目录内**
   - 镜像逻辑应当只处理存储目录内文件，避免干扰其他 Markdown。
3. **确认插件已完整激活**
   - 打开开发者工具 Console，确认能看到插件激活与服务初始化相关日志。
4. **确认编译产物是最新**
   - 若你在调试扩展，修改代码后请重新编译并重启调试会话。

---

## 场景 1：新建 Prompt 后侧边栏不显示

### 常见根因

- `otter.markdown.enableMirror` 处于关闭状态，导致新建 `.md` 的保存不会同步回 JSON 存储。
- 保存事件监听器未绑定（例如插件激活流程提前退出或编译产物未更新）。

### 推荐处理

1. 将 `otter.markdown.enableMirror` 设为 `true`，重启 VSCode/重启调试。
2. 新建 Prompt 后，手动 `Ctrl+S` 保存一次，观察 Console 是否出现镜像相关日志。

---

## 场景 2：保存事件未触发（onDidSaveTextDocument 没反应）

### 现象

- 你能看到“文件已保存/已创建完成”之类日志，但看不到 `MarkdownMirrorService` 的“开始绑定/保存事件触发”日志。

### 诊断步骤

1. **确认插件完整激活**
   - 从“插件正在激活…”开始，检查是否出现关键初始化日志（存储初始化、TreeProvider 初始化等）。
2. **确认 MarkdownMirrorService 初始化与绑定**
   - 检查激活逻辑中是否调用了 `mirrorService.bindOnSave(context)`。
3. **重新编译并重启调试**
   - 在项目目录执行：
     - `npm run compile`
   - 然后 `Shift+F5` 停止调试、`F5` 重启。

### 临时绕过（仅用于快速验证链路）

如果你怀疑事件监听本身存在问题，可以在保存后通过代码路径“直接调用同步逻辑”做一次验证（不建议长期保留该方案，避免耦合与重复同步）。

---

## 场景 3：文件名未关联标题/emoji（或你不希望被自动改名）

### 设计要点

- 自动重命名通常只针对“时间戳格式”的默认文件名（例如 `prompt-20251113-194224.md`）。
- 用户自定义文件名应当默认不被覆盖。

### 你可以这样做

- 如果希望自动关联：使用默认时间戳文件名新建，然后在文件内填写标题并保存，让插件完成改名。
- 如果不希望被改名：新建时直接使用自定义文件名（不匹配时间戳模式）。

---

## 场景 4：Markdown 文件出现重复 ID 标记

### 现象

同一个文件出现多个类似行：

```markdown
<!-- Otter:id=1763035283306-55j7id9 -->
<!-- Otter:id=1763035293146-hab7sbh -->
```

### 根因（典型）

早期实现曾出现“保存触发导出、导出再触发保存”的循环链路，导致每次保存都追加新的 ID 标记。

### 修复已有文件（推荐脚本）

项目提供了脚本用于批量清理重复 ID（保留第一个，删除其余）：

```bash
node scripts/fix-duplicate-ids.js
```

也支持指定自定义存储路径：

```bash
node scripts/fix-duplicate-ids.js "C:\\Users\\你的用户名\\.otter"
```

### 手动修复

1. 打开有问题的 `.md` 文件
2. 找到所有 `<!-- Otter:id=... -->`（旧版 `PromptHub:id` 也需要清理）
3. 保留第一个，删除其他重复行

---

## 日志采集建议

1. `F1 → Developer: Toggle Developer Tools`
2. Console 中筛选与 `MarkdownMirrorService`、`PromptFileService` 相关前缀日志
3. 复现问题：新建/编辑/保存
4. 导出或复制从“插件激活”到“保存同步”的完整日志片段，便于定位链路中断点

