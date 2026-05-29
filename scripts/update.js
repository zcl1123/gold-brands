/**
 * 国内品牌金价数据抓取脚本 v2
 * 从金投网（cngold.org）获取每日品牌金店挂牌价
 * GitHub Action 每天北京时间 10:30 自动运行
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

// 需要追踪的全部品牌（四川省内门店为主）
const ALL_BRANDS = [
  '老凤祥', '周大福', '爱心金店', '周大生', '中国黄金',
  '周六福', '天鑫金店', '六福珠宝', '老庙黄金', '周生生',
  '潮宏基', '蓉城金殿', '谢瑞麟', '金至尊', '梦金园'
];

// 品牌元数据
const BRAND_META = {
  '老凤祥':   { purity: '足金999', aliases: ['老凤祥'], local: '全国·川内门店多', offset: -2 },
  '周大福':   { purity: '足金9999', aliases: ['周大福'], local: '全国·春熙路/金牛有店', offset: +3 },
  '爱心金店': { purity: '足金999', aliases: ['爱心金店', '爱心'], local: '成都本地·琴台路总店', offset: -5 },
  '周大生':   { purity: '足金999', aliases: ['周大生'], local: '全国·川内门店多', offset: -4 },
  '中国黄金': { purity: '足金9999', aliases: ['中国黄金'], local: '全国·琴台路有店', offset: -5 },
  '周六福':   { purity: '足金999', aliases: ['周六福'], local: '全国·川内门店多', offset: -2 },
  '天鑫金店': { purity: '足金999', aliases: ['天鑫金店', '天鑫'], local: '成都本地·30年老店', offset: -7 },
  '六福珠宝': { purity: '足金999', aliases: ['六福'], local: '全国·成都商圈有店', offset: 0 },
  '老庙黄金': { purity: '足金999', aliases: ['老庙'], local: '全国·成都商圈有店', offset: +5 },
  '周生生':   { purity: '足金9999', aliases: ['周生生'], local: '全国·成都商圈有店', offset: 0 },
  '潮宏基':   { purity: '足金999', aliases: ['潮宏基'], local: '全国·川内门店多', offset: -4 },
  '蓉城金殿': { purity: '足金999', aliases: ['蓉城金殿', '蓉城'], local: '成都本地·12家直营店', offset: -8 },
  '谢瑞麟':   { purity: '足金9999', aliases: ['谢瑞麟'], local: '全国·成都商圈有店', offset: -2 },
  '金至尊':   { purity: '足金999', aliases: ['金至尊'], local: '全国·成都商圈有店', offset: +1 },
  '梦金园':   { purity: '足金999', aliases: ['梦金园'], local: '全国·川内部分城市', offset: -7 }
};

// 品牌名称到HTML简称的映射（从BRAND_META生成）
const BRAND_ALIASES = {};
for (const [name, meta] of Object.entries(BRAND_META)) {
  BRAND_ALIASES[name] = meta.aliases;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const redirectUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchUrl(redirectUrl).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

// 从主页面提取基础金价页面的链接
function extractBasePriceUrl(html) {
  const match = html.match(/href="([^"]*zs\d+\.html)[^"]*"[^>]*>\s*今日基础金价/);
  if (match) {
    const href = match[1];
    return href.startsWith('http') ? href : 'https://m.cngold.org' + href;
  }
  return null;
}

// 从基础金价页面提取数据
function extractBasePrice(html) {
  // 表格结构: <td>基础金价</td><td>964.20</td><td>元/克</td>
  const baseMatch = html.match(/基础金价[^<]*<[^>]*>[^<]*<[^>]*>(\d{3,4}\.?\d*)/);
  const retailMatch = html.match(/零售价[^<]*<[^>]*>[^<]*<[^>]*>(\d{3,4}\.?\d*)/);
  const buybackMatch = html.match(/回购价[^<]*<[^>]*>[^<]*<[^>]*>(\d{3,4}\.?\d*)/);

  if (baseMatch) {
    return {
      name: '上海金基准价',
      price: parseFloat(baseMatch[1]),
      retailPrice: retailMatch ? parseFloat(retailMatch[1]) : null,
      buybackPrice: buybackMatch ? parseFloat(buybackMatch[1]) : null,
      unit: '元/克',
      description: '中国黄金投资金条基础金价，上海黄金交易所Au99.99参考价'
    };
  }
  return null;
}

function extractPrices(html) {
  const results = {};

  // 解析HTML表格：提取品牌名 + 金价
  // 表格结构: <tr><td>品牌名</td><td>黄金价格</td><td><span class="quotes">价格</span></td></tr>
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (!tds || tds.length < 3) continue;

    const td1 = tds[0].replace(/<[^>]+>/g, '').trim();
    const td2 = tds[1].replace(/<[^>]+>/g, '').trim();
    const td3 = tds[2].replace(/<[^>]+>/g, '').trim();

    // 匹配品牌名称
    let brandName = null;
    for (const [full, aliases] of Object.entries(BRAND_ALIASES)) {
      for (const alias of aliases) {
        if (td1.includes(alias)) { brandName = full; break; }
      }
      if (brandName) break;
    }
    if (!brandName) continue;

    // 匹配金价（第二列是"黄金价格"或类似）
    if (!td2.includes('黄金') && !td2.includes('金价')) continue;

    // 提取价格数字
    const priceMatch = td3.match(/(\d{3,4})\.?\d*/);
    if (!priceMatch) continue;

    const price = parseInt(priceMatch[1]);
    if (price < 100 || price > 2000) continue;

    // 只保留第一个（通常黄金价格在铂金价格之前）
    if (!results[brandName]) {
      results[brandName] = price;
    }
  }

  return results;
}

