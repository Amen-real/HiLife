// utils/metrics.js —— 轻量本地埋点（服务 A3：识别纠错 + 本地知识库）
//
// 目标：让这两个功能的价值**可被验证**，而不是「感觉挺好」——
//   ① 纠错到底生效了没有？→ 下次识别是否真的套用了我改过的值（VISION_REUSED）
//   ② 本地知识库到底省了多少次模型调用？→ 这是**控成本唯一的硬证据**（KB_HIT）
// **不能衡量的功能等于没做。**
//
// 设计约束（每条都有具体原因，改之前先读）：
//
// 1) **独立 storage key，刻意不放进 `uu_fitness_state`。**
//    ① 用户数据键有 1MB 单键上限，而计数是只增不减的流水，混进去会加速触顶；
//    ② `store.login/logout` 会整体快照 / 恢复用户数据，统计不该被一起搬走或清空
//       （否则「退出再登录」会把数字抹掉，看板凭空跳变）。
//
// 2) **按自然日分桶**，而不是平铺成一个事件数组。跨天天然隔离；区间聚合只是挑 key；
//    裁剪等于「删旧 key」，不需要遍历重写整表。
//
// 3) **事件名收在 EVENTS 一张表里，禁止调用点写裸字符串。** 否则改个名字会悄悄
//    产生两套指标 —— 数字对不上，还查不出原因（同一类问题在 `utils/trainingStats.js`
//    的估算口径上已经吃过一次）。守卫 `scripts/verify-foodkb.cjs [C]` 会拦。
//
// 4) **所有存储操作都 try/catch 吞掉异常。** 埋点是旁路：它失败绝不能让业务崩，
//    也绝不能让「记录饮食」因为统计写不进去而失败。
//
// 5) **`KB_HIT` 只在「真的没调用模型」时 +1。** 它代表「省下的调用次数」；
//    识别后套用历史修正值**不算**省调用（模型已经跑完了，钱已经花了），那走
//    `VISION_REUSED`。两者混在一起算，看板就会把「准确率」谎报成「成本节省」——
//    而按次计费的口径下，这两个数字差一个数量级的说服力。
//
// ⚠️ 只做本地计数，**不上传任何数据**。
//
// ⚠️ A2（页面访问埋点 + 「我的一周」看板）**已暂停**，因此原先的 `pv()` /
//    `MAX_PV_PAGES` / `weekSeries()` / `LOG_SAVED` / `SG_SHOWN` / `SG_APPLIED` /
//    `sgRate()` 已一并删除 —— 不留无人调用的分支（同批次刚清掉别的死模块）。
//    恢复 A2 时按需加回，并同时补 `pages/metrics` 看板页与守卫，别只加一半。
//
// 周口径复用 `utils/dateRange.js`（自然周 = 周一 00:00 起，半开 [monStr, sunStr)），
// 不在这里另写一套 —— 本项目曾因三套「本周」写法导致同一天在两页显示不同的本周。

const dateRange = require('./dateRange.js');

const KEY = 'uu_fitness_metrics';

// 只保留最近 60 天。够算「本周 / 近 4 周对比」，又不让单键无限增长。
// （知识库的「累计省下 N 次」按此窗口展示，不做「永久累计」——被裁掉的数字不该假装还在。）
const KEEP_DAYS = 60;

/**
 * 事件词表单源。值是落库用的短键 —— 存储键越短，单键占用越小。
 * 新增事件时必须：
 *   a) 在这里加一项；
 *   b) 在 LABELS 里给出中文名（否则展示不出来）。
 * 守卫 `scripts/verify-foodkb.cjs [B]` 会校验两者键集完全一致。
 */
const EVENTS = {
  VISION_START: 'vs',     // 发起一次识别（= 一次潜在的模型调用，花钱的那一下）
  VISION_OK: 'vok',       // 识别成功
  VISION_FAIL: 'vfail',   // 识别失败（含未识别出食物）
  VISION_MS: 'vms',       // 识别耗时累计（毫秒，靠 addMs 累加）
  VISION_REUSED: 'vru',   // 结果套用了用户此前的修正值（纠错生效的证据）
  VISION_EDITED: 'vedit', // 结果被人工纠正（写知识库的触发点）
  KB_HIT: 'kb',           // 本地知识库命中且**没有调用模型**（省下一次调用）
  KB_LEARN: 'kbl'         // 学入 / 更新一条食物知识
};

// 事件 → 中文名。放在本模块而不是某个展示页，是为了让「新增事件」只改一处。
const LABELS = {
  vs: 'AI 识别次数',
  vok: '识别成功',
  vfail: '识别失败',
  vms: '识别耗时(ms)',
  vru: '套用修正值',
  vedit: '结果被纠正',
  kb: '本地命中（省下调用）',
  kbl: '知识库新增/更新'
};

/* ---------------- 读写（全部吞异常） ---------------- */

function blank() {
  return { v: 1, days: {} };
}

