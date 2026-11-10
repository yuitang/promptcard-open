# PromptCard Open

开源的 **AI 提示词卡片管理器** —— 把散落在聊天记录、备忘录里的提示词，变成一张张可分类、可搜索、可导出的卡片。

> 这是一个原创实现的开源项目，功能思路参考了市面上的提示词卡片工具，全部代码由本项目独立编写，采用 MIT 协议开源。

## 功能特性

- 🗂 **卡片管理**：标题、提示词、备注描述、作者、配图（自动压缩）
- 🏷 **多维度组织**：分类文件夹 + 模型标签（GPT-4o / Midjourney / SDXL…）+ 自定义标签 + 标签云
- 🖥 **双视图**：网格视图 / 列表视图，支持按更新时间、创建时间、标题排序
- 🔍 **全文搜索**：同时搜索标题、内容、描述、作者、模型和标签
- ⭐ **收藏与隐藏**：常用卡片一键收藏，不想看到的卡片可隐藏
- 📤 **导出**：JSON 完整备份 / Markdown / 纯文本，按分类结构组织
- 📥 **导入**：JSON 备份文件，按卡片 ID 智能合并去重
- 🔒 **本地存储**：数据保存在浏览器 localStorage（Electron 模式同样保存在本地），不上传任何服务器

## 运行方式

### 方式一：桌面应用（Electron）

```bash
npm install
npm start
```

### 方式二：浏览器直接使用（零安装）

直接双击打开 `renderer/index.html` 即可使用，无需任何构建步骤。

## 数据说明

- 所有数据保存在 `localStorage`，键名为 `promptcard_open_data_v1`
- 配图会自动压缩（最长边 1200px，JPEG 质量 0.85）后以 DataURL 存储
- 建议定期通过「导出 → JSON」做完整备份

## 目录结构

```
promptcard-open/
├── main.js              # Electron 主进程
├── package.json
├── renderer/
│   ├── index.html       # 界面
│   ├── styles.css       # 样式
│   └── app.js           # 全部应用逻辑
└── README.md
```

## License

MIT