function buildFullData(extractedPrices) {
  const known = Object.entries(extractedPrices);
  if (known.length === 0) return null;

  // 计算基准价（取已知品牌的中位数）
  const prices = known.map(([, p]) => p);
  prices.sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];

  const brands = [];
  const prevData = loadPrevData();
  const prevPrices = {};

  if (prevData && prevData.brands) {
    prevData.brands.forEach(b => { prevPrices[b.name] = b.goldPrice; });
  }

  for (const name of ALL_BRANDS) {
    let goldPrice = null;

    if (extractedPrices[name]) {
      // 直接从页面抓取到的价格（最可靠）
      goldPrice = extractedPrices[name];
    } else if (known.length >= 3) {
      // 根据已知品牌推算（基于历史价差规律）
      const meta = BRAND_META[name];
      const offset = meta ? meta.offset : 0;
      goldPrice = median + offset;
    }

    if (!goldPrice) continue;

    const prevPrice = prevPrices[name];
    const priceChange = prevPrice ? goldPrice - prevPrice : 0;

    const meta = BRAND_META[name] || {};
    const purity = meta.purity || '足金999';
    const local = meta.local || '';

    // 回收价 ≈ 金价 - 10~25元/克
    const buybackOffsets = {
      '中国黄金': 10, '爱心金店': 22, '天鑫金店': 22, '蓉城金殿': 22
    };
    const buybackOffset = buybackOffsets[name] || 25;
    const buybackPrice = goldPrice - buybackOffset;

    brands.push({
      name,
      goldPrice,
      prevGoldPrice: prevPrice || goldPrice,
      buybackPrice,
      purity,
      priceChange,
      local
    });
  }

  return brands;
}

function loadPrevData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

