// utils/muscleStatus.js
// 逐肌群的「疲劳 / 恢复 / 停训」三态 —— 纯函数，唯一真源。
//
// 为什么有这个模块：训练记录页已经能回答「我练了多少」，但答不了「这块肌肉现在什么状态」。
// 解剖图 (bodymap) 只能高亮「这个动作练哪里」，没有时间维度。本模块给它加上时间维度：
//   fatigued 刚练过、还没恢复到可再练的程度（提示该休或换目标肌）
//   trained  恢复得差不多、可以再上（提示可以做恢复训练或再练一次）
//   detrained 长期没练（提示该练回来了）—— 停训的「流失」是自重/无氧训练里的真实现象。
//
// 【必须遵守的三条】
//  1) 禁新建 target→slug 映射。映射真源 = utils/bodymap.js 的 SLUG（含 6 条「近似」归并），
//     本模块只 require 它的 collectSlugs / primarySlugOf / SLUG_TO_CN，不复述任何一条映射。
//     否则两处映射一漂移，疲劳就会算到邻近肌群上，而且静态守卫看不出来。
//  2) 日期一律本地日期串 'YYYY-MM-DD'，禁 toISOString()。
//     store.getWeightStats 曾用 UTC 序列化切窗口，UTC+8 在本地 00:00–08:00 会落回前一天（P0-0）。
//     本模块 require utils/dateRange.js 的 shiftDaysISO / parseISO，不自己造日期算术。
//  3) 纯函数。不 require wx / store / app，不读写任何全局，可被 node 直接单测。
//
// 模型（刻意做成一维、可解释，而不是照抄任何竞品的公式）：
//   fatigue(slug, now) = Σ_每场 强度(slug) × 0.5 ^ ((now - 该场时间) / HALF_LIFE_DAYS)
//   · HALF_LIFE_DAYS —— 半衰期：一次训练对该肌群的疲劳贡献，多久衰减到一半。
//   · 强度(slug) —— 该场对它的负荷量，优先用 RPE（最诚实），退化到组数。
//   · 这个形式的三个性质是【结构性的】，不靠运气也不靠测试凑：
//       (a) now 前移 ⇒ 每一项的指数都变小 ⇒ 疲劳单调不增（严格成立，与历史怎么排无关）；
//       (b) 扫描窗（RETENTION_DAYS）之外的场次贡献恒为 0 ⇒ 导入窗外历史不改变当前值；
//       (c) 疲劳 = 若干非负项之和 ⇒ 删掉一场只会减少一项 ⇒ 删除训练永不增加任何肌群的疲劳。
//     ⚠️ 这三条之所以能成立，前提是【只减不增】——所以下面所有阈值都必须是「只会让疲劳变小」
//        的操作。这是本文件最重要的一条不变量，改公式前先读它。

const dateRange = require('./dateRange.js');
const { collectSlugs, primarySlugOf, SLUG_TO_CN } = require('./bodymap.js');

const MS_PER_DAY = 86400000;

// 疲劳半衰期（天）。一次训练后约 2 天回到一半，7 天降到 ~8.8%，14 天 ~0.8%。
// 取值口径：与「隔天可再练同一肌群、隔周回到基础水平」的常识一致，且刻意让它
// 远小于 RETENTION_DAYS，避免「窗口边界」成为疲劳的主要贡献来源（那会让边界抖动变成噪声）。
const HALF_LIFE_DAYS = 2;

// 扫描窗（天）：只看最近这么多天的训练。早于此的历史不再影响任何判定。
// 注意这是【计算的输入范围】，不是「疲劳必须为 0」的判据——两者刻意分开，
// 这样「窗外导入不影响当前值」才成为结构性事实而非巧合。
const RETENTION_DAYS = 21;

// 三态阈值（作用在 0..1 归一化疲劳上）。
// fatique >= FATIGUED_AT ⇒ 刚练过仍有余疲劳；<= DETRAINED_AT ⇒ 久未刺激。
// 中间那段即 trained。两个阈值必须 FATIGUED_AT > DETRAINED_AT，否则中间态为空。
const FATIGUED_AT = 0.35;
const DETRAINED_AT = 0.08;

