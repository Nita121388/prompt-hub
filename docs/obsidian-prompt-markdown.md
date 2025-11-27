# Obsidian 风格 Prompt Markdown 改造方案

> 本文档基于现有实现给出“先保留 JSON 存储层，只升级 Markdown 为 Obsidian 风格”的改造方案，并预留未来演进空间。

---

## 1. 设计目标与范围

### 1.1 总体目标

- 让 Prompt 的 Markdown 文件格式尽量贴合 Obsidian 生态：
  - 使用 YAML frontmatter 描述元数据；
  - 使用标准 Markdown H1 作为标题；
  - 支持标签（tags）、emoji 等。
- **保留现有 JSON 存储层**（`prompts.json` + `PromptStorageService`）作为主存，不推倒重来。
- 增强 Markdown ⇄ JSON 的同步能力，避免数据不一致。

### 1.2 相关模块

- `PromptFileService`：新建 Prompt 时生成 Markdown 模板、打开文件。
- `MarkdownMirrorService`：监听 Markdown 保存并同步到 JSON 存储。
- `SelectionParser`：从正文中解析标题 / emoji / 内容。
- `PromptStorageService`：以 JSON 形式持久化 `Prompt[]`，对外提供 CRUD / 搜索能力。

---

## 2. 存储架构与本期决策

### 2.1 现有架构（简化）

- `prompts.json` 是 **唯一持久化主存**：
  - 所有 Prompt CRUD / 搜索 / 排序都通过 `PromptStorageService` 操作 JSON。
  - Markdown 文件目前是通过镜像机制生成或同步的“表现层”。
- `MarkdownMirrorService`：
  - 监听存储目录内的 `.md` 保存事件；
  - 在启用镜像功能时，将 Markdown 内容解析后写回 JSON。

### 2.2 本期改造范围

- **只做以下改动**：
  - 统一 Markdown 文件格式为 Obsidian 风格（frontmatter + 标题 + 正文）。
  - 新增/调整解析与导出逻辑，让 JSON 与新格式 Markdown 保持同步。
  - 保持 `PromptStorageService` 接口和 `prompts.json` 文件不变。
- **不做的事情（本期明确不做）**：
  - 不删除 JSON 层，不把 Markdown+YAML 直接升级为“唯一真实数据源”。
  - 不大改依赖 `PromptStorageService` 的业务逻辑（TreeView、命令等）。

### 2.3 JSON 的角色定位

- 作为集中索引和缓存：
  - 一次性加载所有 Prompt；
  - 支持快速搜索、排序、分页等场景；
  - 便于未来在这里加入更多统计字段（使用次数、最近调用时间等）。
- 作为扩展字段的承载层：
  - 一些不适合写回 frontmatter 的字段——例如 AI 使用日志、内部状态、版本信息——继续只存在于 JSON。

### 2.4 未来演进方向（仅设计预留）

后续如果实践证明“纯 Markdown+YAML”足以承担全部需求，可以考虑：

- 将 Markdown+YAML 视为唯一真实数据源；
- 把 `prompts.json` 退化为“可重建的索引缓存”（类似搜索索引）：
  - 启动时可以扫描所有 `.md` 重建；
  - 删除 JSON 不会损坏数据，只会影响性能；
- 或者通过抽象存储接口，使后端可以在“本地 JSON / 纯 Markdown / 远程存储”之间切换。

> 本文剩余部分均围绕“**保留 JSON，升级 Markdown**”这一前提展开。

---

## 3. 目标 Markdown 格式（Obsidian 风格）

### 3.1 推荐文件结构

```markdown
---
id: 1764064469730-8brv6jr
type: prompt
emoji: 📜
tags: [prompt, code/review]
---

# 📜 代码审查助手

## 使用场景
- 用于审查 TypeScript/React 代码的风格与潜在 bug

## 角色设定
你是一名资深全栈工程师，擅长 TypeScript 和 React…

## 输入格式
- 用户会提供：
  - 代码片段
  - 预期行为描述（可选）

## 输出要求
- 用分点方式描述问题
- 对每个问题给出修复建议

## Prompt 内容
请根据上面的规则，审查以下代码：
```

### 3.2 字段与数据模型映射

- `id` → `Prompt.id`
  - 与现有 HTML 注释 `<!-- PromptHub:id=... -->` 冗余；
  - 过渡期建议两者都写，解析时优先 frontmatter。
