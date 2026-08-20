# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；公开版本采用语义化版本号。

## [0.1.0] - 2026-08-21

首次公开发布。

### Added

- 本地优先的作品库，支持空白建书、AI 引导建书、旧稿导入、复制、归档和回收站。
- 故事圣经，用于维护作者意图、大纲、实体、正典事实、关系、时间线和伏笔。
- Markdown 写作台，以及草稿同步、不可变版本、历史恢复、批注和稿件回收站。
- 选区编辑、单章委托、审稿、修订和故事变化候选；作者确认后才写入正式正文或正典。
- AI 快速创作，支持方向确认、多章推进、逐章确认、暂停、介入、重试和转回手写。
- 项目助手、运行中心和长篇推演，用于上下文协作、任务恢复、模型调用审计、记忆检索和影响预演。
- OpenAI Chat Completions、OpenAI Responses 和 Anthropic Messages 渠道，以及生成、规划、审稿和嵌入模型派任。
- Markdown、纯文本、DOCX、EPUB 和 NarraLume 作品包导出。
- 项目内容快照与完整 SQLite 备份，恢复时不覆盖当前作品或正在使用的数据目录。
- 浏览器 OPFS 内核与可选本地 Server；两种运行方式均可在没有模型时完成手写、整理、导出和备份。
- 自定义作品封面、封面裁切以及书架封面/列表视图。
- Apache-2.0 开源许可与社区协作文档。
- Windows x64、Linux x64 和 macOS Apple Silicon 本地启动器、停止/备份脚本与预构建 Release 任务。
- Docker Compose 自托管入口、基础 CI 和容器健康检查。
- 面向公开体验维护者的 Cloudflare Web/Relay 与本机 Bridge 部署链路；普通用户不需要 Bridge。
- 中英文项目说明、完整用户指南、配置与数据文档、界面截图。
