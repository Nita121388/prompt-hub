1. 把文件file:///F:/%E6%96%87%E4%BB%B6/%E8%B5%84%E6%BA%90%E5%BA%93/Nita.lingquan/resources/FM1FCA30F687B1D7E9/1f4cb.svg作为本插件的Logo

2. prompt的排序方式增加按使用次数


1. 类似于以下内容
# 这是我新建Prompt的标题
这里是内容
新建后，不需要再提示用户输入名称
2. 状态栏增加图标，点击图标可以快速访问常用功能
2. 右键菜单功能都放在一个父菜单
3. 所涉及的菜单和状态栏图标都尽量用emoji做icon
4. prompt的排序方式增加按使用次数
5. 把文件file:///F:/%E6%96%87%E4%BB%B6/%E8%B5%84%E6%BA%90%E5%BA%93/Nita.lingquan/resources/FM1FCA30F687B1D7E9/1f4cb.svg作为本插件的Logo


我理解你的需求了！让我确认一下：
📋 需求理解
1. TreeView 右键菜单增强
在 Prompt Hub 的侧边栏 TreeView 中，当用户右键点击 Prompt 项时，除了现有的功能（复制、删除、AI优化等），还要增加：
"打开命令面板" 或类似的菜单项
点击后直接打开该 Prompt 的相关命令面板，用户无需手动按 Ctrl+Shift+P 再搜索
2. 状态栏图标
在 VSCode 底部状态栏添加：
一个简洁的图标（例如 📝 或 💬）
点击后可以快速访问常用功能（比如打开 Prompt Hub、搜索 Prompt、新建 Prompt 等）
不占太多空间，简约设计
🤔 需要确认的细节
关于右键菜单：
你希望右键菜单中的"打开命令面板"具体做什么？
选项 A：直接打开命令面板并自动过滤到 Prompt Hub: 相关命令？
选项 B：打开一个 QuickPick 菜单，显示该 Prompt 的所有可用操作（复制、编辑、删除、AI优化等）？
选项 C：其他？
关于状态栏图标：
图标风格：使用 VSCode 内置图标（如 $(book)、$(note)）还是自定义 emoji（📝）？
点击行为：
选项 A：显示 QuickPick，列出常用命令（搜索、新建、打开视图等）
选项 B：直接打开 Prompt Hub TreeView 侧边栏
选项 C：显示最近使用的 Prompt 列表
显示文本：是否需要显示文本（如 "Prompt Hub"），还是只显示图标？
请确认这些细节，我就开始实现！ 🚀

优化：
【从选取创建prompt】
# Test3
从选取创建prompt，第一行内容为"# xxxx",也可以解析为标题

注意更新单元测试和相关文档

新功能点：
1. 预览区域支持打开本地Prompt仓库所在文件夹
2. 预览界面中，点击对应的prompt,右键菜单可以直接显示支持的菜单内容，不用集成在AI&更多这个父级菜单中
3. 预览界面中，点击对应的prompt,右键菜单可以直接显示在预览中每行后面，用一个emoji
z作为一个按钮
4. 预览界面中，右键显示和状态栏一样的可选菜单


那我觉得
# Prompt来识别为prompt标题就没有有必要了


我希望直接进入目录而不是高亮目录

我想要运行并测试插件，但是运行起来的VSCode示例包含旧数据 
我想要重新开始测试应该如何做？

Bug:
1. 
侧边栏界面，点击新建Prompt，显示以下内容：
# prompt: 在此填写标题

在此编写 Prompt 正文内容...



什么也不做直接保存后，侧边栏不显示对新建的prompt —— 在此填写标题.但是只要修改了内容就可以保存起来。这是为什么

[PromptFileService] 开始创建新 Prompt 文件
extensionHostProcess.js:216
[PromptFileService] 存储路径: C:\Users\break\.prompt-hub
extensionHostProcess.js:216
[PromptFileService] 文件名模板: prompt-{timestamp}.md
extensionHostProcess.js:216
[PromptFileService] 生成的默认文件名: prompt-20251125-175429.md
extensionHostProcess.js:216
[PromptFileService] 清洗后的文件名: prompt-20251125-175429.md
extensionHostProcess.js:216
[PromptFileService] 最终文件路径: C:\Users\break\.prompt-hub\prompt-20251125-175429.md
extensionHostProcess.js:216
[PromptFileService] 文件内容长度: 83 字符
extensionHostProcess.js:216
[PromptFileService] 文件内容预览: # prompt: 在此填写标题
extensionHostProcess.js:216

extensionHostProcess.js:216
在此编写 Prompt 正文内容...
extensionHostProcess.js:216

extensionHostProcess.js:216

extensionHostProcess.js:216

extensionHostProcess.js:216
[PromptFileService] 文件写入成功
extensionHostProcess.js:216
[PromptFileService] 文档已打开到编辑器
extensionHostProcess.js:216
[PromptFileService] 自动保存文档以触发同步
extensionHostProcess.js:216
[PromptFileService] 文档已保存，应该触发MarkdownMirrorService.onDidSave事件
extensionHostProcess.js:216
[PromptFileService] 新 Prompt 文件创建完成




我希望本项目的prompt内容的格式符合obsidian的格式，
你有什么建议？


3082371528213353784超值Claude Code3日体验k3日体验卡5_27:
KEY：sk_27615496dbdacf1a693c7492238bf5356dade778a295888b59d240027a797b39
教程请查看https://hongmacode.com/admin-next/api-stats；
环境变量中配置 ANTHROPIC_BASE_URL = "https://hongmacode.com/api

请你输出详细的修改方案、步骤，要完整包括设计文档和单元测试

新建Prompt时，我觉得标题的位置可以优化一下在最上面，你觉得呢？
如果修改这点，会修改哪些内容？功能？文档？单元测试？


问题：
现状：
1. 新建Prompt,文件的标题默认为prompt-20251126-195738.md
2. 文件内的格式为
---
id: 1764158258442-3bsg95d
type: prompt
tags: [prompt]
---

# 在此填写标题

在此编写 Prompt 正文内容...


3. 保存文件后，文件名、TreeView显示的标题名都任然保持着prompt-20251126-195738.md

期望修改：
3. 保存文件后，文件名替换为在此填写标题的内容
4. 如果存在同名文件，自动+1
如果修改这点，会修改哪些内容？功能？文档？单元测试？


TODO:
1. 那么新建的文件如果没有进行命名
1. TreeView区域右键希望有和状态栏菜单点击一样显示菜单。
2. 菜单中为什么没有看到新手引导配置了？我记得之前有的
3. 这个区域的内容可以去掉吗？

新建Prompt,文件内的格式为
---
id: 1764158258442-3bsg95d
type: prompt
tags: [prompt]
---

# 在此填写标题

在此编写 Prompt 正文内容...