- `type` → 固定为 `"prompt"`：
  - 为未来扩展其他类型（如 `"snippet"`、`"template"`）预留。
- `emoji` → `Prompt.emoji`
- `tags` → `Prompt.tags`（数组）
- 标题（H1）：
  - 形式：`# 标题` 或 `# 😄 标题`；
  - 去掉前导 emoji 后作为 `Prompt.name`。
- 正文（content）：
  - 从 H1 下一行开始到文件末尾；
  - 作为 `Prompt.content`。

---

## 4. 解析与同步方案概览

### 4.1 数据流概念

一次完整的更新链路包括三层：

1. Markdown 文件中的 Obsidian 风格内容；
2. 解析后的内存 Prompt 对象；
3. JSON 存储中的 Prompt 记录。

保存 Markdown 时：

- 读取文件文本 `text`；
- 通过 `MarkdownPromptParser` 解析出 `{ id, name, emoji, tags, content }`；
- 通过 `MarkdownMirrorService` 查找/更新对应的 `Prompt`；
- 调用 `PromptStorageService.update` / `add` 写入 JSON；
- 如有需要，再通过 `composeMarkdown` 将 JSON 中 Prompt 导出到其他 Markdown（当前导出暂时关闭，仅保留能力）。

### 4.2 关键组件划分

- `MarkdownPromptParser`：
  - 封装“frontmatter + 标题 + 正文”解析逻辑；
  - 负责容错（frontmatter 缺失/不合法时回退到原有解析方式）。
- `SelectionParser`：
  - 继续负责从正文第一行提取标题 / emoji；
  - 不直接关心 frontmatter，只处理“文本 body”部分。
- `MarkdownMirrorService`：
  - 在 `onDidSave` 中使用 `MarkdownPromptParser`；
  - 将解析结果合并到 Prompt，并写回 JSON。
- `PromptFileService`：
  - 新建文件时写入 Obsidian 风格模板；
  - 按需生成前后一致的 `id`（frontmatter 与 HTML 注释共用）。

---

## 5. 关键实现点（概要）

> 此处只描述核心设计要点，具体代码实现可以在实际开发时展开。

### 5.1 MarkdownPromptParser（统一解析器）

位置建议：`src/utils/MarkdownPromptParser.ts`

接口示例：

```ts
export interface ParsedMarkdownPrompt {
  id?: string;
  name?: string;
  emoji?: string;
  tags?: string[];
  content: string;
}

export class MarkdownPromptParser {
  constructor(private configService: ConfigurationService) {}

  parse(text: string): ParsedMarkdownPrompt {
    // 1. 解析 frontmatter，得到 meta = { id, name, emoji, tags, ... }
    // 2. 去掉 frontmatter 后得到 body，再交给 SelectionParser 解析标题/emoji/正文
    // 3. 按优先级合并 meta 与正文解析结果
  }
}
```

行为要点：

- 如首行是 `---`，向下搜索下一行 `---`，中间视为 frontmatter：
  - 解析 `id/name/emoji/tags/type` 等；
  - 解析失败时记录日志并回退到“无 frontmatter 模式”。
- 去掉 frontmatter 后得到 `bodyText`，交给 `SelectionParser.parse(bodyText)`：
  - 兼容已有 `# prompt: ...` 和 `# Title` 规则；
  - 可复用现有测试。
- 合并策略：
  - `id`：只从 frontmatter 读取，找不到再由 `MarkdownMirrorService` 去 HTML 注释里找；
  - `name` / `emoji`：frontmatter 优先，其次正文标题；
  - `tags`：只从 frontmatter 读取，默认空数组；
  - `content`：采用 `SelectionParser` 返回的正文（去掉标题行）。

### 5.2 MarkdownMirrorService（保存时同步）

文件：`src/services/MarkdownMirrorService.ts`

在 `onDidSave` 中的主要改动：

1. 使用 `MarkdownPromptParser` 替换直接使用 `SelectionParser`：

```ts
const parser = new MarkdownPromptParser(this.config);
const parsed = parser.parse(text);

const filePath = doc.uri.fsPath;
const fallbackName = path.basename(filePath, path.extname(filePath));
let name = parsed.name?.trim() || fallbackName;

if (name === '在此填写标题') {
  name = fallbackName;
}

const content = parsed.content.trim();
const emoji = parsed.emoji;
const tags = parsed.tags ?? [];

const idInFile = parsed.id || this.extractIdMarker(text);
```

