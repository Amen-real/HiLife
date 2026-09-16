// utils/foodkb.js —— 本地食物知识库（A3）
//
// 要解决的问题：多模态识别**按次计费**，而用户每天吃的就那么几样。
// 同一份早餐被拍第 8 次时再付一次费用是纯浪费；更糟的是模型每次给的估值还会小幅抖动，
// 用户纠正过的值下一次又被改回去 —— 「识别错 → 用户失去信任」。
//
// 所以：**把用户的纠正记下来，下次直接命中。**
//   ① 识别后允许改营养值 → `learn()` 落库；
//   ② 下次同签名结果出现 → `lookup()` 直接复用修正值，不再改回去；
//   ③ 手动输入时 → `lookup()` 命中即**零模型调用**成单（这是控成本的真实杠杆）。
//
// 键的设计（关键）：
//   用**整餐签名**而不是单个食物名。签名 = 各 item 名规范化后**排序**拼接。
//   为什么排序：模型返回 item 的顺序不稳定（「米饭+鸡胸」和「鸡胸+米饭」是同一餐），
//   不排序会命中不了，知识库就变成只增不减的垃圾堆。
//   为什么优先用 items：模型给的顶层 `name` 常是泛称（「识别到的食物」），
//   拿它当键会让所有识别结果挤在同一格，相互覆盖 —— 比不做还糟。
//   仅当没有 items 时才退回用顶层 name。
//
// 容量：MAX_ITEMS 上限 + 淘汰「最后使用时间」最旧的（= max(updatedAt, lastUsedAt)，
// 见 stampOf）。知识库只增不减迟早吃满存储，而「最近还在吃的东西」远比
// 「半年前吃过一次的东西」更可能再次出现 —— 常被命中的老条目不该被清掉。
//
// ⚠️ 独立 storage key，不进 `uu_fitness_state`：理由同 utils/metrics.js
// （不威胁 1MB 单键上限；login/logout 快照用户数据时不该把知识库一起搬走）。
// 所有存储操作 try/catch 吞异常 —— 知识库是加速层，它坏了顶多回到「每次都调模型」，
// 绝不能让「记录饮食」失败。

const KEY = 'uu_fitness_foodkb';

// 上限 300 条。一条约 120 字节 → 满额约 36KB，远在单键安全范围内。
const MAX_ITEMS = 300;