function read() {
  try {
    const v = wx.getStorageSync(KEY);
    if (v && typeof v === 'object' && v.days && typeof v.days === 'object') return v;
  } catch (e) {}
  return blank();
}

function write(m) {
  try {
    wx.setStorageSync(KEY, prune(m));
  } catch (e) {}
}

// 裁剪：丢掉早于「今天 − (KEEP_DAYS − 1)」的日期桶
function prune(m) {
  const cutoff = dateRange.shiftDaysISO(dateRange.todayStr(), -(KEEP_DAYS - 1));
  const days = m.days || {};
  Object.keys(days).forEach(function (d) {
    if (d < cutoff) delete days[d];
  });
  m.days = days;
  return m;
}

// 取（必要时新建）某天的桶。桶只存一张计数表 `c`。
function bucket(m, day) {
  const days = m.days;
  if (!days[day]) days[day] = { c: {} };
  const b = days[day];
  if (!b.c) b.c = {};
  return b;
}

/* ---------------- 写入 API ---------------- */

// 计数 +1（n 可指定增量）。事件名一律传 EVENTS 里的值（或空字符串跳过）。
function inc(event, n) {
  if (!event) return;
  const step = (n == null) ? 1 : Number(n);
  if (!isFinite(step) || step === 0) return;
  const m = read();
  const b = bucket(m, dateRange.todayStr());
  b.c[event] = (b.c[event] || 0) + step;
  write(m);
}

// 累加型指标（耗时等）：存的是**总量**，平均值在读取时算。
// 不存「平均值」是因为平均值不可再聚合 —— 周平均必须由周总量 ÷ 周次数得出。
function addMs(event, ms) {
  const v = Number(ms);
  if (!event || !isFinite(v) || v < 0) return;
  inc(event, Math.round(v));
}

function reset() {
  try { wx.removeStorageSync(KEY); } catch (e) {}
}

/* ---------------- 读取 / 聚合 ---------------- */

// 原始数据（只读副本，供守卫与调试用）
function raw() {
  const m = read();
  return JSON.parse(JSON.stringify(m));
}

// 单日桶 → 事件表（缺省全 0，避免调用方到处判 undefined）
function countersOf(b) {
  const out = {};
  Object.keys(EVENTS).forEach(function (k) { out[EVENTS[k]] = 0; });
  const c = (b && b.c) || {};
  Object.keys(c).forEach(function (k) { out[k] = Number(c[k]) || 0; });
  return out;
}

/**
 * 聚合一段日期区间 [fromStr, toStr)（半开，与 dateRange 口径一致）。
 * 传 dateRange.weekRange() 的 monStr/sunStr 即得本周。
 */
function range(fromStr, toStr) {
  const m = read();
  const days = m.days || {};
  const ev = {};
  Object.keys(EVENTS).forEach(function (k) { ev[EVENTS[k]] = 0; });
  const dates = [];

  Object.keys(days).sort().forEach(function (d) {
    if (!dateRange.inRange(d, fromStr, toStr)) return;
    dates.push(d);
    const c = days[d].c || {};
    Object.keys(c).forEach(function (k) { ev[k] = (ev[k] || 0) + (Number(c[k]) || 0); });
  });

  const visionTried = ev[EVENTS.VISION_OK] + ev[EVENTS.VISION_FAIL];
  // 本地命中率 = 命中 /（命中 + 真正调过模型的次数）。这是 A3 的**成本指标**：
  // 分子每 +1 就等于少一次按次计费的模型调用。
  const kbBase = ev[EVENTS.KB_HIT] + ev[EVENTS.VISION_START];
  const ms = ev[EVENTS.VISION_MS];
  const okN = ev[EVENTS.VISION_OK];

  return {
    from: fromStr,
    to: toStr,
    days: dates.length,
    dates: dates,
    ev: ev,
    // 从「发起尝试」的角度算成功率，失败也算分母（否则失败率高时反而看着更漂亮）
    visionSuccessRate: visionTried ? Math.round(okN / visionTried * 100) : null,
    // 分母只用成功次数：失败路径可能耗时 90s（轮询超时），混进来会把均值带歪
    visionAvgSec: okN ? Math.round(ms / okN / 100) / 10 : null,  // 保留 1 位小数
    kbHitRate: kbBase ? Math.round(ev[EVENTS.KB_HIT] / kbBase * 100) : null,
    // 识别结果里有多大比例套用了用户修正值 —— 纠错是否「真的被记住」的唯一证据。
    // 分母用成功次数：失败时根本没结果可套。
    visionReuseRate: okN ? Math.round(ev[EVENTS.VISION_REUSED] / okN * 100) : null
  };
}

// 本周（自然周，复用 dateRange 单源）
function week(ref) {
  const w = dateRange.weekRange(ref);
  return range(w.monStr, w.sunStr);
}

// 今天
function today() {
  const t = dateRange.todayStr();
  return range(t, dateRange.shiftDaysISO(t, 1));
}

module.exports = {
  KEY, KEEP_DAYS,
  EVENTS, LABELS,
  inc, addMs, reset,
  raw, countersOf, range, week, today
};
