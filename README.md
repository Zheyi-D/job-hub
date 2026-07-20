# JobHub — 求职助手浏览器扩展

一键填充简历 + 投递记录追踪 + 求职数据看板，同步飞书多维表格。

## 功能

| Tab | 功能 | 说明 |
|-----|------|------|
| 📝 简历填充 | 一键填表 | 点击字段即填入网页表单（React/Vue 兼容）。支持批量扫描页面、AI 简历解析、多份简历切换、内联编辑、拖拽排序、卡片分组。 |
| 📋 投递追踪 | 记录投递 | 自动抓取公司/岗位/链接（17 个站点规则 + 4 层 fallback），可编辑确认后同步飞书多维表格。支持草稿恢复、重复检测。 |
| 📊 数据看板 | 统计概览 | 投递数量统计、状态分布条形图、近 7 天趋势柱状图。纯 CSS 图表，零依赖。 |

## AI 功能（可选）

在 Options 页配置 AI API Key 后可使用：
- **📄 简历解析**：上传 .docx / .pdf / .txt 文件，AI 自动识别并填入结构化简历
- **🔍 批量填充**：扫描页面表单，AI 智能匹配简历字段一键填入
- 支持 DeepSeek / Kimi / 豆包 / 自定义 OpenAI 兼容接口
- 未配置 API Key 时可通过外部 AI 链接（DeepSeek/豆包/Kimi）手动完成

## 安装

1. 下载本仓库 ZIP 或 `git clone`
2. 打开 Chrome → `chrome://extensions` → 开启「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择 `job-hub` 文件夹
4. 点击工具栏 JobHub 图标打开侧边栏

## 飞书配置

首次使用投递追踪需配置飞书多维表格：

1. [飞书开放平台](https://open.feishu.cn) → 创建企业自建应用
2. 开通 `bitable:app` 权限 → 创建版本并发布
3. 飞书新建多维表格（6 列：公司/岗位/投递时间/链接/状态/备注）
4. 表格设置中添加文档应用 → 设为可编辑
5. 打开扩展 Options 页填写凭证 → 测试连接

详见 Options 页中的「首次配置指南」。

## 技术栈

- **Chrome Extension Manifest V3**
- **纯原生 JS/CSS/HTML** — 零 npm 依赖，零构建工具
- **ES Modules** — service worker 和 side panel
- **Neo-Brutalist 设计风格** — 粗黑边框、硬边缘阴影、零圆角、纯色配色
- **飞书 Open API** — REST 直连，tenant_access_token 认证
- **chrome.storage** — local 持久化 + session 缓存

## 项目结构

```
job-hub/
├── manifest.json
├── service-worker.js          # 消息路由 + 飞书 API + 更新检查
├── lib/
│   ├── design-system.css      # Neo-Brutalist 设计系统
│   ├── feishu-api.js          # 飞书 Bitable API 封装
│   ├── storage.js             # Storage 抽象层
│   └── constants.js           # 全局常量
├── content/
│   ├── fill-engine.js         # 表单填充引擎（常驻注入）
│   └── scraper.js             # 页面信息抓取（按需注入）
├── sidepanel/
│   ├── sidepanel.html         # 3 Tab 外壳
│   ├── sidepanel.js           # Tab 路由器
│   ├── sidepanel.css
│   ├── resume-fill.js/css     # 简历填充面板
│   ├── job-tracker.js/css     # 投递追踪面板
│   └── dashboard.js/css       # 数据看板面板
├── options/
│   ├── options.html           # 设置页
│   ├── options.js
│   └── options.css
└── icons/
```

## 合并来源

本项目合并了以下两个独立扩展：
- [auto-fill-extension](https://github.com/Zheyi-D/auto-fill-extension) — 简历自动填充
- [job-tracker-extension](https://github.com/Zheyi-D/job-tracker-extension) — 求职投递追踪

## 许可

MIT © 2026 Zheyi-D
