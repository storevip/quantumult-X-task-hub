/**
 * Quantumult X - 节点分数排名 V3
 * 长按某个机场策略组运行，只测试该组内全部节点。
 */
"use strict";

const CONFIG = {
  maxNodes: 80,
  concurrency: 5,
  timeout: 9000
};

const COUNTRY_ZH = {
  US:"美国",JP:"日本",SG:"新加坡",HK:"中国香港",TW:"中国台湾",MO:"中国澳门",CN:"中国大陆",
  KR:"韩国",GB:"英国",DE:"德国",FR:"法国",NL:"荷兰",CA:"加拿大",AU:"澳大利亚",NZ:"新西兰",
  RU:"俄罗斯",IN:"印度",TH:"泰国",MY:"马来西亚",VN:"越南",PH:"菲律宾",ID:"印度尼西亚",
  TR:"土耳其",AE:"阿联酋",IL:"以色列",IT:"意大利",ES:"西班牙",PT:"葡萄牙",SE:"瑞典",
  NO:"挪威",FI:"芬兰",DK:"丹麦",CH:"瑞士",AT:"奥地利",BE:"比利时",IE:"爱尔兰",
  PL:"波兰",CZ:"捷克",RO:"罗马尼亚",UA:"乌克兰",GR:"希腊",HU:"匈牙利",IS:"冰岛",
  BR:"巴西",AR:"阿根廷",CL:"智利",MX:"墨西哥",CO:"哥伦比亚",ZA:"南非",EG:"埃及"
};

const RESERVED = new Set(["direct","reject","proxy","none","filter"]);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

function sendMessage(action, data) {
  const message = { action };
  if (typeof data !== "undefined") message.content = data;
  return $configuration.sendMessage(message).then(result => {
    if (result && result.error) throw new Error(String(result.error));
    return result ? result.ret : null;
  });
}

function selectedPolicy() {
  if (typeof $environment !== "undefined") {
    if (typeof $environment.params === "string" && $environment.params.trim()) {
      return $environment.params.trim();
    }
    const path = String($environment.sourcePath || "");
    const match = path.match(/[#&]policy=([^&]+)/);
    if (match) {
      try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
    }
  }
  return "";
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  function next() {
    const index = cursor++;
    if (index >= items.length) return Promise.resolve();
    return Promise.resolve(worker(items[index], index))
      .then(value => { results[index] = value; })
      .catch(error => { results[index] = { node: items[index], error: String(error) }; })
      .then(next);
  }
  const jobs = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) jobs.push(next());
  return Promise.all(jobs).then(() => results);
}

function getNodesForPolicy(policy) {
  return sendMessage("get_customized_policy").then(all => {
    const policies = all && typeof all === "object" ? all : {};
    const policyNames = Object.keys(policies);

    if (!policy) {
      const usable = policyNames.filter(name => {
        const item = policies[name];
        return item && Array.isArray(item.candidates) && item.candidates.length;
      });
      const error = new Error("NO_POLICY");
      error.policies = usable;
      throw error;
    }

    const seenPolicies = new Set();
    const nodes = [];

    function expand(name) {
      if (!name || RESERVED.has(String(name).toLowerCase())) return;
      const item = policies[name];
      if (item && Array.isArray(item.candidates)) {
        if (seenPolicies.has(name)) return;
        seenPolicies.add(name);
        item.candidates.forEach(expand);
      } else {
        nodes.push(String(name).trim());
      }
    }

    expand(policy);
    return unique(nodes).slice(0, CONFIG.maxNodes);
  });
}

function getLatencyMap(nodes) {
  return sendMessage("url_latency_benchmark", nodes)
    .then(ret => ret && typeof ret === "object" ? ret : {})
    .catch(() => ({}));
}

function latencyValue(value) {
  if (Array.isArray(value)) {
    const values = value.map(Number).filter(v => Number.isFinite(v) && v >= 0);
    return values.length ? values[values.length - 1] : null;
  }
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) && valueNumber >= 0 ? valueNumber : null;
}

function fetchThrough(node, url, headers) {
  const started = Date.now();
  return $task.fetch({
    url,
    method:"GET",
    headers:Object.assign({"User-Agent":UA,"Accept-Language":"zh-CN,zh;q=0.9,en;q=0.8"}, headers || {}),
    timeout:CONFIG.timeout,
    opts:{policy:node}
  }).then(response => ({
    ok:true,
    code:Number(response.statusCode || 0),
    body:response.body || "",
    cost:Date.now() - started
  })).catch(error => ({
    ok:false, code:0, body:"", cost:Date.now() - started, error:String(error)
  }));
}