// 归一化时剥掉的标点（中英文都列上，避免「鸡胸肉，」与「鸡胸肉」变成两个键）
const PUNCT = /[\s\u3000，,、;；:：.。!！?？'"“”‘’()（）\[\]【】{}<>《》\-—_~·/\\|+&]/g;

// 重量/份量后缀：「100g」「半份」「2个」「3 片」等 —— 它影响的是份量，不是「这是什么食物」
const QTY = /(半|一|两|二|三|四|五|六|七|八|九|十|\d+(?:\.\d+)?)\s*(?:g|G|克|kg|KG|千克|ml|ML|毫升|升|个|份|片|碗|杯|勺|颗|只|根|块|条|袋|盒|把)/g;

/**
 * 归一化食物名 → 知识库键。
 * 目的：让用户/模型写法的微小差异命中同一条目。
 * 「鸡胸肉 100g」「鸡胸肉100克」「 鸡胸肉，」→ 全部收敛为 `鸡胸肉`。
 */
function normName(s) {
  let v = String(s == null ? '' : s).toLowerCase();
  v = v.replace(QTY, '');
  v = v.replace(PUNCT, '');
  return v;
}

/**
 * 整餐签名。`r` 形如 { name, items:[{name}] }（识别结果的形状）。
 * 有 items → 各名规范化后排序拼接；否则退回顶层 name。
 * 空结果返回 ''（调用方据此跳过读写，绝不落一个空键）。
 */
function signatureOf(r) {
  if (!r) return '';
  const items = (r.items || [])
    .map(function (it) { return normName(it && it.name); })
    .filter(Boolean);
  if (items.length) {
    // 去重：模型偶尔把同一食物拆成两条，去重后签名更稳定
    const uniq = items.filter(function (v, i) { return items.indexOf(v) === i; });
    uniq.sort();
    return uniq.join('+');
  }
  return normName(r.name);
}

/* ---------------- 读写 ---------------- */

function blank() { return { v: 1, items: {} }; }

function read() {
  try {
    const v = wx.getStorageSync(KEY);
    if (v && typeof v === 'object' && v.items && typeof v.items === 'object') return v;
  } catch (e) {}
  return blank();
}

function write(db) {
  try {
    wx.setStorageSync(KEY, evict(db));
  } catch (e) {}
}

// 「最后使用时间」= 学习时间与命中时间的较大者。
// 淘汰与列表都按它排序：一条常被命中的老条目，不该因为「很久没重新教过」被清掉 ——
// 它恰恰是最有用的那种（每天都吃）。
function stampOf(e) {
  return Math.max(Number(e.updatedAt) || 0, Number(e.lastUsedAt) || 0);
}

/**
 * 下一个时间戳：**严格大于当前最大时间戳**。
 *
 * 为什么不能直接用 Date.now()：同一毫秒内连续 learn（批量导入、脚本化测试、
 * 用户快速纠正两条）会得到相同时间戳 → 排序打平，`list()` 顺序不确定，
 * `evict()` 的受害者变成随机的。测出来的表现就是「刚学的那条不在第一位」。
 * 代价是每次 learn 扫一遍（≤300 条），可以忽略。
 */
function nextStamp(items) {
  const now = Date.now();
  let max = 0;
  Object.keys(items || {}).forEach(function (k) {
    // 用 stampOf 而不是 updatedAt：命中过的条目 lastUsedAt 可能比所有 updatedAt 都新，
    // 只扫 updatedAt 会让新学条目的时间戳反而**小于**它 → list() 里「刚学的」不在最前。
    const u = stampOf(items[k]);
    if (u > max) max = u;
  });
  return now > max ? now : max + 1;
}

// 超上限时淘汰：保留 stampOf 最大的 MAX_ITEMS 条。
// 同 stamp 时按 key 字典序兜底，保证结果确定（可断言、可复现）。
function evict(db) {
  const items = db.items || {};
  const keys = Object.keys(items);
  if (keys.length <= MAX_ITEMS) return db;
  keys.sort(function (a, b) {
    const d = stampOf(items[b]) - stampOf(items[a]);
    return d !== 0 ? d : String(a).localeCompare(String(b));
  });
  keys.slice(MAX_ITEMS).forEach(function (k) { delete items[k]; });
  return db;
}

// 数值清洗：k 为空/非数字 → null（不是 0）。0 与「不知道」是两件事，
// 看板与记录都要能区分，所以一律保留 null。
function pickNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function cleanVals(vals) {
  const v = vals || {};
  return {
    calories: pickNum(v.calories),
    protein: pickNum(v.protein),
    carb: pickNum(v.carb),
    fat: pickNum(v.fat),
    weight: pickNum(v.weight)   // 份量克重（用于「每份多少 g」）
  };
}

/* ---------------- 对外 API ---------------- */

/**
 * 学习/更新一条。`r` 是识别结果（用来算签名），`vals` 是用户确认后的营养值。
 * `displayName` 存下来是为了看板上能显示人话（键本身已被归一化，不适合展示）。
 * 返回写入的条目；签名为空时返回 null（不落空键）。
 */
function learn(r, vals, displayName) {
  const key = signatureOf(r);
  if (!key) return null;
  const db = read();
  const prev = db.items[key] || {};
  const entry = Object.assign({
    key: key,
    name: String(displayName || (r && r.name) || key),
    hits: 0,
    createdAt: Number(prev.createdAt) || Date.now()
  }, cleanVals(vals), {
    // 用户纠正次数：用于看板区分「我教过几次」与「命中复用几次」
    learns: (Number(prev.learns) || 0) + 1,
    updatedAt: Date.now()
  });
  db.items[key] = entry;
  db.items[key].updatedAt = nextStamp(db.items);   // 单调递增，见 nextStamp 注释
  write(db);
  return entry;
}

/**
 * 查一条。
 *
 * `bump` = true 时把命中数 +1（用于展示「这条帮我省了几次」）。
 * 读路径默认**不写**：避免「进页面看一眼」也产生写入与存储压力。
 *
 * 两种用法，**不要**再另开一个同义 API：
 *   · 识别后复用 → `lookup({ name, items })`，bump=false（模型已经跑完了，没有省下调用）
 *   · 手动输入命中 → `lookup({ name: '鸡胸肉' }, true)`，bump=true（这次**没调模型**）
 *
 * 为什么「手动输入的单个名字」不会撞上「多品餐」的条目（这是本模块最关键的不变量）：
 *   多品餐的键是 `米饭+鸡胸肉` 这种**含 `+` 的拼接串**；而 `normName` 会把输入里的 `+`
 *   一并剥掉（PUNCT 里有 `\+`）。所以任何单品名归一化后**永远不含 `+`**，
 *   结构上不可能等于一个多品餐键 —— 用户手输「米饭」不会拿到整餐 320kcal 的值。
 *   真需要单品值时，请在用户第一次手填时让它单独长出一条单品条目。
 *
 * ⚠️ 曾经同时存在一个 `matchByName(name)`，行为与 `lookup({ name }, bump)` 完全重合
 *    （签名都是「单品名归一化」）—— 已删除，按本项目「禁第二份实现」的约定只留一处。
 */
function lookup(r, bump) {
  const key = signatureOf(r);
  if (!key) return null;
  const db = read();
  const hit = db.items[key];
  if (!hit) return null;
  if (bump) {
    hit.hits = (Number(hit.hits) || 0) + 1;
    // 记「最后使用」但**不动 updatedAt**：命中是复用，不是重新学习。
    // 两者分开存，才能分别显示「我教过几次」与「它帮我省了几次」。
    hit.lastUsedAt = Date.now();
    write(db);
  }
  return JSON.parse(JSON.stringify(hit));
}

// 全部条目，最近「学过或命中过」的在前（展示用）
function list() {
  const db = read();
  return Object.keys(db.items)
    .map(function (k) { return db.items[k]; })
    .sort(function (a, b) {
      const d = stampOf(b) - stampOf(a);
      return d !== 0 ? d : String(a.key).localeCompare(String(b.key));
    });
}

function size() {
  return Object.keys(read().items).length;
}

function remove(key) {
  const db = read();
  if (db.items[key]) { delete db.items[key]; write(db); }
  return size();
}

function reset() {
  try { wx.removeStorageSync(KEY); } catch (e) {}
}

module.exports = {
  KEY, MAX_ITEMS,
  normName, signatureOf,
  learn, lookup, list, size, remove, reset
};