2. 更新/新建 Prompt 时写入 tags：

```ts
const updated: Prompt = {
  ...existing,
  name,
  emoji,
  content,
  tags: tags.length ? tags : existing.tags ?? [],
  updatedAt: new Date().toISOString(),
  sourceFile: filePath,
};
```

```ts
const base: Omit<Prompt, 'id'> = {
  name,
  emoji,
  content,
  createdAt: now,
  updatedAt: now,
  sourceFile: filePath,
  tags,
};
```

3. ID 优先级：

- `frontmatter.id` > HTML 注释中的 `PromptHub:id` > 依赖 `sourceFile` 匹配。

4. 导出 Markdown（`composeMarkdown`）：

- 输出 Obsidian 风格 Markdown：
  - 前面加 frontmatter；
  - 标题使用 `# [emoji ]name`；
  - 末尾保留 `<!-- PromptHub:id=... -->` 作为兼容标记。

### 5.3 PromptFileService（新建文件模板）

文件：`src/services/PromptFileService.ts`

将 `defaultMarkdownContent()` 调整为：

```ts
private defaultMarkdownContent(): string {
  const id = generateId();
  return [
    '---',
    `id: ${id}`,
    'type: prompt',
    'tags: [prompt]',
    '---',
    '',
    '# 在此填写标题',
    '',
    '在此编写 Prompt 正文内容...',
    '',
    `<!-- PromptHub:id=${id} -->`,
    '',
  ].join('\n');
}
```

备用同步逻辑中，如需从内容中提取名称，建议兼容标准 H1：

```ts
const titleMatch =
  content.match(/^#\s*prompt\s*:\s*(.+)$/im) ||
  content.match(/^#\s+(.+)$/m);
```

或者直接复用 `SelectionParser`。

---

## 6. 单元测试与验证（概要）

### 6.1 新增/扩展的测试文件

- `src/test/suite/MarkdownPromptParser.test.ts`（新增）
  - 完整 Obsidian 格式解析；
  - 无 frontmatter 时回退到当前行为；
  - tags 多种写法解析为统一数组。
- `src/test/suite/MarkdownMirrorService.test.ts`（新增）
  - 保存 Obsidian 格式文件时能正确创建/更新 Prompt；
  - 优先按 frontmatter.id 更新，缺失时回退到注释 id；
  - 默认标题占位符时使用文件名。
- `src/test/suite/PromptFileService.test.ts`（新增或扩展）
  - 默认模板包含 frontmatter + H1 + 注释 id；
  - frontmatter.id 与注释 id 一致。
- `src/test/suite/SelectionParser.test.ts`
  - 如对其行为有改动，需补充“带 frontmatter 的正文解析”相关用例。

### 6.2 手工验证建议

- 在 VSCode 中新建 Prompt：
  - 检查生成的 Markdown 是否符合 Obsidian 风格；
  - 在侧边栏 TreeView 中能立即看到新 Prompt。
- 在 Obsidian 中打开存储目录：
  - frontmatter 字段能被 Dataview 等插件识别；
  - 手动修改标题 / tags 后回到 VSCode 保存，检查是否同步到 JSON。
- 旧格式文件（无 frontmatter，仅有 `# prompt:` + 注释）：
  - 保存后能自动被解析并同步；
  - 不要求自动升级格式，但行为不应退化。

---

## 7. 实施 Checklist（简版）

1. **解析层**
   - [ ] 新增 `MarkdownPromptParser` 并通过单元测试。
2. **同步层**
   - [ ] 修改 `MarkdownMirrorService.onDidSave` 使用 `MarkdownPromptParser`。
   - [ ] 扩展 `composeMarkdown` 输出 frontmatter + H1 + 注释 id。
3. **模板层**
   - [ ] 修改 `PromptFileService.defaultMarkdownContent` 为 Obsidian 风格模板。
4. **测试与验收**
   - [ ] 补齐 `MarkdownPromptParser` / `MarkdownMirrorService` / `PromptFileService` 的测试。
   - [ ] 运行现有测试，确保改动不破坏原有行为。
   - [ ] 按 6.2 的建议进行一次手工回归。

> 执行时可以按“解析 → 同步 → 模板 → 测试”的顺序小步提交，降低一次性改动风险。

