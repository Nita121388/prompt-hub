# Otter 测试数据（用于手工测试 Prompt）

这个目录提供一套可复用的测试 Prompt（`prompts.json` + 对应的 Markdown 源文件），用于快速验证：

- Prompt 列表加载/排序
- Markdown 导入与 `prompts.json` 关联（基于 `frontmatter.id`）
- AI 生成元信息 / AI 优化（尤其是中文内容）
- Markdown 内容包含代码块、表格、特殊符号时的解析稳定性

## 使用方法（推荐）

1. 在 VSCode 设置里将 `otter.storagePath` 指向本目录：

   - Windows 示例：`f:\\File\\Projects\\otter\\upstream\\testdata\\prompt-storage`
   - 或使用工作区路径：`${workspaceFolder}/upstream/testdata/prompt-storage`

2. 重载窗口（`Developer: Reload Window`）。

3. 打开侧边栏 `Otter`，应能看到 3 条测试 Prompt。

## 数据说明

- `prompts.json`：内置 3 条 Prompt（不包含 `sourceFile`，便于跨机器复用）
- `01-需求分析模板.md` / `02-代码审查清单.md` / `03-AI优化-中文编码测试.md`：
  - 每个文件都有 `frontmatter.id`，与 `prompts.json` 中的 `id` 对齐
  - 初始化时会自动把 Markdown 与 JSON 记录绑定（填充 `sourceFile`），避免导入重复项

## 常见验证点

- AI 优化后是否仍保持中文不乱码（尤其是标题、标点、emoji、代码块）
- 保存 Markdown 文件后 TreeView 是否会出现重复条目
- Markdown frontmatter 里 `tags` 是否能被正确读取并保留

