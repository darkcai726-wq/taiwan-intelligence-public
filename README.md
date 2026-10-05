# 台海情报公开浏览入口

仅公开已发布的网页、文章摘要和关联分析。项目源码、管理凭据、模型认证和账户额度不在本仓库。

浏览地址：https://darkcai726-wq.github.io/taiwan-intelligence-public/

首页及文章列表在静态站读取快照，浏览与刷新不会唤醒后台或调用模型。管理与分享写入仍需进入原后台并鉴权。

GitHub 公共 standard runner 每六小时在北京时间 00:40、06:40、12:40、18:40 核验原采集已完成后发布；GitHub 调度可能延迟。采集未完成时最多等待一小时，失败保留已上线版本；内容和前端均未变时跳过上传与构建。首次执行先准备 gh-pages 产物；仓库所有者在 Settings → Pages 选择 Deploy from a branch / gh-pages / 根目录启用一次。自身 GITHUB_TOKEN 无法首次启用 Pages；无需 PAT。之后可手动执行 Publish public intelligence snapshot 重试，不会触发采集。

发布工作流只使用本仓库短期 GITHUB_TOKEN，无 PAT，无私有仓库访问，无 Actions 缓存或 artifact 存储，无 npm 安装或前端构建。gh-pages 分支仅保存两代可读文件，内容提交后显式请求 Pages 原子构建。公开 standard runner 和公开仓库 Pages 使用 GitHub 免费功能；Pages 服务有 1GB 站点、100GB/月带宽等平台软限制，超限可能受限，不自动购买资源。仓库 Git 历史仍会随发布增长。

脚本固定只访问原后台公开 GET 导出接口及本仓库 GitHub API，检查采集时段、字段白名单、文件哈希及容量。工作流不会调用模型、私有采集接口或管理诊断。

## 已完成验收

2026-10-05已完成真实公网桌面1440/手机390新会话验收：各完整103篇、五卡展开收起、筛选/搜索/刷新正常，各23 GET全部同源，后台请求0；自身令牌Pages构建请求201并完成新构建，无新内容的常规发布跳过写入/构建。验收时四地区42/21/20/20，数据时间北京时间12:26；网页显示后续真实更新时间。

`.github/workflows/verify.yml` 仅手动运行，不包含定时器。浏览器模式用公共 runner 已有Chrome和临时playwright-core驱动；deployment_only模式仅验证Pages构建权限，无浏览器安装、采集或模型。此检查不使用Actions缓存或上传Artifacts。正常六小时publish工作流保持轻量。
