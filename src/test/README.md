# Prompt Hub 单元测试

本目录包含 Prompt Hub VSCode 扩展的单元测试。

## 测试结构

```
src/test/
├── runTest.ts                          # 测试运行入口
├── suite/
│   ├── index.ts                        # 测试套件索引
│   ├── helpers.test.ts                 # helpers 工具函数测试
│   ├── SelectionParser.test.ts         # 选区解析器测试
│   ├── ConfigurationService.test.ts    # 配置服务测试
│   └── PromptStorageService.test.ts    # 存储服务测试
└── README.md                           # 本文档
```

## 运行测试

### 从命令行运行

```bash
# 运行所有测试
npm test

# 编译代码
npm run compile

# 运行 lint
npm run lint

# 运行预测试（编译 + lint）
npm run pretest
```

### 从 VSCode 运行

1. 打开 VSCode
2. 按 `F5` 或点击 "Run and Debug"
3. 选择 "Extension Tests" 配置
4. 测试将在新的 VSCode 窗口中运行

## 测试覆盖

### helpers.test.ts
- ✅ `generateId()` - 生成唯一 ID
- ✅ `sanitizeFilename()` - 文件名安全化
- ✅ `formatDate()` - 日期格式化
- ✅ `formatTime()` - 时间格式化

### SelectionParser.test.ts
- ✅ 解析带有名称的 prompt 标记
- ✅ 解析带有 emoji 的 prompt 标记
- ✅ 大小写不敏感的标记匹配
- ✅ 多行内容处理
- ✅ 配置开关（自动检测、移除标记）
- ✅ 边界情况处理

### ConfigurationService.test.ts
- ✅ 获取配置值
- ✅ 获取存储路径
- ✅ 路径变量解析（~, ${workspaceFolder}, 环境变量）
- ✅ 密钥存储（SecretStorage）
- ✅ 配置变更监听

### PromptStorageService.test.ts
- ✅ 初始化存储目录和文件
- ✅ CRUD 操作（创建、读取、更新、删除）
- ✅ 名称重复检测
- ✅ 搜索功能（名称、内容、标签）
- ✅ 事件触发
- ✅ 数据持久化

## 编写新测试

### 测试文件命名

测试文件应该以 `.test.ts` 结尾，放在 `src/test/suite/` 目录下。

### 测试模板

```typescript
import * as assert from 'assert';
import { YourClass } from '../../path/to/YourClass';

suite('YourClass Test Suite', () => {
  suite('methodName', () => {
    test('should do something', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = someFunction(input);

      // Assert
      assert.strictEqual(result, 'expected');
    });
  });
});
```

### Mock 对象

对于依赖 VSCode API 的代码，需要创建 mock 对象：

```typescript
class MockConfigurationService {
  private config: Map<string, any> = new Map();

  get<T>(key: string, defaultValue: T): T {
    return this.config.has(key) ? this.config.get(key) : defaultValue;
  }
}
```

## 调试测试

1. 在测试文件中设置断点
2. 按 `F5` 启动调试
3. 测试将在断点处暂停
4. 使用调试工具检查变量和执行流程

## 持续集成

测试可以在 CI/CD 流程中运行：

```yaml
# GitHub Actions 示例
- name: Run tests
  run: |
    npm install
    npm test
```

## 最佳实践

1. **独立性**：每个测试应该独立运行，不依赖其他测试
2. **清理**：使用 `teardown()` 清理测试数据
3. **命名**：使用描述性的测试名称
4. **覆盖率**：确保测试覆盖主要功能和边界情况
5. **快速**：保持测试运行快速（避免长时间等待）

## 故障排查

### 测试失败

- 检查是否正确编译了代码：`npm run compile`
- 查看测试输出中的错误信息
- 确保 mock 对象正确设置

### 测试超时

- 增加测试超时时间（默认 10 秒）
- 检查是否有阻塞操作

### 无法启动测试

- 确保已安装所有依赖：`npm install`
- 检查 VSCode 版本是否满足要求
