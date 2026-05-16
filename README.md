# SmartRead - AI 网页摘要助手

> 选中任何网页内容，AI 一键生成摘要、要点提取和通俗解释

## ✨ 功能

- **4 种分析模式**：TL;DR 总结 / 提取要点 / 详细分析 / 通俗解释
- **右键菜单快捷操作**：选中文本 → 右键 → 选择模式
- **流式输出**：实时显示 AI 推理结果
- **Markdown 渲染**：支持标题、列表、代码高亮
- **一键复制**：结果即时复制到剪贴板

## 🚀 安装

1. 下载代码：`git clone https://github.com/ZhangNing94/smartread-chrome-extension.git`
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目的文件夹

## ⚙️ 配置

1. 点击扩展图标打开设置面板
2. 输入 [DeepSeek API Key](https://platform.deepseek.com/api_keys)
3. 选择默认分析模式
4. 保存设置

## 📖 使用

1. 在任意网页选中文字
2. 点击右键 → **SmartRead - AI 分析**
3. 选择分析模式
4. 等待 AI 流式输出结果
5. 点击「复制」保存结果

## 💰 定价

| 层级 | 价格 | 功能 |
|------|------|------|
| Free | 免费 | 每天 10 次调用 |
| Pro | ¥29/月 | 无限次调用，优先队列 |

## 🛠 技术栈

- Manifest V3
- DeepSeek Chat API（流式 SSE）
- 纯前端实现，无后端依赖

## 📄 License

MIT

---

Made with ❤️ by ZhangNing94