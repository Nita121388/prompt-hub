# 调试日志增强总结

## 🎯 目的

为 Prompt Hub 的本地 AI 集成功能（LocalClaudeProvider 和 LocalCodexProvider）添加全面的调试日志，帮助开发者和用户排查本地 CLI 调用问题。

## ✅ 完成的工作

### 1. LocalClaudeProvider.ts - 已完成（系统自动增强）

该文件在之前的实现中已被系统自动增强，包含完整的调试日志。

#### 1.1 generateMeta() 方法

**日志点：**
- 执行开始标记
- 输入内容长度（字节）
- Claude CLI 路径检测结果
- 命令构造和长度（超过 500 字符时截断显示）
- 执行耗时（毫秒）
- stderr 警告（如有）
- stdout 长度和内容（超过 500 字符时截断）
- JSON 匹配和解析结果
- 错误详情（message, code, signal, killed, stdout/stderr 预览）

**示例输出：**
```
[LocalClaudeProvider] 执行命令: claude -p --output-format text "生成 JSON..." (len=1234)
[LocalClaudeProvider] 超时设置: 120000 ms
[LocalClaudeProvider] 执行耗时: 3542 ms
[LocalClaudeProvider] stdout: {"name":"测试标题","emoji":"📝"}
```

#### 1.2 optimize() 方法

**日志点：**
- 执行开始标记
- 超时配置
- 执行耗时
- 错误详情（包括超时检测和建议）

#### 1.3 getClaudePath() 方法

**日志点：**
- 开始检测标记
- 配置路径检测（路径、解析结果、文件是否存在）
- 环境变量检测（CLAUDE_BIN/CLAUDE_PATH）
- VSCode 扩展目录检测结果
- PATH 检测结果（which/where）
- 常见路径检测
- 最终未找到警告

**示例输出：**
```
[LocalClaudeProvider] getClaudePath() 开始检测 Claude CLI 路径
[LocalClaudeProvider] 配置 local.claudePath 为空，跳过配置路径检测
[LocalClaudeProvider] 环境变量 CLAUDE_BIN/CLAUDE_PATH 未设置，跳过
[LocalClaudeProvider] 从 VSCode 扩展目录检测到 Claude CLI: C:\Users\...\claude.exe
```

#### 1.4 detectClaudeFromVSCodeExtensions() 方法

**日志点：**
- VSCode 扩展目录探测（未发现/发现）
- 每个候选扩展内置 CLI 文件检测
- 探测失败的可忽略警告

#### 1.5 detectClaudeFromPath() 方法

**日志点：**
- Windows/Unix 平台识别
- which/where 命令执行结果
- 文件存在性验证
- 探测失败的可忽略警告

#### 1.6 detectFromWhere() 方法

**日志点：**
- where 命令查找的结果数量
- 每个候选路径的解析和存在性检测
- 执行失败的可忽略警告

**示例输出：**
```
[LocalClaudeProvider] where claude.exe 找到 2 条结果
[LocalClaudeProvider] where claude.exe => C:\Users\...\claude.exe exists= true
```

#### 1.7 detectClaudePath() 方法

**日志点：**
- 开始遍历常见路径
- 每个路径的存在性检测
- 检测成功/未找到的结果

---

### 2. LocalCodexProvider.ts - 本次增强

#### 2.1 generateMeta() 方法

**新增日志点：**
- `[LocalCodexProvider] generateMeta 开始执行`
- `[LocalCodexProvider] generateMeta 输入内容长度: {contentLen} 字节`
- `[LocalCodexProvider] generateMeta 检测到 Codex 路径: {codexPath}`
- `[LocalCodexProvider] generateMeta 模型配置: {model}` 或 `(默认模型)`
- `[LocalCodexProvider] generateMeta 生成 Prompt 长度: {prompt.length} 字节`
- `[LocalCodexProvider] generateMeta 执行命令 (前500字): {command截断}`
- `[LocalCodexProvider] generateMeta 执行完成, 耗时: {elapsed}ms`
- `[LocalCodexProvider] generateMeta stderr: {stderr截断}`（如有）
- `[LocalCodexProvider] generateMeta stdout 长度: {stdout.length} 字节`
- `[LocalCodexProvider] generateMeta stdout 内容: {stdout}` 或截断显示
- `[LocalCodexProvider] generateMeta 匹配到 JSON: {jsonMatch[0]}`
- `[LocalCodexProvider] generateMeta 解析结果: {parsed}`
- `[LocalCodexProvider] generateMeta 失败: {错误详情}`（包括 message, code, signal, killed）

