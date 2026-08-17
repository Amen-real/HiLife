// utils/openfoodfacts.js
// 封装 Open Food Facts 免费开源 API：条码查询 + 名称搜索 + 营养归一化
// 文档：https://openfoodfacts.github.io/api-documentation/
//
// 重要：
// 1) 生产环境需在小程序后台「开发设置 → 服务器域名 → request 合法域名」添加
//    https://world.openfoodfacts.org （仅 HTTPS、需备案/登记）。
// 2) 开发阶段 project.config.json 已设 urlCheck:false，可直接联调。
// 3) Open Food Facts 提供「条码 + 名称」查询，不含「拍照识别食物图像」能力；
//    若需拍菜品图直接识别热量，需接入视觉模型（如自托管 CalorieScan）。

const BASE = 'https://world.openfoodfacts.org';
// OFF 官方建议携带 UA 以便溯源；部分微信版本会覆盖，但不影响功能
const HEADERS = { 'User-Agent': 'HiLife/1.0 (health-tracking miniprogram)' };

function req(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: url,
      method: 'GET',
      header: HEADERS,
      timeout: 15000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error('HTTP ' + res.statusCode));
      },
      fail: (err) => reject(err)
    });
  });
}

function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

// 从 product 对象提取「每 100g / 100ml」营养
function extractNutrients(p) {
  const n = (p && p.nutriments) || {};
  // 优先用 kcal；无则把 kJ 折成 kcal（1 kcal ≈ 4.184 kJ）
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null && num(n['energy_100g']) != null) {
    kcal = Math.round(num(n['energy_100g']) / 4.184);
  }
  return {
    kcal: kcal,
    protein: num(n['proteins_100g']),
    fat: num(n['fat_100g']),
    carbs: num(n['carbohydrates_100g']),
    sugars: num(n['sugars_100g']),
    saturatedFat: num(n['saturated-fat_100g']),
    fiber: num(n['fiber_100g']),
    salt: num(n['salt_100g']),
    sodium: num(n['sodium_100g'])
  };
}

// 归一化单个商品为页面可用的稳定结构
function normalizeProduct(p) {
  if (!p) return null;
  const grade = (p.nutriscore_grade || '').toUpperCase();
  return {
    code: p.code || '',
    name: p.product_name || p.product_name_zh || p.product_name_en || '未命名商品',
    brand: p.brands || '',
    image: p.image_front_url || p.image_url || '',
    servingSize: p.serving_size || '',
    nutriScore: grade || null,
    novaGroup: p.nova_group != null ? p.nova_group : null,
    categories: (p.categories_tags || []).map((t) => String(t).replace(/^en:/, '')).slice(0, 3),
    per100g: extractNutrients(p)
  };
}

// 按条码查询完整商品（含全部营养成分）
async function getProductByBarcode(barcode) {
  const data = await req(BASE + '/api/v2/product/' + encodeURIComponent(barcode) + '.json');
  if (!data || data.status !== 1 || !data.product) {
    const e = new Error('未找到该商品');
    e.notFound = true;
    throw e;
  }
  return normalizeProduct(data.product);
}

// 名称/关键词搜索（返回精简列表，点选后再拉完整营养）
async function searchProducts(query, page, pageSize) {
  page = page || 1;
  pageSize = pageSize || 20;
  const q = encodeURIComponent(query);
  const url = BASE + '/cgi/search.pl?search_terms=' + q +
    '&search_simple=1&action=process&json=1&page=' + page + '&page_size=' + pageSize;
  const data = await req(url);
  const list = (data && data.products) || [];
  return list
    .filter((p) => p && (p.product_name || p.code))
    .map((p) => {
      const grade = (p.nutriscore_grade || '').toUpperCase();
      return {
        code: p.code || '',
        name: p.product_name || '未命名商品',
        brand: p.brands || '',
        image: p.image_front_url || p.image_url || '',
        nutriScore: grade || null
      };
    });
}

module.exports = {
  BASE: BASE,
  getProductByBarcode: getProductByBarcode,
  searchProducts: searchProducts,
  normalizeProduct: normalizeProduct
};