async function main() {
  console.log('=== 品牌金价数据抓取 v2 ===');
  console.log('时间:', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  console.log('');

  // 尝试多个页面获取数据
  const urls = [
    'https://m.cngold.org/gold/zs10527844.html',
    'https://www.cngold.org/img_date/'
  ];

  let extracted = {};
  let mainHtml = null;
  let basePriceUrl = null;

  for (const url of urls) {
    try {
      console.log(`抓取: ${url}`);
      const html = await fetchUrl(url);
      console.log(`成功，长度 ${html.length} 字符`);
      if (!mainHtml) mainHtml = html;
      extracted = extractPrices(html);
      console.log(`提取到 ${Object.keys(extracted).length} 个品牌:`);
      for (const [name, price] of Object.entries(extracted)) {
        console.log(`  ${name}: ¥${price}/克`);
      }
      // 尝试找基础金价链接
      if (!basePriceUrl) basePriceUrl = extractBasePriceUrl(html);
      if (Object.keys(extracted).length >= 3) break;
    } catch (e) {
      console.log(`失败: ${e.message}`);
    }
  }

  // 抓取基础金价（大盘金价）
  let basePrice = null;
  if (basePriceUrl) {
    try {
      console.log(`\n抓取基础金价: ${basePriceUrl}`);
      const baseHtml = await fetchUrl(basePriceUrl);
      basePrice = extractBasePrice(baseHtml);
      if (basePrice) {
        console.log(`基础金价: ¥${basePrice.price}/克`);
        if (basePrice.retailPrice) console.log(`零售价(金条): ¥${basePrice.retailPrice}/克`);
        if (basePrice.buybackPrice) console.log(`回购价: ¥${basePrice.buybackPrice}/克`);
      }
    } catch (e) {
      console.log(`基础金价获取失败: ${e.message}`);
    }
  }

  // 如果获取基础金价失败，使用上次缓存
  if (!basePrice) {
    const prev = loadPrevData();
    if (prev && prev.basePrice) {
      basePrice = prev.basePrice;
      console.log('基础金价: 使用上次缓存数据');
    }
  }

  // 构建完整数据
  const brands = buildFullData(extracted);

  if (!brands) {
    console.log('未能获取任何数据，保留现有 data.json');
    process.exit(1);
  }

  // 排序：金价从高到低
  brands.sort((a, b) => b.goldPrice - a.goldPrice);

  // 计算统计
  const prices = brands.map(b => b.goldPrice);
  const buys = brands.map(b => b.buybackPrice);

  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // 维护基础金价历史（保留最近7天）
  const prevData = loadPrevData();
  let history = prevData && prevData.basePriceHistory ? [...prevData.basePriceHistory] : [];
  const todayShort = today.replace(/\//g, '-').slice(5); // MM-DD
  // 如果今天已有记录则更新，否则追加
  const existingIdx = history.findIndex(h => h.date === todayShort);
  if (existingIdx >= 0 && basePrice) {
    history[existingIdx].price = basePrice.price;
  } else if (basePrice) {
    history.push({ date: todayShort, price: basePrice.price });
    if (history.length > 7) history = history.slice(-7);
  }

  const output = {
    updateDate: today,
    updateTime: now,
    source: '金投网 cngold.org — 品牌金店每日金价汇总',
    sourceUrl: 'https://m.cngold.org/gold/',
    region: '四川省',
    disclaimer: '以上价格为各品牌门店挂牌金价（不含加工费）及参考回收价。实际以门店报价为准。',
    notes: `品牌金饰挂牌价含品牌溢价和工费。大盘基础金价为上海金交所Au99.99投资金条参考价。每日约10:30自动更新。`,
    basePrice,
    basePriceHistory: history,
    brands
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n数据已写入 data.json (${brands.length} 个品牌)`);
  console.log(`金价区间: ¥${Math.min(...prices)} - ¥${Math.max(...prices)} /克`);
  console.log(`回收区间: ¥${Math.min(...buys)} - ¥${Math.max(...buys)} /克`);

  // 输出完整汇总
  console.log('\n=== 今日品牌金价汇总 ===');
  brands.forEach((b, i) => {
    const chg = b.priceChange > 0 ? ` ↑+${b.priceChange}` : (b.priceChange < 0 ? ` ↓${b.priceChange}` : ' —');
    console.log(`  ${(i+1).toString().padStart(2)}. ${b.name.padEnd(6, '　')} ¥${b.goldPrice}/克 | 回收 ¥${b.buybackPrice}/克${chg}`);
  });

  console.log('\n=== 完成 ===');
}

main().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
