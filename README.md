# Quantumult X Task Hub

这是一个可直接导入 Quantumult X「请求列表 / 任务仓库」的工具仓库。

## 当前任务

### 节点分数排名

自动读取策略组中的真实代理节点，并逐节点检测：

- ChatGPT
- Gemini
- Claude
- Quantumult X URL 延迟
- 出口 IP、中文地区与 ASN
- 数据中心、VPN、代理、Tor 与滥用风险标记
- 综合分数与推荐等级

结果会按综合分从高到低排列。

## 导入 Quantumult X

在 Quantumult X 中进入「请求列表」，点击右上角加号，选择「任务仓库」，粘贴：

```text
https://raw.githubusercontent.com/storevip/quantumult-X-task-hub/main/gallery.json
```

保存并更新后，运行「节点分数排名」。

## 使用提醒

- 请保持 Quantumult X 开启，测试时尽量让应用处于前台。
- 节点需要存在于至少一个策略组中。
- 默认最多检测 80 个节点，并发数为 3。
- 风险分是根据公开 IP 风险标记计算的估算值，越低越好。
- `⚠️` 表示站点可连接，但被 WAF 拦截，无法明确判断地区解锁。
- 脚本只检测 ChatGPT、Gemini 与 Claude，不检测其他流媒体服务。

## 文件

- `gallery.json`：任务仓库入口
- `tasks.conf`：兼容入口
- `scripts/node-score-ranking.js`：节点检测脚本