// 停训判定的天数下限：即使强度很小，也得真停够这么久才算「停训」，
// 否则一条 1 组低 RPE 的记录会把一个肌群打回 detrained 显得很吓人。
const DETRAIN_DAYS = 14;

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

// 单动作的负荷强度（0..1 量级，未做上限截断前是「相对量」）。
// 优先 RPE：它已经是 1–10 的自觉费力，且 workout 页每组都让用户填；
// 没有 RPE 时退到组数（一个不填 RPE 的用户至少还有「练了几组」这个信号）。
// ⚠️ 不要在这里再乘重量：重量受器械档位影响（15kg 杠铃 vs 侧平举小哑铃不可比），
//    而 RPE 已经隐含了「这一组对我来说多难」。乘重量会让轻器械高次数动作虚高。
function intensityOf(action) {
  if (!action || typeof action !== 'object') return 0;      // 脏数据（如 actions 里的 null）不产生任何负荷
  const detail = Array.isArray(action.setsDetail) ? action.setsDetail : [];
  if (detail.length) {
    let sum = 0, count = 0;
    detail.forEach(s => {
      const v = num(s && s.rpe);
      if (v > 0 && v <= 10) { sum += v; count++; }
    });
    if (count) return sum / count / 10;          // 1–10 → 0.1–1.0
  }
  const sets = Array.isArray(action.sets) ? num(action.sets.length) : num(action.sets);
  if (sets > 0) return Math.min(1, 0.3 + 0.1 * sets);   // 组数兜底：1 组 0.4 … 7 组封顶 1.0
  return 0.5;                                          // 连组数都没有（极旧日志）：给中位值，不给 0
}

// 一场训练 -> Map<slug, 强度>。
// 用 collectSlugs（含 target / muscle_group / secondary_muscles / 分类兜底）而不是只用 primarySlugOf，
// 因为「卧推」除了胸还练三头与前三角——疲劳必须按实际受累肌群累加，否则三头永远不会累。
function slugsOfLog(log) {
  const m = new Map();
  // ⚠️ 必须 Array.isArray：`(log.actions || [])` 挡不住 actions 是字符串/对象这类脏数据，
  //   而本函数是历史数据的第一道入口——脏数据在这里就该被安静地忽略，而不是抛异常把页面炸掉。
  const actions = Array.isArray(log && log.actions) ? log.actions : [];
  actions.forEach(a => {
    if (!a || typeof a !== 'object') return;
    const intensity = intensityOf(a);
    if (intensity <= 0) return;
    const primary = primarySlugOf(a);
    collectSlugs(a).forEach(slug => {
      // 主练肌群记满分，协同/兜底肌群记 0.5 折（它们确实参与，但不是这场的重点）。
      const w = (slug === primary) ? intensity : intensity * 0.5;
      m.set(slug, (m.get(slug) || 0) + w);
    });
  });
  return m;
}

// 一场训练的时刻（毫秒）。优先 createdAt（真实保存时刻），退化到日期串的本地 00:00。
// ⚠️ 用本地 parseISO 而非 new Date(str)：后者会把 'YYYY-MM-DD' 按 UTC 解释，
//    在 UTC+8 下等于本地 08:00，跨天边界会整段偏移（同 P0-0 的教训）。
function logTimeMs(log) {
  const created = num(log && log.createdAt);
  if (created > 0) return created;
  const d = dateRange.parseISO(log && log.date);
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  return d.getTime();
}