**示例输出：**
```
[LocalCodexProvider] generateMeta 开始执行
[LocalCodexProvider] generateMeta 输入内容长度: 1523 字节
[LocalCodexProvider] generateMeta 检测到 Codex 路径: C:\Users\break\.codex\codex.exe
[LocalCodexProvider] generateMeta 模型配置: claude-sonnet-4.5
[LocalCodexProvider] generateMeta 生成 Prompt 长度: 1600 字节
[LocalCodexProvider] generateMeta 执行命令 (前500字): "C:\Users\break\.codex\codex.exe" exec --skip-git-repo-check --sandbox read-only --model claude-sonnet-4.5 "根据以下内容生成..." (len=1700)
[LocalCodexProvider] generateMeta 执行完成, 耗时: 4235ms
[LocalCodexProvider] generateMeta stdout 长度: 45 字节
[LocalCodexProvider] generateMeta stdout 内容: {"name":"测试标题","emoji":"📝"}
[LocalCodexProvider] generateMeta 匹配到 JSON: {"name":"测试标题","emoji":"📝"}
[LocalCodexProvider] generateMeta 解析结果: { name: '测试标题', emoji: '📝' }
```

#### 2.2 optimize() 方法

**新增日志点：**
- `[LocalCodexProvider] optimize 开始执行`
- `[LocalCodexProvider] optimize 输入内容长度: {content.length} 字节`
- `[LocalCodexProvider] optimize 检测到 Codex 路径: {codexPath}`
- `[LocalCodexProvider] optimize 模型配置: {model}` 或 `(默认模型)`
- `[LocalCodexProvider] optimize 生成 Prompt 长度: {prompt.length} 字节`
- `[LocalCodexProvider] optimize 执行命令 (前500字): {command截断}`
- `[LocalCodexProvider] optimize 执行完成, 耗时: {elapsed}ms`
- `[LocalCodexProvider] optimize stderr: {stderr截断}`（如有）
- `[LocalCodexProvider] optimize stdout 长度: {stdout.length} 字节`
- `[LocalCodexProvider] optimize 返回结果长度: {result.length} 字节`
- `[LocalCodexProvider] optimize 失败: {错误详情}`（包括 message, code, signal, killed）

**示例输出：**
```
[LocalCodexProvider] optimize 开始执行
[LocalCodexProvider] optimize 输入内容长度: 2048 字节
[LocalCodexProvider] optimize 检测到 Codex 路径: C:\Users\break\.codex\codex.exe
[LocalCodexProvider] optimize 模型配置: (默认模型)
[LocalCodexProvider] optimize 执行完成, 耗时: 8542ms
[LocalCodexProvider] optimize stdout 长度: 2100 字节
[LocalCodexProvider] optimize 返回结果长度: 2095 字节
```

#### 2.3 getCodexPath() 方法

**新增日志点：**
- `[LocalCodexProvider] getCodexPath 开始检测 Codex CLI 路径`
- `[LocalCodexProvider] getCodexPath 配置 local.codexPath: {configured} => {resolved} exists= {ok}`
- `[LocalCodexProvider] getCodexPath 配置 local.codexPath 为空，跳过配置路径检测`
- `[LocalCodexProvider] getCodexPath 环境变量 CODEX_BIN: {envCodexBin} => {resolved} exists= {ok}`
- `[LocalCodexProvider] getCodexPath 环境变量 CODEX_BIN 未设置，跳过`
- `[LocalCodexProvider] getCodexPath 从 PATH 检测到 Codex CLI: {fromPath}`
- `[LocalCodexProvider] getCodexPath 未找到 Codex CLI：已尝试 配置/local.codexPath、环境变量 CODEX_BIN、PATH(where/which)、常见目录`（警告级别）

