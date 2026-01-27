# 多来源文件夹双向同步 - 设计方案

本设计面向 VSCode 插件，目标是在 **不改变本地路径** 的前提下，将多个来源文件夹镜像到 Git 仓库中统一管理，并提供清晰可视的“远端更新”提示与手动同步流程。

## 1. 目标

- 多来源文件夹可配置、可扩展（prompt / config / log / custom）。
- 本地路径保持不变，仓库只维护“镜像结构”。
- 双向同步但 **不自动改动**，由用户在 UI 中选择执行。
- 侧边栏清晰展示来源、文件状态、远端更新与冲突。
- 仓库不暴露本地真实路径（默认匿名化）。

## 2. 范围与非目标

**范围**
- Git 远程仓库作为同步后端。
- 文件级别的差异展示与选择性应用。
- 基础冲突提示与手动处理入口。

**非目标**
- 自动三方合并、复杂的冲突自动解决。
- 替代完整 Git 客户端（复杂分支/历史操作）。

## 3. 术语

- **Source**：一个来源配置，包含 `local_root` 和 `repo_root`。
- **Repo Root**：仓库中的镜像起始目录，如 `prompt/main`。
- **Local Root**：本地真实路径，如 `/Users/nita/Prompts`。
- **Mirror**：Repo Root 下的文件结构，保持与 Local Root 的相对路径一致。

## 4. 目录结构与元数据

### 4.1 仓库目录（可版本化）

```
<repo>/
  prompt/
  config/
  logs/
  meta/
    manifest.json
```

### 4.2 仓库元数据（可版本化）

`meta/manifest.json` 只存 **匿名化信息**，不含本地真实路径。

```json
{
  "version": 1,
  "sources": [
    {
      "id": "prompts-main",
      "label": "Prompts",
      "type": "prompt",
      "repo_root": "prompt/main",
      "scope": "shared"
    }
  ]
}
```

### 4.3 本地配置（不入库）

位置建议：`context.globalStorageUri/sources.json`（VSCode 全局存储）。

```json
{
  "version": 1,
  "sources": [
    {
      "id": "prompts-main",
      "local_root": "/Users/nita/Prompts",
      "include": ["**/*.md"],
      "exclude": ["**/tmp/**"],
      "follow_symlinks": false
    }
  ]
}
```

## 5. 数据模型

```ts
type SourceType = 'prompt' | 'config' | 'log' | 'custom';

interface RepoSourceEntry {
  id: string;
  label: string;
  type: SourceType;
  repo_root: string;
  scope?: 'shared' | 'device' | 'profile';
}

interface LocalSourceEntry {
  id: string;
  local_root: string;
  include?: string[];
  exclude?: string[];
  follow_symlinks?: boolean;
}

type ChangeKind =
  | 'clean'
  | 'local_modified'
  | 'repo_modified'
  | 'remote_modified'
  | 'conflict'
  | 'local_missing'
  | 'repo_missing'
  | 'remote_missing';
```

## 6. 路径映射与“应用到本地路径”的确定规则

**核心规则**：本地与仓库 **相对路径一致**，只改变根目录。

### 6.1 本地 → 仓库

```
repo_path = repo_root + relative(local_root, local_path)
```

### 6.2 仓库 → 本地

```
local_path = local_root + relative(repo_root, repo_path)
```

### 6.3 来源匹配规则

1. 以 `repo_root` 作为前缀匹配仓库路径。
2. 命中 `repo_root` 的 Source 即为目标来源。
3. 若同时命中多个来源（repo_root 重叠），视为 **非法配置**，阻止同步并提示用户修复。
4. 若没有命中来源，显示为“未归属文件”，仅展示不应用。

### 6.4 示例

```
source:
  repo_root = "prompt/main"
  local_root = "/Users/nita/Prompts"

repo_path   = prompt/main/ai/idea.md
local_path  = /Users/nita/Prompts/ai/idea.md
```

这就是“应用到本地路径”的确定方式：**通过 Source 映射 + 相对路径拼接**。

## 7. 差异计算与状态展示

### 7.1 本地 vs 仓库（镜像）

- 扫描 `local_root`（遵循 include/exclude）。
- 计算对应 `repo_path` 的文件是否存在、内容哈希是否一致。

### 7.2 远端更新检测

1. `git fetch` 拉取远端。
2. `git diff --name-status HEAD..origin/<branch>` 得到远端变更路径列表。
3. 根据 `repo_root` 将变更映射到 Source。

### 7.3 状态聚合

```
本地有改动      => ↑ local_modified
远端有改动      => ↓ remote_modified
本地与远端均有  => ↕ conflict
本地缺失        => ⚠ local_missing
仓库缺失        => ⚠ repo_missing
无变化          => • clean
```

## 8. UI 设计（侧边栏 TreeView）

```
Sources
  Prompts   [↑]
    ai/idea.md        [↑]
    ops/checklist.md  [↓]
  Configs   [↕]
    appA/settings.toml [↕]
```

- Source 节点显示汇总状态。
- 文件节点显示细粒度状态。
- 右键菜单：`查看 Diff` / `应用到本地` / `应用到仓库` / `忽略`
- 提供“只扫描不操作”的刷新按钮。

## 9. 同步策略

### 9.1 本地 → 仓库

1. 复制本地文件到 `repo_root` 镜像目录。
2. 由用户确认后执行 `git add` / `git commit` / `git push`。

### 9.2 远端 → 本地

**推荐策略（稳定）**

1. 用户点击“接受远端更新”。
2. 执行 `git pull --ff-only` 更新仓库。
3. 将更新后的仓库文件按映射规则应用到本地。

**说明**
- 若无法 fast-forward，则提示用户手动处理 Git 冲突。
- 这样保证仓库镜像与远端一致，避免“本地被更新但仓库仍旧旧版本”的漂移。

### 9.3 删除与重命名

- 删除默认不自动执行，显示为变更并二次确认。
- 重命名视作“删除 + 新增”。

### 9.4 冲突处理

- 不自动合并。
- 提供 Diff 视图与“选择本地/选择远端”按钮。

## 10. 跨应用配置处理

**推荐命名空间**

```
config/
  appA/
    default/...
    device-1/...
  appB/
    default/...
```

这样同名文件不会互相覆盖，应用间差异自然隔离。

## 11. 匿名化与安全

- `meta/manifest.json` 不保存真实本地路径。
- 本地真实路径仅在本机 `sources.json` 中保存。
- UI 可显示“别名 + 显示本地路径”开关，仅本地可见。

## 12. 未来扩展：服务器同步

抽象 `RemoteProvider` 接口：

```ts
interface RemoteProvider {
  listRemoteChanges(): Promise<RepoChange[]>;
  fetch(): Promise<void>;
  pullFastForward(): Promise<void>;
  push(): Promise<void>;
}
```

Git 为默认实现，后续可扩展到 WebDAV / S3 / 私有 API。

## 13. 待讨论

- 远端变更是否允许“按文件选择性接受”而不是全仓库 ff-only。
- Source 之间是否允许共享同一个 local_root（需要更严格冲突检测）。
- 是否引入“快照 hash”以减少全量扫描开销。
