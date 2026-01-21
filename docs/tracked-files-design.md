# 跟踪文件与版本归档 - 设计方案

## 1. 总体思路

在现有 `storagePath` Git 仓库内新增“跟踪归档目录”，把外部文件镜像复制进仓库并随保存自动同步。通过“下一份”命令生成新文件并更新跟踪指向。

## 2. 目录结构

```
storagePath/
  prompts.json
  .otter-tracked/
    index.json
    <trackedId>/
      2025-01-10-01.md
      2025-01-10-02.md
```

- `.otter-tracked/` 默认可配置
- 每个跟踪文件对应一个独立目录（用 id 隔离）
- 版本文件使用本地“当前文件名”作为归档文件名

## 3. 数据模型

```ts
interface TrackedFileEntry {
  id: string;
  sourcePath: string;   // 当前跟踪文件绝对路径
  label: string;        // 展示用名称（默认 basename）
  createdAt: string;
  updatedAt: string;
}

interface TrackedFileIndex {
  version: string;
  entries: TrackedFileEntry[];
}
```

## 4. 核心流程

### 4.1 开始跟踪

1. 用户选择文件
2. 创建 `trackedId` 与归档目录
3. 复制文件到归档目录
4. 写入 `index.json`
5. 触发 Git 同步

### 4.2 自动同步

1. 监听保存/文件变更
2. 将源文件复制到归档目录（同名覆盖）
3. 延迟触发 `GitSyncService.sync()`

### 4.3 生成下一份

1. 根据模板生成新文件名（同目录）
2. 复制当前文件 → 新文件
3. 更新 `sourcePath` 指向新文件
4. 复制新文件至归档目录
5. 触发 Git 同步

### 4.4 删除处理

1. 检测到被跟踪文件删除
2. 弹窗确认是否删除远端归档文件
3. 根据选择删除归档文件或保留
4. 从 `index.json` 移除条目
5. 触发 Git 同步

## 5. 文件名模板

- 模板占位符：`{date}`、`{index}`、`{basename}`、`{ext}`
- 默认模板：`{date}-{index}{ext}`
- `index` 默认从 `01` 开始，按同日递增

## 6. VS Code 集成

### 6.1 命令

- `Otter: 跟踪文件`
- `Otter: 取消跟踪`
- `Otter: 新建下一份（归档）`

### 6.2 右键入口

- Editor / Explorer 右键菜单中的 Otter 子菜单

### 6.3 文件标记

- 使用 `FileDecorationProvider` 标记被跟踪文件（badge: `T`）

## 7. 与 Git 同步的关系

- 不新增远程仓库
- 归档目录位于现有 `storagePath` 仓库中
- 所有同步逻辑复用 `GitSyncService`

## 8. 容错与边界

- 跟踪文件不存在时跳过同步并提示
- 归档目录不可写时提示错误
- 如果 `baseDir` 不在 `storagePath` 内，拒绝执行

## 9. 未来扩展

- 跟踪文件树视图
- 归档回溯/一键打开历史版本
- 多模板与规则化命名