// 逐肌群状态表：{ [slug]: { fatigue, lastISO, sessions, daysSince, state } }
// fatigue ∈ [0, +∞)（各场贡献之和），页面如需 0..1 展示请自己除以 FATIGUE_CEILING。
// 返回 Map 而非普通对象：与 bodymap 侧一致，且天然避免 __proto__ 之类的键污染。
//
// 日志数组顺序无关（对每个 slug 的求和是顺序无关的）——这是刻意的：
// store 存的是「日期倒序」，任何依赖顺序的实现都会在排序变化时悄悄出错。
function muscleStatusOf(logs, now, opts) {
  const o = opts || {};
  const nowMs = (now instanceof Date) ? now.getTime() : num(now) || Date.now();
  const keepDays = num(o.retentionDays) > 0 ? num(o.retentionDays) : RETENTION_DAYS;
  const cutoff = nowMs - keepDays * MS_PER_DAY;
  const decayBase = Math.LN2 / (HALF_LIFE_DAYS * MS_PER_DAY);   // ln2 / 半衰期（每毫秒）

  const acc = new Map();
  const bump = (slug, add, tMs, iso) => {
    let cur = acc.get(slug);
    if (!cur) { cur = { load: 0, lastMs: 0, lastISO: '', sessions: 0 }; acc.set(slug, cur); }
    cur.load += add;
    cur.sessions += 1;
    if (tMs > cur.lastMs) { cur.lastMs = tMs; cur.lastISO = iso || ''; }
  };

  (Array.isArray(logs) ? logs : []).forEach(log => {
    if (!log || typeof log !== 'object') return;
    const tMs = logTimeMs(log);
    // 未来时刻的脏数据（时钟回拨 / 导入别处记录）：直接跳过。
    // ⚠️ 不是「当成现在」——那会给一个负 dt，指数 = 0.5^负 = >1，凭空造出高于任何真实值的疲劳，
    //   且未来那条一旦进来就再也出不去窗（cutoff 只卡下界），违反「只减不增」的不变量。
    if (tMs == null || tMs > nowMs || tMs < cutoff) return;
    const iso = String((log && log.date) || '');
    const perSlug = slugsOfLog(log);
    perSlug.forEach((load, slug) => {
      if (load <= 0) return;
      const decayed = load * Math.exp(-decayBase * (nowMs - tMs));   // = load * 0.5^(dt/半衰期)
      if (decayed > 0) bump(slug, decayed, tMs, iso);
    });
  });

  const out = new Map();
  acc.forEach((v, slug) => {
    const daysSince = Math.max(0, (nowMs - v.lastMs) / MS_PER_DAY);
    let state;
    if (v.load >= FATIGUED_AT) state = 'fatigued';
    else if (daysSince >= DETRAIN_DAYS && v.sessions > 0) state = 'detrained';
    else state = 'trained';
    out.set(slug, {
      slug,
      fatigue: v.load,
      lastISO: v.lastISO,
      sessions: v.sessions,
      daysSince,
      state,
      cn: SLUG_TO_CN[slug] || slug
    });
  });
  return out;
}

// 三态的 slug 集合（给解剖图上色用；未出现在表里的 slug 不返回值 ⇒ 调用方按默认色渲染）。
// 这是 bodymap.drawBody(slugSet) 需要的形状，但注意它只标「要高亮哪些」，
// 三态之间的区别由调用方查 muscleStatusOf 的 state 决定颜色——本函数不做配色决策（配色真源在 app.wxss / bodymap）。
function slugsByState(statusMap, state) {
  const s = new Set();
  (statusMap || new Map()).forEach((v, slug) => { if (v.state === state) s.add(slug); });
  return s;
}

// 概览：按三态分桶 + 近期最重的几块，给页面头部一句话用。
// ⚠️ 「近期最重」= 疲劳值最高，不是「最该练」——展示文案必须如实说是「负荷最高」。
function overviewOf(statusMap) {
  const map = statusMap || new Map();
  const out = { fatigued: [], trained: [], detrained: [], topLoad: [], total: map.size };
  map.forEach((v, slug) => { if (out[v.state]) out[v.state].push(slug); });
  out.fatigued.sort(); out.trained.sort(); out.detrained.sort();
  out.topLoad = Array.from(map.values())
    .sort((a, b) => (b.fatigue - a.fatigue) || a.slug.localeCompare(b.slug))
    .slice(0, 3);
  return out;
}

module.exports = {
  MS_PER_DAY, HALF_LIFE_DAYS, RETENTION_DAYS,
  FATIGUED_AT, DETRAINED_AT, DETRAIN_DAYS,
  intensityOf, slugsOfLog, logTimeMs, muscleStatusOf, slugsByState, overviewOf
};