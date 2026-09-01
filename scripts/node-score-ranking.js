/**
 * Quantumult X - 节点分数排名
 *
 * 功能：
 * 1. 自动读取策略组中的真实代理节点
 * 2. 逐节点测试 ChatGPT / Gemini / Claude
 * 3. 查询出口 IP、中文地区、ASN 与风险特征
 * 4. 结合 AI 解锁、延迟、IP 风险计算综合分并排名
 *
 * 使用方式：作为 event-interaction 任务运行。
 * 注意：结果必须使用 $done({ title, message })，不要改成 content。
 */

"use strict";

const CONFIG = {
  // 自动发现失败时，可手动填写节点名称，例如：["美国 01", "日本 02"]
  manualNodes: [],

  // ipapi.is 匿名接口每天最多 100 次；预留余量，单次最多检测 80 个节点。
  maxNodes: 80,
  concurrency: 3,
  timeout: 12000
};

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const COUNTRY_ZH = {
  US: "美国", JP: "日本", SG: "新加坡", HK: "中国香港", TW: "中国台湾",
  MO: "中国澳门", CN: "中国大陆", KR: "韩国", GB: "英国", DE: "德国",
  FR: "法国", NL: "荷兰", CA: "加拿大", AU: "澳大利亚", NZ: "新西兰",
  RU: "俄罗斯", IN: "印度", TH: "泰国", MY: "马来西亚", VN: "越南",
  PH: "菲律宾", ID: "印度尼西亚", TR: "土耳其", AE: "阿联酋", IL: "以色列",
  IT: "意大利", ES: "西班牙", PT: "葡萄牙", SE: "瑞典", NO: "挪威",
  FI: "芬兰", DK: "丹麦", CH: "瑞士", AT: "奥地利", BE: "比利时",
  IE: "爱尔兰", PL: "波兰", CZ: "捷克", RO: "罗马尼亚", UA: "乌克兰",
  GR: "希腊", HU: "匈牙利", IS: "冰岛", BR: "巴西", AR: "阿根廷",
  CL: "智利", MX: "墨西哥", CO: "哥伦比亚", ZA: "南非", EG: "埃及"
};

const RESERVED = new Set([
  "direct", "reject", "proxy", "static", "available", "round-robin",
  "url-latency-benchmark", "dest-hash", "ssid", "none", "filter"
]);