function json(text) {
  try { return JSON.parse(text || "{}"); } catch (_) { return null; }
}

function trace(text) {
  const data = {};
  String(text || "").split("\n").forEach(line => {
    const i = line.indexOf("=");
    if (i > 0) data[line.slice(0,i).trim()] = line.slice(i+1).trim();
  });
  return data;
}

function lookupIp(node) {
  return fetchThrough(node, "https://api.ipapi.is/").then(response => {
    const data = response.ok ? json(response.body) : null;
    if (data && !data.error && data.ip) {
      return {
        ip:data.ip,
        cc:String(data.cc || (data.location && data.location.country_code) || "").toUpperCase(),
        asn:data.asn_num || (data.asn && data.asn.asn) || "",
        isBogon:data.is_bogon === true,
        isDatacenter:data.is_datacenter === true,
        isProxy:data.is_proxy === true,
        isVpn:data.is_vpn === true,
        isTor:data.is_tor === true,
        isAbuser:data.is_abuser === true,
        hasRisk:true
      };
    }
    return fetchThrough(node, "https://www.cloudflare.com/cdn-cgi/trace").then(fallback => {
      const data = fallback.ok ? trace(fallback.body) : {};
      return {ip:data.ip || "未知", cc:String(data.loc || "").toUpperCase(), asn:"", hasRisk:false};
    });
  });
}

function fraudScore(ip) {
  if (!ip || !ip.hasRisk) return null;
  if (ip.isBogon) return 100;
  let score = 0;
  if (ip.isDatacenter) score += 20;
  if (ip.isProxy) score += 25;
  if (ip.isVpn) score += 20;
  if (ip.isTor) score += 50;
  if (ip.isAbuser) score += 35;
  return Math.min(100, score);
}

function purity(score) {
  if (score === null) return "未知";
  if (score <= 10) return "极纯净";
  if (score <= 25) return "纯净";
  if (score <= 45) return "一般";
  if (score <= 65) return "较差";
  return "高风险";
}