**示例输出：**
```
[LocalCodexProvider] getCodexPath 开始检测 Codex CLI 路径
[LocalCodexProvider] getCodexPath 配置 local.codexPath 为空，跳过配置路径检测
[LocalCodexProvider] getCodexPath 环境变量 CODEX_BIN: C:\Users\break\.codex\codex.exe => C:\Users\break\.codex\codex.exe exists= true
```

#### 2.4 detectCodexFromPath() 方法

**新增日志点：**
- `[LocalCodexProvider] detectCodexFromPath Windows 平台，使用 where 命令`
- `[LocalCodexProvider] detectCodexFromPath Unix/macOS 平台，使用 which 命令`
- `[LocalCodexProvider] detectCodexFromPath which codex => {first} exists= {ok}`
- `[LocalCodexProvider] detectCodexFromPath PATH 检测失败（可忽略）: {error.message}`

**示例输出：**
```
[LocalCodexProvider] detectCodexFromPath Windows 平台，使用 where 命令
```

#### 2.5 detectFromWhere() 方法

**新增日志点：**
- `[LocalCodexProvider] detectFromWhere where {name} 找到 {lines.length} 条结果`
- `[LocalCodexProvider] detectFromWhere where {name} 无结果`
- `[LocalCodexProvider] detectFromWhere where {name} => {resolved} exists= {ok}`
- `[LocalCodexProvider] detectFromWhere where {name} 执行失败（可忽略）: {error.message}`

**示例输出：**
```
[LocalCodexProvider] detectFromWhere where codex.exe 找到 1 条结果
[LocalCodexProvider] detectFromWhere where codex.exe => C:\Users\break\.codex\codex.exe exists= true
```

#### 2.6 detectCodexPath() 方法

**新增日志点：**
- `[LocalCodexProvider] detectCodexPath 开始遍历 {possiblePaths.length} 个常见路径`
- `[LocalCodexProvider] detectCodexPath 常见路径探测: {p} exists= {ok}`
- `[LocalCodexProvider] detectCodexPath 检测到 Codex: {p}`
- `[LocalCodexProvider] detectCodexPath 在常见路径中未找到 Codex`

**示例输出：**
```
[LocalCodexProvider] detectCodexPath 开始遍历 9 个常见路径
[LocalCodexProvider] detectCodexPath 常见路径探测: C:\Users\break\.codex\codex.exe exists= true
[LocalCodexProvider] detectCodexPath 检测到 Codex: C:\Users\break\.codex\codex.exe
```

---

## 📊 日志级别说明

| 日志类型 | 使用场景 | 方法 |
|---------|---------|------|
| `console.log()` | 正常流程跟踪、信息输出 | 大部分日志 |
| `console.warn()` | 警告（如最终未找到 CLI） | 路径检测失败的最终警告 |
| `console.error()` | 错误详情（生成/优化失败） | catch 块中的错误日志 |

## 🔍 如何查看日志

### 方式一：VSCode 开发者工具（推荐）

1. 按 `Ctrl+Shift+P` / `Cmd+Shift+P`
2. 输入 `Developer: Toggle Developer Tools`
3. 切换到 `Console` 标签
4. 过滤日志：输入 `[LocalClaudeProvider]` 或 `[LocalCodexProvider]`

### 方式二：输出面板

1. 按 `Ctrl+Shift+U` / `Cmd+Shift+U` 打开输出面板
2. 下拉选择 `Prompt Hub`（如果插件配置了 OutputChannel）

### 方式三：启用调试模式

在 VSCode 设置中添加：
```json
{
  "promptHub.debug": true
}
```

（注意：此选项需在代码中实现条件日志输出）

## 🛠️ 故障排查指南

### 问题 1: "未找到 Codex CLI"

