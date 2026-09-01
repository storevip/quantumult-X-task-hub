# Quantumult X Task Hub

## 节点分数排名 V3

V3 支持按机场策略组分别检测，避免一次测试全部机场。

### 推荐使用方法

把下面一行放在当前配置的 `[task_local]` 段：

```ini
event-interaction https://raw.githubusercontent.com/storevip/quantumult-X-task-hub/main/scripts/node-score-ranking.js, tag=节点分数排名, img-url=bolt.horizontal.circle.fill.system, enabled=true
```

保存后，在 QuanX 首页长按某个机场策略组，选择「节点分数排名」。脚本只会检测该组里的全部节点。

### 输出内容

结果顶部显示综合前三名，下面显示该机场全部节点：

- 节点名称
- 国家中文名
- 欺诈分（根据 IP 风险标记估算，越低越好）
- IP 纯净度
- Google 是否送中
- ChatGPT 是否支持
- Gemini 是否支持
- IP、延迟与综合分

Claude 检测已移除，以缩短检测时间。默认并发 5 个节点，单个请求超时 9 秒。

### 任务仓库地址

```text
https://raw.githubusercontent.com/storevip/quantumult-X-task-hub/main/gallery-v2.json
```

任务仓库入口只支持 Cron，无法选择机场策略组；按机场检测请使用上面的 `event-interaction` 长按方式。

### 文件

- `scripts/node-score-ranking.js`：当前稳定版（V3）
- `scripts/node-score-ranking-v3.js`：V3 固定版本
- `gallery-v2.json`：QuanX 任务仓库入口
