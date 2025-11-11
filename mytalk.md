1. 把文件file:///F:/%E6%96%87%E4%BB%B6/%E8%B5%84%E6%BA%90%E5%BA%93/Nita.lingquan/resources/FM1FCA30F687B1D7E9/1f4cb.svg作为本插件的Logo

2. prompt的排序方式增加按使用次数


# 新prompt
123456

新建后，不需要再提示用户输入名称
git hub同步 如果没有初始化仓库 。。。
右键菜单功能都放在一个父菜单
所涉及的菜单都尽量用emoji做icon


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