function unsupported(body) {
  return /unsupported[_ -]?country|not available in your (country|region)|isn['’]?t currently supported|service is not available|location is not supported|country not supported|available in your country/i.test(body || "");
}

function supportsGPT(result) {
  if (!result.ok || unsupported(result.body)) return false;
  if ([200,401,404].includes(result.code)) return true;
  return result.code === 403 ? null : (result.code > 0 && result.code < 500);
}

function supportsGemini(result) {
  if (!result.ok || unsupported(result.body) || /gemini is currently unavailable/i.test(result.body)) return false;
  if (result.code >= 200 && result.code < 400) return true;
  return result.code === 403 ? null : false;
}

function sentToChina(result) {
  if (!result.ok) return null;
  return result.code === 400;
}

function latencyPoints(ms) {
  if (ms === null) return 0;
  if (ms <= 200) return 15;
  if (ms <= 400) return 13;
  if (ms <= 600) return 10;
  if (ms <= 900) return 7;
  if (ms <= 1500) return 3;
  return 1;
}

function yesPoints(value, points) {
  return value === true ? points : value === null ? Math.round(points / 3) : 0;
}

function testNode(node, latencyMap) {
  const latency = latencyValue(latencyMap[node]);
  return Promise.all([
    lookupIp(node),
    fetchThrough(node, "https://chatgpt.com/backend-api/models", {Accept:"application/json"}),
    fetchThrough(node, "https://gemini.google.com/app"),
    fetchThrough(node, "https://www.google.com/maps/timeline", {Accept:"text/html,application/xhtml+xml"})
  ]).then(values => {
    const ip = values[0];
    const gpt = supportsGPT(values[1]);
    const gemini = supportsGemini(values[2]);
    const sent = sentToChina(values[3]);
    const fraud = fraudScore(ip);
    const costs = values.slice(1).filter(v => v && v.ok).map(v => v.cost);
    const effectiveLatency = latency !== null ? latency :
      (costs.length ? Math.round(costs.reduce((a,b) => a+b,0) / costs.length) : null);
    const ipPoints = fraud === null ? 8 : Math.round(30 * (100-fraud) / 100);
    const score = Math.max(0, Math.min(100,
      yesPoints(gpt,20) + yesPoints(gemini,20) +
      (sent === false ? 15 : sent === null ? 5 : 0) +
      ipPoints + latencyPoints(effectiveLatency)
    ));
    return {
      node, ip, gpt, gemini, sent, fraud,
      purity:purity(fraud), latency:effectiveLatency, score
    };
  });
}

function mark(value) {
  return value === true ? "✅" : value === false ? "❌" : "⚠️";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function country(item) {
  return COUNTRY_ZH[item.ip.cc] || item.ip.cc || "未知";
}

function render(policy, results, total) {
  const top = results.slice(0,3);
  const topHtml = top.map((item,i) =>
    `<div class="top"><b>${i+1}. ${escapeHtml(item.node)}</b><span>${item.score}分</span></div>`
  ).join("");

  const allHtml = results.map((item,i) => {
    const fraud = item.fraud === null ? "未知" : item.fraud;
    const sent = item.sent === null ? "⚠️未知" : item.sent ? "❌是" : "✅否";
    const latency = item.latency === null ? "超时" : item.latency + "ms";
    return `<section>
      <h3>${i+1}. ${escapeHtml(item.node)}</h3>
      <div class="grid">
        <span>国家：<b>${escapeHtml(country(item))}</b></span>
        <span>欺诈分：<b>${fraud}</b></span>
        <span>IP纯净度：<b>${item.purity}</b></span>
        <span>是否送中：<b>${sent}</b></span>
        <span>GPT：<b>${mark(item.gpt)}</b></span>
        <span>Gemini：<b>${mark(item.gemini)}</b></span>
      </div>
      <small>IP：${escapeHtml(item.ip.ip)}　延迟：${latency}　综合：${item.score}分</small>
    </section>`;
  }).join("");

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{font-family:-apple-system;margin:0;padding:16px;background:#f4f6f8;color:#111}
    h1{font-size:21px;margin:0 0 4px}.sub{color:#667085;font-size:13px;margin-bottom:14px}
    .rank{background:#fff3cd;border-radius:12px;padding:10px 12px;margin-bottom:14px}
    .top{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f0d98a}.top:last-child{border:0}
    section{background:#fff;border-radius:12px;padding:12px;margin:10px 0;box-shadow:0 1px 4px #00000012}
    h3{font-size:15px;margin:0 0 9px;word-break:break-all}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;font-size:13px}
    small{display:block;color:#667085;margin-top:9px;word-break:break-all}
  </style></head><body>
  <h1>${escapeHtml(policy)} · 节点检测</h1>
  <div class="sub">完成 ${results.length}/${total} 个；欺诈分越低越好</div>
  <div class="rank"><b>🏆 前三名</b>${topHtml}</div>
  ${allHtml}</body></html>`;
}

function finishError(title, text) {
  $done({title, htmlMessage:`<p style="font-family:-apple-system;padding:18px;white-space:pre-wrap">${escapeHtml(text)}</p>`});
}

const policy = selectedPolicy();

getNodesForPolicy(policy).then(nodes => {
  if (!nodes.length) throw new Error("所选机场策略组没有读取到节点");
  $notify("节点分数排名", policy, `开始检测 ${nodes.length} 个节点，请保持 QuanX 在前台`);
  return getLatencyMap(nodes).then(latencyMap =>
    mapLimit(nodes, CONFIG.concurrency, node => testNode(node, latencyMap))
  ).then(raw => {
    const valid = raw.filter(item => item && !item.error && typeof item.score === "number");
    valid.sort((a,b) => b.score-a.score || (a.latency || 999999)-(b.latency || 999999));
    if (!valid.length) throw new Error("全部节点检测失败，请检查节点状态");
    const topText = valid.slice(0,3).map((item,i) => `${i+1}. ${item.node}（${item.score}分）`).join("\n");
    $notify("节点分数排名 · 前三名", policy, topText);
    $done({title:policy + " · 节点检测", htmlMessage:render(policy,valid,nodes.length)});
  });
}).catch(error => {
  if (error && error.message === "NO_POLICY") {
    const names = error.policies && error.policies.length ? error.policies.join("\n• ") : "未读取到策略组";
    finishError("请选择机场策略组", "请回到 QuanX 首页，长按一个机场策略组，再选择“节点分数排名”。\n\n可用策略组：\n• " + names);
  } else {
    finishError("节点分数排名", String(error && error.message ? error.message : error));
  }
});
