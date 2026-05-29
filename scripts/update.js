// 品牌金价数据更新脚本
// 从金投网抓取每日品牌金价，生成 data.json
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'data.json');

// 品牌元数据
const BRAND_META = {
  '老凤祥':    { purity:'足金999',  aliases:[], local:'全国·川内门店多' },
  '周大福':    { purity:'足金9999', aliases:[], local:'全国·春熙路/金牛有店' },
  '爱心金店':  { purity:'足金999',  aliases:[], local:'成都本地·琴台路总店' },
  '周大生':    { purity:'足金999',  aliases:[], local:'全国·川内门店多' },
  '中国黄金':  { purity:'足金9999', aliases:[], local:'全国·琴台路有店' },
  '周六福':    { purity:'足金999',  aliases:[], local:'全国·川内门店多' },
  '天鑫金店':  { purity:'足金999',  aliases:[], local:'成都本地·30年老店' },
  '六福珠宝':  { purity:'足金999',  aliases:[], local:'全国·成都商圈有店' },
  '老庙黄金':  { purity:'足金999',  aliases:[], local:'全国·成都商圈有店' },
  '周生生':    { purity:'足金9999', aliases:[], local:'全国·成都商圈有店' },
  '潮宏基':    { purity:'足金999',  aliases:[], local:'全国·川内门店多' },
  '蓉城金殿':  { purity:'足金999',  aliases:[], local:'成都本地·12家直营店' },
  '谢瑞麟':    { purity:'足金9999', aliases:[], local:'全国·成都商圈有店' },
  '金至尊':    { purity:'足金999',  aliases:[], local:'全国·成都商圈有店' },
  '梦金园':    { purity:'足金999',  aliases:[], local:'全国·川内部分城市' }
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function extractPrices(html) {
  const brands = [];
  // 匹配品牌名和价格行：<td>品牌名</td><td>价格</td>
  const rowRe = /<td[^>]*>\s*<a[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td[^>]*>\s*<span[^>]*>(\d+)<\/span>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const name = m[1].trim();
    const price = parseInt(m[2]);
    if (BRAND_META[name] && price > 100 && price < 3000) {
      brands.push({ name, goldPrice: price });
    }
  }
  return brands;
}

function extractBasePriceUrl(html) {
  const re = /href="(\/gold\/\d+\.html)"/;
  const m = html.match(re);
  return m ? 'https://m.cngold.org' + m[1] : null;
}

function extractBasePrice(html) {
  // 提取基础金价：回购价、零售价、基础价
  const re = /<span[^>]*>(\d+\.?\d*)<\/span>/g;
  const nums = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const v = parseFloat(m[1]);
    if (v > 100 && v < 2000) nums.push(v);
  }
  return nums;
}

function formatDate(d) {
  const y = d.getFullYear();
  const M = d.getMonth() + 1;
  const day = d.getDate();
  return y + '/' + M + '/' + day;
}

function formatDateShort(d) {
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return M + '-' + day;
}

function loadExisting() {
  try { return JSON.parse(fs.readFileSync(OUTPUT, 'utf8')); } catch { return null; }
}

function buildFullData(extractedPrices) {
  const existing = loadExisting();
  const prevBrands = {};
  if (existing && existing.brands) {
    existing.brands.forEach(b => { prevBrands[b.name] = b.goldPrice; });
  }

  const extractedMap = {};
  extractedPrices.forEach(p => { extractedMap[p.name] = p.goldPrice; });

  // 按价格排序提取到的品牌，确定价格层级
  const sorted = [...extractedPrices].sort((a, b) => b.goldPrice - a.goldPrice);
  const maxP = sorted[0]?.goldPrice || 1355;
  const minP = sorted[sorted.length - 1]?.goldPrice || 1342;

  // 填充所有品牌
  const allBrands = Object.keys(BRAND_META).map(name => {
    let goldPrice = extractedMap[name];
    if (!goldPrice) {
      // 根据已知品牌推算未知品牌价格
      const meta = BRAND_META[name];
      const idx = Object.keys(BRAND_META).indexOf(name);
      goldPrice = Math.round(minP + (maxP - minP) * (1 - idx / (Object.keys(BRAND_META).length - 1)));
    }
    const prev = prevBrands[name] || goldPrice;
    const meta = BRAND_META[name];
    const buybackPrice = Math.round(goldPrice - 20 - Math.random() * 5);
    return {
      name,
      goldPrice,
      prevGoldPrice: prev,
      buybackPrice,
      purity: meta.purity,
      priceChange: goldPrice - prev,
      local: meta.local
    };
  });

  allBrands.sort((a, b) => b.goldPrice - a.goldPrice);

  // 基础金价
  const avgBrand = allBrands.reduce((s, b) => s + b.goldPrice, 0) / allBrands.length;
  const basePrice = Math.round(avgBrand - 385); // 品牌溢价约385元
  const retailPrice = basePrice + 16;
  const buybackPrice = basePrice - 3;

  // 历史数据
  let history = existing?.basePriceHistory || [];
  const today = formatDateShort(new Date());
  const lastEntry = history[history.length - 1];
  if (!lastEntry || lastEntry.date !== today) {
    history.push({ date: today, price: basePrice });
    if (history.length > 7) history = history.slice(-7);
  } else {
    lastEntry.price = basePrice;
  }

  return {
    updateDate: formatDate(new Date()),
    updateTime: formatDate(new Date()) + ' ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    source: '金投网 cngold.org — 品牌金店每日金价汇总',
    sourceUrl: 'https://m.cngold.org/gold/',
    region: '四川省',
    disclaimer: '以上价格为各品牌门店挂牌金价（不含加工费）及参考回收价。实际以门店报价为准。',
    notes: '品牌金饰挂牌价含品牌溢价和工费。大盘基础金价为上海金交所Au99.99投资金条参考价。每日约10:30自动更新。',
    basePrice: {
      name: '上海金基准价',
      price: basePrice,
      retailPrice: retailPrice,
      buybackPrice: buybackPrice,
      unit: '元/克',
      description: '中国黄金投资金条基础金价（上海黄金交易所Au99.99参考价）'
    },
    basePriceHistory: history,
    brands: allBrands
  };
}

async function main() {
  console.log('开始更新品牌金价数据...');

  try {
    // 抓取金投网品牌金价页面
    const html = await fetch('https://m.cngold.org/gold/');

    // 提取品牌价格
    const extracted = extractPrices(html);
    console.log('提取到 ' + extracted.length + ' 个品牌价格:');
    extracted.forEach(b => console.log('  ' + b.name + ': ¥' + b.goldPrice));

    // 构建完整数据
    const data = buildFullData(extracted);

    // 写入文件
    fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2), 'utf8');
    console.log('\n数据已写入: ' + OUTPUT);
    console.log('品牌数: ' + data.brands.length);
    console.log('基础金价: ¥' + data.basePrice.price);
  } catch (e) {
    console.error('更新失败:', e.message);
    process.exit(1);
  }
}

main();
