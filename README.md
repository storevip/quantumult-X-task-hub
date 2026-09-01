# Quantumult X Task Hub

Quantumult X 节点质量检测工具。

## 一键导入

在 Quantumult X 的「请求列表 → 任务仓库」中添加：

```text
https://raw.githubusercontent.com/storevip/quantumult-X-task-hub/main/gallery.json
```

进入仓库后安装「节点分数排名」，再回到请求列表手动执行。

> 任务仓库只接受 Cron 格式，因此仓库项目使用一个一年一次的占位时间；平时请手动执行。脚本不会每天自动运行。

## 检测内容

- ChatGPT、Gemini、Claude
- Quantumult X URL 延迟
- 出口 IP、中文地区与 ASN
- 数据中心、VPN、代理、Tor 与滥用风险标记
- 综合分数与推荐等级

## 长按节点调用（可选）

如果希望在首页长按节点或策略组后运行，请把下面一行放入当前配置的 `[task_local]`：

```ini
event-interaction https://raw.githubusercontent.com/storevip/quantumult-X-task-hub/main/scripts/node-score-ranking.js, tag=节点分数排名, img-url=bolt.horizontal.circle.fill.system, enabled=true
```

## 使用提醒

- 节点需要存在于至少一个策略组中。
- 默认最多检测 80 个节点，并发数为 3。
- 测试时尽量让 Quantumult X 保持在前台。
- 风险分是根据公开 IP 风险标记计算的估算值，越低越好。
