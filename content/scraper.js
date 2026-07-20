// 页面信息抓取【迁移核心】：自包含 IIFE、零 chrome.* 依赖。
// 由 chrome.scripting.executeScript({files}) 注入，最后一个表达式的值即注入结果。
// 四层 fallback：SITE_RULES 规则表 → og meta → title 拆分 → h1/hostname 兜底，
// confidence 记录每个字段的取值来源（site-rule / og / title / fallback / hostname / none）。
(() => {
  const hostname = location.hostname.toLowerCase();

  // ---------- 工具 ----------
  const text = (selectors) => {
    for (const sel of selectors.split(',')) {
      let el;
      try { el = document.querySelector(sel.trim()); } catch { continue; }
      const t = el && el.textContent && el.textContent.trim().replace(/\s+/g, ' ');
      if (t) return t.slice(0, 60);
    }
    return '';
  };

  const og = (prop) => {
    const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    return ((el && el.getAttribute('content')) || '').trim();
  };

  const genericPosition = () => text(
    'h1, [class*="job-title"], [class*="jobTitle"], [class*="job-name"], [class*="jobName"], ' +
    '[class*="position-name"], [class*="positionName"], [class*="position-title"], [class*="job_name"]'
  );

  // ---------- 第 3 层：标题拆分（第 1/2 层规则也会复用） ----------
  const RECRUIT_WORDS = /校园招聘|社会招聘|招聘|校招|社招|人才|加入我们|诚聘|Careers?|Jobs?|Recruit(?:ing|ment)?|Hiring|Join\s?Us/i;

  function splitSegments(str) {
    return (str || '').split(/\s*[|｜\-–—_·»【】]\s*/).map(s => s.trim()).filter(Boolean);
  }

  // 含招聘关键词的段，剥掉关键词后作为公司名（招聘站 title 惯例："岗位名-公司招聘"）
  function titleCompany(str) {
    for (const seg of splitSegments(str === undefined ? document.title : str)) {
      if (RECRUIT_WORDS.test(seg)) {
        const cleaned = seg
          .replace(new RegExp(RECRUIT_WORDS.source, 'gi'), '')
          .replace(/官网|首页|网站/g, '')
          .trim();
        if (cleaned) return cleaned.slice(0, 30);
      }
    }
    return '';
  }

  // 不含招聘关键词的最长段作为岗位名
  function titlePosition(str) {
    const segs = splitSegments(str === undefined ? document.title : str)
      .filter(s => !RECRUIT_WORDS.test(s));
    if (!segs.length) return '';
    return segs.sort((a, b) => b.length - a.length)[0].slice(0, 60);
  }

  // ---------- 第 4 层：hostname 兜底取公司 ----------
  function hostnameCompany() {
    const GENERIC = new Set([
      'www', 'careers', 'career', 'jobs', 'job', 'talent', 'talents', 'hr',
      'join', 'campus', 'zhaopin', 'recruit', 'recruitment', 'hire', 'hiring',
      'app', 'm', 'wap', 'apply'
    ]);
    const TLD = new Set(['com', 'cn', 'net', 'org', 'io', 'co', 'hk', 'tw', 'jp', 'us', 'ai', 'dev']);
    const core = hostname.split('.').filter(p => !GENERIC.has(p) && !TLD.has(p));
    return core.length ? core[core.length - 1] : hostname;
  }

  // ---------- 第 1 层：站点规则表（最高置信度） ----------
  // company/position 可为静态字符串或函数 (hostname) => string。
  // 贡献规则：加一条即可，无需改动下方提取引擎。
  const SITE_RULES = [
    // —— 大厂自建官网 ——
    { match: h => h === 'careers.tencent.com', company: '腾讯',
      position: () => text('.job-detail-title, h1') || genericPosition() },
    { match: h => h === 'join.qq.com', company: '腾讯', position: genericPosition },
    { match: h => h === 'talent.alibaba.com', company: '阿里巴巴', position: genericPosition },
    { match: h => h === 'jobs.bytedance.com', company: '字节跳动',
      position: () => text('h1, [class*="postTitle"]') || genericPosition() },
    { match: h => h === 'careers.jd.com' || h === 'zhaopin.jd.com', company: '京东', position: genericPosition },
    { match: h => h === 'zhaopin.meituan.com', company: '美团', position: genericPosition },
    { match: h => h === 'talent.baidu.com', company: '百度', position: genericPosition },
    { match: h => h === 'careers.pinduoduo.com', company: '拼多多', position: genericPosition },
    { match: h => h.endsWith('.xiaohongshu.com') && /job|career|talent/.test(h), company: '小红书', position: genericPosition },
    { match: h => h === 'hr.163.com' || h === 'campus.163.com', company: '网易', position: genericPosition },

    // —— 招聘 SaaS：一条规则覆盖数百家公司 ——
    { match: h => h.endsWith('.mokahr.com'), // Moka
      company: () => og('og:site_name') || titleCompany(),
      position: () => text('h1, [class*="jobTitle"], [class*="job-title"]') || genericPosition() },
    { match: h => h.endsWith('.beisen.com') || h.includes('hotjob'), // 北森
      company: () => og('og:site_name') || titleCompany(),
      position: () => text('h1, .job-name, [class*="positionName"]') || genericPosition() },
    { match: h => h.endsWith('.dayee.com'), // 用友大易
      company: () => og('og:site_name') || titleCompany(),
      position: genericPosition },
    { match: h => h.endsWith('.myworkdayjobs.com'), // Workday：公司名即子域名
      company: h => h.split('.')[0],
      position: () => text('h1[data-automation-id="jobPostingHeader"], h1') },
    { match: h => h.includes('.successfactors.'), // SAP SuccessFactors
      company: () => og('og:site_name') || titleCompany(),
      position: genericPosition },
    { match: h => h.endsWith('.greenhouse.io'),
      company: () => og('og:site_name') || titleCompany(),
      position: () => text('h1.app-title, h1') },
    { match: h => h.endsWith('.lever.co'), // jobs.lever.co/<company>/...
      company: () => og('og:site_name') || titleCompany() ||
        (location.pathname.split('/').filter(Boolean)[0] || ''),
      position: () => text('.posting-headline h2, h2, h1') }
  ];

  // ---------- 主流程：逐层 fallback，记录置信度 ----------
  let company = '';
  let position = '';
  const confidence = { company: 'none', position: 'none' };

  const rule = SITE_RULES.find(r => { try { return r.match(hostname); } catch { return false; } });
  if (rule) {
    try {
      company = typeof rule.company === 'function' ? rule.company(hostname) : rule.company;
      if (company) confidence.company = 'site-rule';
    } catch { /* 规则失败继续走下层 */ }
    try {
      position = typeof rule.position === 'function' ? rule.position(hostname) : rule.position;
      if (position) confidence.position = 'site-rule';
    } catch { /* 同上 */ }
  }

  // 第 2 层：Open Graph meta
  if (!company) {
    company = og('og:site_name').slice(0, 30);
    if (company) confidence.company = 'og';
  }
  if (!position) {
    const ogTitle = og('og:title');
    if (ogTitle) {
      position = /[|｜\-–—_·»]/.test(ogTitle) ? titlePosition(ogTitle) : ogTitle.slice(0, 60);
      if (position) confidence.position = 'og';
    }
  }

  // 第 3 层：document.title 拆分
  if (!company) {
    company = titleCompany();
    if (company) confidence.company = 'title';
  }
  if (!position) {
    position = titlePosition();
    if (position) confidence.position = 'title';
  }

  // 第 4 层：兜底（低置信度，侧边栏中高亮提醒核对）
  if (!position) {
    position = genericPosition();
    if (position) confidence.position = 'fallback';
  }
  if (!company) {
    company = hostnameCompany();
    if (company) confidence.company = 'hostname';
  }

  return {
    company,
    position,
    url: location.href,
    pageTitle: document.title,
    confidence
  };
})();