**查看日志：**
```
[LocalCodexProvider] getCodexPath 开始检测 Codex CLI 路径
[LocalCodexProvider] getCodexPath 配置 local.codexPath 为空，跳过配置路径检测
[LocalCodexProvider] getCodexPath 环境变量 CODEX_BIN 未设置，跳过
[LocalCodexProvider] detectCodexFromPath Windows 平台，使用 where 命令
[LocalCodexProvider] detectFromWhere where codex.exe 找到 0 条结果
[LocalCodexProvider] detectCodexPath 开始遍历 9 个常见路径
[LocalCodexProvider] detectCodexPath 常见路径探测: ... exists= false (全部为 false)
[LocalCodexProvider] getCodexPath 未找到 Codex CLI：已尝试...
```

**解决方法：**
1. 手动配置 `promptHub.local.codexPath`
2. 或设置环境变量 `CODEX_BIN`
3. 或确保 Codex 在 PATH 中（`where codex` 或 `which codex` 可找到）

### 问题 2: 调用超时

**查看日志：**
```
[LocalClaudeProvider] 执行耗时: 120000 ms
[LocalClaudeProvider] 生成元信息失败: {
  message: '...',
  killed: true,
  signal: 'SIGTERM'
}
```

**解决方法：**
1. 增加超时配置：`promptHub.local.claudeTimeoutMs`（默认 120000）
2. 检查网络连接（首次可能需要登录认证）
3. 在终端手动运行 `claude -p "你好"` 完成初次登录

### 问题 3: JSON 解析失败

**查看日志：**
```
[LocalCodexProvider] generateMeta stdout 内容: Some non-JSON output...
[LocalCodexProvider] generateMeta 未能从响应中匹配 JSON 格式
```

**原因：**
- AI 模型返回了非 JSON 格式的内容
- 网络问题导致输出不完整
- Codex/Claude CLI 版本问题

**解决方法：**
1. 检查 CLI 版本是否最新
2. 尝试更换模型（`promptHub.local.codexModel`）
3. 查看完整 stdout 内容排查

## 📈 日志统计

### LocalClaudeProvider.ts

| 方法 | 日志点数量 | 说明 |
|------|-----------|------|
| generateMeta() | 10+ | 包含执行流程、输出内容、错误详情 |
| optimize() | 8+ | 类似 generateMeta()，超时更长（60s） |
| getClaudePath() | 12+ | 检测流程的每一步 |
| detectClaudeFromVSCodeExtensions() | 5+ | 扩展目录探测 |
| detectClaudeFromPath() | 4+ | PATH 检测 |
| detectFromWhere() | 4+ | Windows where 命令 |
| detectClaudePath() | 12+ | 常见路径遍历 |

### LocalCodexProvider.ts

| 方法 | 日志点数量 | 说明 |
|------|-----------|------|
| generateMeta() | 13+ | 完整执行流程日志 |
| optimize() | 11+ | 完整优化流程日志 |
| getCodexPath() | 9+ | 路径检测每一步 |
| detectCodexFromPath() | 5+ | PATH 检测 |
| detectFromWhere() | 5+ | Windows where 命令详细输出 |
| detectCodexPath() | 13+ | 常见路径遍历（9 个路径） |

**总计：约 120+ 个日志点**

## 🎉 总结

本次为 Prompt Hub 本地 AI 集成的两个核心 Provider 添加了超过 120 个调试日志点，涵盖：

✅ **执行流程跟踪**：每个关键步骤的开始/完成
✅ **性能监控**：执行耗时（毫秒）、内容长度（字节）
✅ **路径检测**：配置、环境变量、PATH、常见路径的完整探测过程
✅ **错误诊断**：详细的错误对象检查（code, signal, killed）
✅ **输出内容**：stdout/stderr 的长度和内容预览（防止日志过大）
✅ **跨平台支持**：Windows 和 Unix/macOS 的不同检测逻辑

所有日志均带有清晰的前缀（如 `[LocalCodexProvider] generateMeta`），便于过滤和定位问题。

---

**完成日期**：2025-12-23
**实现版本**：v0.1.2
**编译状态**：✅ 通过