function sendMessage(action, content) {
  const message = { action };
  if (typeof content !== "undefined") message.content = content;
  return $configuration.sendMessage(message).then(result => {
    if (result && result.error) throw new Error(String(result.error));
    return result ? result.ret : null;
  });
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function cleanCandidate(value) {
  if (typeof value !== "string") return "";
  let text = value.trim().replace(/^['\"]|['\"]$/g, "");
  if (!text || text.length > 160) return "";
  if (/^https?:\/\//i.test(text) || /^(img-url|tag|enabled|check-interval|tolerance)\s*=/i.test(text)) return "";
  if (RESERVED.has(text.toLowerCase())) return "";
  return text;
}

function collectCandidates(input) {
  const output = [];

  function addText(text) {
    String(text).split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const parts = trimmed.split(",").map(x => x.trim()).filter(Boolean);
      if (/^(static|available|round-robin|url-latency-benchmark|dest-hash|ssid)\s*=/i.test(parts[0] || "")) {
        parts.shift(); // 第一项是“策略类型=策略名”，不是节点。
        parts.forEach(part => {
          const candidate = cleanCandidate(part);
          if (candidate && !/=/.test(candidate)) output.push(candidate);
        });
      } else if (parts.length > 1) {
        parts.forEach(part => {
          const candidate = cleanCandidate(part);
          if (candidate && !/=/.test(candidate)) output.push(candidate);
        });
      } else {
        const candidate = cleanCandidate(trimmed);
        if (candidate && !/=/.test(candidate)) output.push(candidate);
      }
    });
  }

  function walk(value) {
    if (typeof value === "string") {
      addText(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.keys(value).forEach(key => {
        // 某些 QX 版本会把标签放在对象键中，后续再用服务器描述接口校验。
        const keyCandidate = cleanCandidate(key);
        if (keyCandidate) output.push(keyCandidate);
        walk(value[key]);
      });
    }
  }

  walk(input);
  return unique(output);
}

function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  function next() {
    const index = cursor++;
    if (index >= items.length) return Promise.resolve();
    return Promise.resolve(worker(items[index], index))
      .then(value => { results[index] = value; })
      .catch(error => { results[index] = { error: String(error) }; })
      .then(next);
  }

  const workers = [];
  const count = Math.min(Math.max(1, limit), items.length);
  for (let i = 0; i < count; i++) workers.push(next());
  return Promise.all(workers).then(() => results);
}

function extractDescription(ret, node) {
  if (typeof ret === "string") return ret.trim();
  if (!ret || typeof ret !== "object") return "";
  if (typeof ret[node] === "string") return ret[node].trim();
  const values = Object.keys(ret).map(key => ret[key]).filter(value => typeof value === "string");
  return values.length === 1 ? values[0].trim() : "";
}

function validateNodes(candidates) {
  return mapLimit(candidates, 8, node =>
    sendMessage("get_server_description", node)
      .then(ret => extractDescription(ret, node) ? node : "")
      .catch(() => "")
  ).then(items => unique(items.filter(item => typeof item === "string" && item)));
}

function discoverNodes() {
  if (CONFIG.manualNodes.length) return validateNodes(unique(CONFIG.manualNodes));

  return Promise.all([
    sendMessage("get_customized_policy").catch(() => null),
    sendMessage("get_policy_state").catch(() => null)
  ]).then(values => {
    const candidates = unique(
      collectCandidates(values[0]).concat(collectCandidates(values[1]))
    );
    return validateNodes(candidates);
  });
}

function getLatencyMap(nodes) {
  return sendMessage("url_latency_benchmark", nodes)
    .then(ret => ret && typeof ret === "object" ? ret : {})
    .catch(() => ({}));
}

function latencyFromValue(value) {
  if (Array.isArray(value)) {
    const valid = value.map(Number).filter(number => Number.isFinite(number) && number >= 0);
    return valid.length ? valid[valid.length - 1] : null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function fetchThrough(node, url, headers) {
  const started = Date.now();
  return $task.fetch({
    url,
    method: "GET",
    headers: Object.assign({ "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, headers || {}),
    timeout: CONFIG.timeout,
    opts: { policy: node }
  }).then(response => ({
    ok: true,
    code: Number(response.statusCode || 0),
    body: response.body || "",
    cost: Date.now() - started
  })).catch(error => ({
    ok: false,
    code: 0,
    body: "",
    cost: Date.now() - started,
    error: String(error)
  }));
}

function parseJson(text) {
  try { return JSON.parse(text || "{}"); } catch (_) { return null; }
}

function parseTrace(text) {
  const data = {};
  String(text || "").split("\n").forEach(line => {
    const index = line.indexOf("=");
    if (index > 0) data[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  });
  return data;
}

function lookupIp(node) {
  return fetchThrough(node, "https://api.ipapi.is/").then(response => {
    const data = response.ok ? parseJson(response.body) : null;
    if (data && !data.error && data.ip) {
      return {
        ip: data.ip,
        cc: String(data.cc || (data.location && data.location.country_code) || "").toUpperCase(),
        asn: data.asn_num || (data.asn && data.asn.asn) || "",
        org: data.asn_org || (data.asn && data.asn.org) || data.company_name || "",
        isBogon: data.is_bogon === true,
        isDatacenter: data.is_datacenter === true,
        isProxy: data.is_proxy === true,
        isVpn: data.is_vpn === true,
        isTor: data.is_tor === true,
        isAbuser: data.is_abuser === true,
        hasRiskData: true
      };
    }

    // 匿名接口达到限额或暂时失败时，仍尽量保留出口 IP 与国家信息。
    return fetchThrough(node, "https://www.cloudflare.com/cdn-cgi/trace").then(fallback => {
      const trace = fallback.ok ? parseTrace(fallback.body) : {};
      return {
        ip: trace.ip || "未知",
        cc: String(trace.loc || "").toUpperCase(),
        asn: "",
        org: "",
        hasRiskData: false
      };
    });
  });
}

function unsupportedBody(body) {
  return /unsupported[_ -]?country|not available in your (country|region)|isn['’]?t currently supported|service is not available|location is not supported|country not supported|available in your country/i.test(body || "");
}

function judgeChatGPT(result) {
  if (!result.ok) return false;
  if (unsupportedBody(result.body)) return false;
  if (result.code === 200 || result.code === 401 || result.code === 404) return true;
  return result.code === 403 ? null : (result.code > 0 && result.code < 500 ? true : null);
}

function judgeGemini(result) {
  if (!result.ok) return false;
  if (unsupportedBody(result.body) || /gemini is currently unavailable/i.test(result.body)) return false;
  if (result.code >= 200 && result.code < 400) return true;
  return result.code === 403 ? null : false;
}

function judgeClaude(result) {
  if (!result.ok) return false;
  if (unsupportedBody(result.body) || /region_restricted|geo.?blocked/i.test(result.body)) return false;
  if (result.code === 200 || result.code === 401 || result.code === 404) return true;
  return result.code === 403 ? null : (result.code > 0 && result.code < 500 ? true : null);
}

function riskScore(ip) {
  if (!ip || !ip.hasRiskData) return null;
  if (ip.isBogon) return 100;
  let score = 0;
  if (ip.isDatacenter) score += 30;
  if (ip.isProxy) score += 25;
  if (ip.isVpn) score += 20;
  if (ip.isTor) score += 50;
  if (ip.isAbuser) score += 35;
  return Math.min(100, score);
}

function latencyPoints(ms) {
  if (ms === null || typeof ms === "undefined") return 0;
  if (ms <= 200) return 25;
  if (ms <= 400) return 22;
  if (ms <= 600) return 18;
  if (ms <= 900) return 12;
  if (ms <= 1500) return 6;
  return 2;
}

function aiPoints(value) {
  if (value === true) return 15;
  if (value === null) return 5;
  return 0;
}

function recommendation(score) {
  if (score >= 85) return "强烈推荐";
  if (score >= 75) return "推荐";
  if (score >= 60) return "可用";
  if (score >= 45) return "谨慎";
  return "不推荐";
}

function statusIcon(value) {
  return value === true ? "✅" : value === false ? "❌" : "⚠️";
}

function testNode(node, latencyMap) {
  const latency = latencyFromValue(latencyMap[node]);
  return Promise.all([
    lookupIp(node),
    fetchThrough(node, "https://chatgpt.com/backend-api/models", { Accept: "application/json" }),
    fetchThrough(node, "https://gemini.google.com/app"),
    fetchThrough(node, "https://claude.ai/api/organizations", { Accept: "application/json" })
  ]).then(values => {
    const ip = values[0];
    const chatgpt = judgeChatGPT(values[1]);
    const gemini = judgeGemini(values[2]);
    const claude = judgeClaude(values[3]);
    const risk = riskScore(ip);
    const measuredCosts = values.slice(1).filter(x => x && x.ok).map(x => x.cost);
    const effectiveLatency = latency !== null
      ? latency
      : (measuredCosts.length ? Math.round(measuredCosts.reduce((a, b) => a + b, 0) / measuredCosts.length) : null);

    // 风险数据缺失时只给基础分，避免把“未知”误判成低风险。
    const ipPoints = risk === null ? 8 : Math.round(30 * (100 - risk) / 100);
    const score = Math.max(0, Math.min(100,
      aiPoints(chatgpt) + aiPoints(gemini) + aiPoints(claude) +
      latencyPoints(effectiveLatency) + ipPoints
    ));

    return {
      node, ip, chatgpt, gemini, claude, risk,
      latency: effectiveLatency,
      score,
      recommendation: recommendation(score)
    };
  });
}

function formatResult(item, index) {
  const country = COUNTRY_ZH[item.ip.cc] || item.ip.cc || "未知地区";
  const risk = item.risk === null ? "未知" : item.risk;
  const latency = item.latency === null ? "超时" : item.latency + "ms";
  const asn = item.ip.asn ? " | AS" + item.ip.asn : "";

  return [
    `${index + 1}. ${item.node}`,
    `综合 ${item.score}分 · ${item.recommendation} | 风险 ${risk} | ${latency}`,
    `${country} · ${item.ip.ip}${asn}`,
    `GPT${statusIcon(item.chatgpt)}  Gemini${statusIcon(item.gemini)}  Claude${statusIcon(item.claude)}`
  ].join("\n");
}

function finish(title, message, notifyMessage) {
  if (notifyMessage) $notify(title, "", notifyMessage);
  $done({ title, message });
}

discoverNodes().then(nodes => {
  if (!nodes.length) {
    finish(
      "节点分数排名",
      "没有读取到真实节点。\n\n请确认：\n1. 本脚本以 event-interaction 方式运行；\n2. 节点已加入至少一个策略组；\n3. 或在脚本顶部 CONFIG.manualNodes 中填入节点名称。"
    );
    return null;
  }

  const limited = nodes.slice(0, CONFIG.maxNodes);
  $notify("节点分数排名", "开始测试", `共 ${limited.length} 个节点，请保持 Quantumult X 在前台`);

  return getLatencyMap(limited).then(latencyMap =>
    mapLimit(limited, CONFIG.concurrency, node => testNode(node, latencyMap))
  ).then(results => {
    const valid = results.filter(item => item && !item.error && typeof item.score === "number");
    valid.sort((a, b) => b.score - a.score || (a.latency || 999999) - (b.latency || 999999));

    if (!valid.length) {
      finish("节点分数排名", "节点已读取，但全部测试失败。请检查网络权限、策略组与节点状态。");
      return;
    }

    const header = [
      `已测试 ${valid.length}/${limited.length} 个节点${nodes.length > limited.length ? `（总计 ${nodes.length}，受限额仅测前 ${limited.length} 个）` : ""}`,
      "评分：AI 解锁 45分 + 延迟 25分 + IP质量 30分",
      "风险分为本脚本根据机房/VPN/代理/Tor/滥用标记计算的估算值，越低越好。",
      "⚠️ 表示站点可连接，但被 WAF 拦截，无法确定地区解锁。"
    ].join("\n");

    const body = valid.map(formatResult).join("\n\n");
    const top = valid.slice(0, 3).map((item, index) => `${index + 1}. ${item.node} ${item.score}分`).join("\n");
    finish("节点分数排名", header + "\n\n" + body, "前三名\n" + top);
  });
}).catch(error => {
  finish("节点分数排名", "脚本运行失败：\n" + String(error));
});
