// utils/shareCard.js
// 训练分享卡（图片）—— 把「本次训练」变成一张可直接发到微信的卡片。
//
// 为什么独立成模块：卡片 = 内容模型 + 版式 + 绘制，其中前两件是**纯逻辑**，能在 node 里直接跑。
// 守卫 scripts/verify-share-card.cjs 正是靠这一点断言：版式不越界、配色达 AA、超长文案被截断、
// 亮绿底上的字必为深字、解剖图恰好落在给定的子矩形内。draw() 只负责把版式 ops 翻译成 canvas 调用。
//
// 口径：
//   · 所有指标都取自 utils/trainingStats.js —— 卡片**不许**自己再算一遍训练量/时长/结论/chip/kcal，
//     否则「同一场训练，卡片和复盘页数字不一样」是迟早的事；
//   · 主视觉 = 解剖图，走 utils/bodymap.js 的**纯路径**（bodyPaths + drawShapes），
//     卡内因此**不含任何图片资源** ⇒ 版式/对比度/越界都能在 node 里穷举断言，不必靠真机截图；
//   · canvas 读不到 CSS 变量，故配色在此硬编码一份 app.wxss 根 token 的镜像。
//     改 token 要同步改这里 —— 守卫 [A] 组会**遍历每一套调色板**逐个色对验对比度；
//   · 卡片**不跟随 App 深浅主题**，只跟随用户显式选的「样式」（浅色 / 深色）：
//     跟随本机主题会让同一场训练在不同手机上产出两张不同的图，而图片是要发出去的。
const stats = require('./trainingStats.js');
const dateRange = require('./dateRange.js');
const bodymap = require('./bodymap.js');

/* ================= 尺寸 ================= */

// 卡片宽度 = 750，即设计稿 rpx 口径（750rpx = 375px）。字号可直接沿用设计系统的 rpx 数值。
// 输出图片恒为 750px 宽（backing store 固定，不乘 dpr）→ 跨设备出图完全一致。
const CARD_W = 750;
const PAGE_PAD = 24;                       // 画布四边留白（卡片浮在底色上）
const CARD_PAD = 32;                       // 卡片内边距
const CARD_R = 32;
const CARD_X = PAGE_PAD;
const CARD_W_IN = CARD_W - PAGE_PAD * 2;   // 702
const INNER_X = PAGE_PAD + CARD_PAD;       // 56 —— 卡片内容左边界
const INNER_W = CARD_W - INNER_X * 2;      // 638 —— 卡片内容宽度
const GAP_CARD = 20;                       // 卡片之间

const AV_R = 40;                           // 头像圈半径（文字头像，纯矢量）
const ID_H = AV_R * 2;                     // 身份行高 80
const PB_H = 56;                           // 个人纪录条（结论条高度由折行数决定，见 layout）

// —— 解剖图区（横向五栏：前标签 | 前视图 | 后视图 | 后标签 | 指标）——
// 62 + 12 + 175 + 12 + 175 + 12 + 62 + 12 + 116 = 638 = INNER_W（刚好铺满，无浮点误差）
const LAB_W = 62;
const FIG_W = 175;
const FIG_H = 350;                         // 724:1448 = 175:350 —— 与图集 viewBox 同比，不拉伸
const KPI_W = 116;
const AGAP = 12;
const LAB_TO_FIG = 6;                      // 引线起点相对标签文字的留白
const MAX_LABELS = 6;                      // 单侧最多标几个肌群（超出的并进「等 N 处」）

// —— 动作卡 ——
const MAX_ROWS = 4;                        // 动作行上限
const ROW_H = 112;
const CAP_H = 40;                          // 逐组胶囊高度
const CAP_GAP = 10;
const MAX_CAPS = 3;                        // 单行最多几个胶囊（canvas 不会自动折行，多出的并成「+N 组」）
const SEC_H = 48;                          // 动作卡小标题行高

const BRAND = '衡砺健身记录';               // 与 app.json navigationBarTitleText 一致
const SLOGAN = '记录每一次进步';

/* ================= T2：小程序码（固定码，方案 A） =================
   位置口径（1.1 设计文档 + 样本设计稿拍板 2026-10-21）：
   页脚改为「左品牌两行 + 右白底圆角码托」——码恒在卡片右下角、不与任何文字
   内容区抢宽，深浅两主题下托底都是纯白底保证可扫。只叠图，不动数据（禁重算口径不变）。
   ⚠️ 资源需人工放置：从微信后台下载的小程序码图 → static/minicode.png。
      缺失时 loadMinicode() 返回 null，卡片照常出（页脚码槽留白）——
      「卡能出」永远优先于「卡上有码」，绝不让缺图毁掉整个分享。 */
const MINICODE_PATH = '/static/minicode.png';
const QR_SIZE = 112;                        // 码本体
const QR_BOX = 132;                         // 白底托底（码四周静区 ≥10px）
const QR_GAP = 24;                          // 托底与品牌文字的最小间距

/* ================= 调色板 =================
   每套调色板里的每一个「字色 × 底色」组合都由守卫 [A] 逐个验对比度；
   加新色对一定要同时加进守卫，否则就是给自己留了一个隐形文字的口子。 */
const PALETTES = {
  light: {
    key: 'light', name: '浅色',
    bg: '#F7F7F5',        // --n-50 页面暖白底
    card: '#FFFFFF',      // --card
    border: '#E8E8E4',    // --n-200 边框线
    ink: '#0A0A0A',       // --n-950 主文字
    sub: '#444444',       // --n-700 次级文字（不用 --n-500 #A0A0A0：压暖白底仅 2.44:1，见报告 P2-9）
    brand: '#C8FF00',     // --primary（全库唯一不随主题翻转的色）
    brandInk: '#0A0A0A',  // 亮绿底上的字（对比度铁律，16.74:1）
    accBg: '#F1F5E6',     // 结论条底（浅绿调）
    chipBg: '#F1F1EE',    // --n-100 胶囊底
    chipInk: '#0A0A0A',
    upFg: '#4C7300',      // --success-text / --primary-text
    upBg: '#F1F5E6',
    downFg: '#C4363B',    // --danger-text
    downBg: '#FBEDEB',
    flatFg: '#444444',    // --n-700
    flatBg: '#F1F1EE',    // --n-100
    anat: { outlineFill: '#F1F3F5', outlineStroke: '#C9CFD6', base: '#E2E6EA', baseStroke: '#D2D8DF', on: '#C8FF00', onStroke: '#7CB800', lw: 6 }
  },
  dark: {
    key: 'dark', name: '深色',
    bg: '#0A0A0A',
    card: '#16181A',
    border: '#2A2E33',
    ink: '#FFFFFF',
    sub: '#B4B8BD',
    brand: '#C8FF00',     // 亮绿在深底上依旧只配深字
    brandInk: '#0A0A0A',
    accBg: '#23272B',
    chipBg: '#23272B',
    chipInk: '#FFFFFF',
    upFg: '#C8FF00',
    upBg: '#232A1C',
    downFg: '#FF6B70',
    downBg: '#2E1F20',
    flatFg: '#B4B8BD',
    flatBg: '#23272B',
    anat: { outlineFill: '#202428', outlineStroke: '#3A4046', base: '#2A2F34', baseStroke: '#3E454C', on: '#C8FF00', onStroke: '#7CB800', lw: 6 }
  }
};
const PALETTE = PALETTES.light;
const STYLE_KEYS = ['light', 'dark'];
function paletteOf(m) { return PALETTES[(m && m.style) || 'light'] || PALETTE; }

// 字号（rpx 口径，与 app.wxss 的 --fs-* 同级）
const FS = {
  avatar: 40,
  nickname: 32, verdict: 24,
  streakVal: 34, streakUnit: 20, streakLab: 18,
  kpiVal: 36, kpiUnit: 20, kpiLab: 18,
  anatLab: 19,
  secTit: 26, secMeta: 20,
  actName: 28, capTxt: 20, actMeta: 22,
  pbBadge: 20, pbText: 22,
  foot: 24, footSub: 20
};

// 肌群标签用的短名：标签栏只有 62px，长名（股四头肌/小腿肌群）放不下。
// 这些是健身圈通用的简称，不是自造词。
const LABEL_CN = {
  chest: '胸', deltoids: '三角肌', biceps: '二头', triceps: '三头',
  abs: '腹', obliques: '侧腹', forearm: '前臂', trapezius: '斜方',
  neck: '颈', gluteal: '臀', quadriceps: '股四', adductors: '内收',
  hamstring: '腘绳', calves: '小腿', tibialis: '胫前',
  'lower-back': '下背', 'upper-back': '上背'
};

/* ================= 文本度量（纯函数） ================= */

// 宽度估算：不引 ctx.measureText，版式才是纯函数、才能在 node 里断言。
// 中文/全角按 1em，ASCII 按 0.62em —— 刻意**偏大**：宁可早一点截断，也不要压出卡片边界。
const WIDE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

function estWidth(s, size) {
  let w = 0;
  Array.from(String(s == null ? '' : s)).forEach(ch => { w += WIDE.test(ch) ? size : size * 0.62; });
  return w;
}

// 截断到能放下为止（末位补省略号）
function fit(s, size, maxW) {
  const t = String(s == null ? '' : s);
  if (estWidth(t, size) <= maxW) return t;
  // 必须是「一超就停」的循环：用 forEach 只跳过当前字符的话，
  // 后面更窄的字符会被补上来，拼出「首尾相接但中间少字」的假文案。
  let out = '';
  const chars = Array.from(t);
  for (let i = 0; i < chars.length; i++) {
    if (out && estWidth(out + chars[i] + '…', size) > maxW) break;
    out += chars[i];
  }
  return out.replace(/\s+$/, '') + '…';
}

// 缩小字号直到放得下（数字**不能截断**：把 12800 显示成 12… 比换行更糟）
function fitSize(s, size, maxW, min) {
  const w = estWidth(s, size);
  if (w <= maxW || w <= 0) return size;
  return Math.max(min || 12, Math.floor(size * maxW / w));
}

// 折行到最多 maxLines 行，放不下的用省略号收在末行
function wrap(s, size, maxW, maxLines) {
  const chars = Array.from(String(s == null ? '' : s).trim());
  if (!chars.length) return [];
  const lines = [];
  let cur = '';
  chars.forEach(ch => {
    if (cur && estWidth(cur + ch, size) > maxW) { lines.push(cur); cur = ch; }
    else cur += ch;
  });
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fit(kept[maxLines - 1] + lines.slice(maxLines).join(''), size, maxW);
  return kept;
}

/* ================= 动作库查表（拿 target 才能点亮肌群） ================= */

// 训练日志里落库的动作**没有 target / secondary_muscles** 字段（见 store.saveTrainingLog），
// 只有一个 id。要画肌群高亮必须按 id 回查内置动作库。
// 懒建 + 缓存：动作库是 550KB 的压缩表，只有真的出卡时才付这一次解析成本。
let _exIndex = null;
function exIndex() {
  if (_exIndex) return _exIndex;
  _exIndex = {};
  try {
    const lib = require('./exercises.js').library || {};
    Object.keys(lib).forEach(cat => (lib[cat] || []).forEach(e => { if (e && e.id) _exIndex[String(e.id)] = e; }));
  } catch (e) { _exIndex = {}; }
  return _exIndex;
}

// 日志动作 → 肌群 slug 集合：优先动作库 target，日志自带 target 次之，最后用分类兜底。
// （collectSlugs 内部已按 category 兜底，这里只负责把 target 补上。）
function targetOfAction(a) {
  const ex = exIndex()[String(a && a.id)];
  return (a && a.target) || (ex && ex.target) || '';
}

function slugsOfAction(a) {
  const ex = exIndex()[String(a && a.id)];
  const target = targetOfAction(a);
  const category = (a && a.category) || (ex && ex.category) || '';
  return bodymap.collectSlugs({ target: target, category: category });
}

/* ================= 解剖图（纯数据，带缓存） ================= */

const _shapeCache = {};
function anatomyShapes(side, slugs, pal) {
  const key = side + '|' + pal.key + '|' + slugs.join(',');
  if (!_shapeCache[key]) _shapeCache[key] = bodymap.bodyPaths(side, new Set(slugs), pal.anat);
  return _shapeCache[key];
}

/* ================= 内容模型 ================= */

// 从「已落库的一场（或同一天的多场）训练」构建卡片内容。
//   opts.log / opts.logsDesc / opts.idx  —— 与旧版一致
//   opts.opts = {
//     style:  'light' | 'dark'     卡片样式（用户显式选，不跟随 App 主题）
//     merge:  bool                 合并当天：把同一日期的所有场次合成一张卡
//     hideContent: bool            隐藏训练内容：不出动作明细卡（只留身份/解剖/指标）
//     nickname: string             昵称（头像圈取首字）
//   }
// 返回值全部是标量/字符串 —— 可以直接渲染，也可以直接断言。
function buildModel(opts) {
  const o = opts || {};
  const log = o.log;
  if (!log) return null;
  const opt = o.opts || {};
  const logsDesc = o.logsDesc || [];
  const anchorIdx = Math.max(0, Number(o.idx) || 0);

  // 合并当天：同一 date 的所有场次（logsDesc 是倒序，取出来仍是倒序，最新一场在前）
  const srcs = [];
  if (opt.merge) {
    logsDesc.forEach((l, i) => {
      if (l && l.date === log.date) srcs.push({ log: l, idx: i });
    });
  }
  if (!srcs.length) srcs.push({ log: log, idx: anchorIdx });

  // —— 汇总指标（全部走 trainingStats 单源，卡片自己不重算口径）——
  let totalSets = 0, totalReps = 0, vol = 0, sec = 0, trainSec = 0;
  srcs.forEach(s => {
    (s.log.actions || []).forEach(a => stats.setsOf(a).forEach(x => {
      totalSets++;
      totalReps += stats.num(x.reps);
    }));
    vol += stats.loadOfLog(s.log);
    sec += stats.durationSecOfLog(s.log);
    trainSec += stats.trainSecOfLog(s.log);
  });

  // 训练量：纯自重场次（负重恒 0）时退化为总次数。
  // 直接显示「总重量 0 kg」既难看也不传达任何信息，还会让人以为数据丢了。
  const volumeMetric = vol > 0
    ? { lab: '总重量(kg)', val: stats.fmtVol(vol), unit: '' }
    : { lab: '总次数', val: String(totalReps), unit: '次' };

  const kpis = [
    // 消耗是**粗估**（EST_KCAL_PER_MIN × 纯训练秒），标签里必须写明「估算」，
    // 否则「1 大卡」这种数字会被当成实测值 —— 文案只写实现得了的事。
    { lab: '消耗(估算)', val: String(stats.estKcal(trainSec)), unit: '千卡' },
    volumeMetric,
    { lab: '总耗时', val: Math.floor(sec / 60) + ':' + dateRange.pad2(sec % 60), unit: '' }
  ];

  // 破纪录 + 逐动作行：每行携带它所属场次的下标，这样「合并当天」时
  // 「比上次 ↑x%」仍是拿该动作自己那场去比，不会被合并后的总数带偏。
  const pbSeen = {};
  const rows = [];
  srcs.forEach(s => {
    const pbs = stats.sessionRecords(s.log, logsDesc, anchorIdxOf(s));
    const pbByKey = {};
    pbs.forEach(p => { pbByKey[p.key] = p; if (!pbSeen[p.key]) pbSeen[p.key] = p; });
    (s.log.actions || []).forEach(a => {
      const key = stats.actionKey(a);
      const best = stats.bestSetOf(a);
      const ss = stats.setsOf(a);
      const caps = ss.map(x => {
        const w = stats.num(x.weight), r = stats.num(x.reps);
        return {
          txt: w > 0 ? stats.fmtW(w) + 'kg × ' + r : (r ? '自重 × ' + r : '—'),
          best: best.topW === w && best.reps === r && r > 0
        };
      });
      if (!caps.length) caps.push({ txt: '—', best: false });
      rows.push({
        key: key + '@' + s.idx,
        name: (a.nameZh || a.name) || '动作',
        caps: caps.slice(0, MAX_CAPS),
        more: Math.max(0, caps.length - MAX_CAPS),
        counts: caps.length,
        chip: stats.sessionChip(a, logsDesc, anchorIdxOf(s)),   // 与复盘页同一份 chip，不另算
        isPb: !!pbByKey[key]
      });
    });
  });
  const pbs = Object.keys(pbSeen).map(k => pbSeen[k]);

  // 连续训练天数：口径取「截至这场训练那天」而非「截至今天」。
  // 取今天的话，分享一张两周前的卡会显示「0 天」，把已经形成的连续记录说成没有。
  const streakDays = dateRange.streakFromDates(
    new Set(logsDesc.filter(l => l && l.date).map(l => l.date)), log.date);

  // 结论：合并多场时「只比共同动作」的场间结论已不适用 —— 换一句话说清楚
  let verdict;
  if (srcs.length > 1) {
    verdict = '这天共 ' + srcs.length + ' 场训练 · ' + rows.length + ' 个动作';
  } else {
    verdict = String(stats.buildVerdict({ log: log, logsDesc: logsDesc, idx: anchorIdx, rpe: stats.avgRpeOfActions(log.actions || []) }).text || '');
  }

  const nick = String(opt.nickname == null ? '' : opt.nickname).trim();
  const nickChars = Array.from(nick);

  const visibleRows = opt.hideContent ? [] : rows;
  const shown = visibleRows.slice(0, MAX_ROWS);

  return {
    style: STYLE_KEYS.indexOf(opt.style) >= 0 ? opt.style : 'light',
    dateText: dateRange.fmtDateSlash(log.date),
    nickname: nick || '健身用户',
    avatarText: nickChars.length ? nickChars[0] : 'F',
    streakDays: streakDays,
    verdict: verdict,
    kpis: kpis,
    actionCount: rows.length,
    totalSets: totalSets,
    rows: shown,
    hiddenRows: Math.max(0, visibleRows.length - shown.length),
    showActions: !opt.hideContent,
    merged: srcs.length > 1,
    pbs: pbs,
    anatomy: slugSetOf(srcs),
    empty: rows.length === 0
  };
}

// 逐动作场次下标：合并当天时 s.idx 是「在 logsDesc 里的真实下标」，直接用即可。
function anchorIdxOf(s) { return s.idx; }

// 前/后视图各自的肌群 slug 集合 + 「主练肌群」集合（标签据此分主次）。
// 刻意返回**排序后的数组**而不是 Set：模型要能被 JSON.stringify（守卫据此断言模型内容），
// 而 Set 在 JSON 里会变成 {}；`Object.keys(set)` 恒为 [] 这类错也一并被这个约定挡在门外。
function slugSetOf(srcs) {
  const all = new Set();
  const prim = new Set();
  srcs.forEach(s => (s.log.actions || []).forEach(a => {
    slugsOfAction(a).forEach(slug => all.add(slug));
    const p = bodymap.primarySlugOf({ target: targetOfAction(a) });
    if (p) prim.add(p);
  }));
  const front = [], back = [], primary = [];
  Array.from(all).sort().forEach(slug => {
    const inF = bodymap.FRONT_SLUGS.has(slug), inB = bodymap.BACK_SLUGS.has(slug);
    if (inF) front.push(slug);
    if (inB) back.push(slug);
    if (!inF && !inB) front.push(slug);   // 兜底：图集里没有的 slug 也画在前视图，不静默丢掉
  });
  Array.from(prim).sort().forEach(slug => primary.push(slug));
  return { front: front, back: back, primary: primary };
}

/* ================= 版式（纯函数 → ops 列表） ================= */

function chipStyle(cls, pal) {
  if (cls === 'up') return { fg: pal.upFg, bg: pal.upBg };
  if (cls === 'down') return { fg: pal.downFg, bg: pal.downBg };
  return { fg: pal.flatFg, bg: pal.flatBg };
}

// 解剖图区：五栏横向铺满，返回各栏的 x 坐标（与 draw() 共用同一份算术）
function anatCols() {
  const frontLabX = INNER_X + LAB_W;                                   // 118：前视图标签的右对齐基线
  const frontFigX = INNER_X + LAB_W + AGAP;                            // 130
  const backFigX = frontFigX + FIG_W + AGAP;                           // 317
  const backLabX = backFigX + FIG_W + AGAP;                            // 504：后视图标签的左对齐基线
  const kpiX = INNER_X + INNER_W - KPI_W;                              // 578
  return { frontLabX: frontLabX, frontFigX: frontFigX, backFigX: backFigX, backLabX: backLabX, kpiX: kpiX };
}

// 单侧肌群标签：按锚点 y 排序 → 在标签栏里**等距分槽**（槽位由数量决定，
// 因此任意组合都不会重叠），再从槽位拉一条引线指向该肌群的包围盒中心。
// 主练肌群用正文色加重（一眼看出这场练的重点），其余用次级色。超出的不静默丢弃 —— 折成一句「等 N 处」。
// `side` 只用于给引线打标：守卫据此断言「后视引线落在后视图那一栏里」——
// 也就是「xOffset 必须补回来」这条规则是可被机器检查的，而不是靠读代码。
function pushLabels(ops, pal, shapes, primSet, figX, x, align, top, height, scale, labelBg, side) {
  const bounds = bodymap.slugBounds(shapes);
  const items = [];
  Object.keys(bounds).forEach(slug => {
    if (!bounds[slug].active) return;
    items.push({ slug: slug, cy: bounds[slug].cy, cx: bounds[slug].cx });
  });
  items.sort((a, b) => a.cy - b.cy);
  const shown = items.slice(0, MAX_LABELS);
  const extra = items.length - shown.length;
  const n = shown.length + (extra > 0 ? 1 : 0);
  if (!n) return;

  const slotH = height / n;
  const edge = x;                                    // 文字贴边的那条线（右对齐=右端，左对齐=左端）
  const lineX = align === 'right' ? edge + LAB_TO_FIG : edge - LAB_TO_FIG;

  shown.forEach((it, i) => {
    const cy = top + slotH * (i + 0.5);
    const isPrim = !!primSet[it.slug];
    ops.push({
      t: 'text', s: fit(LABEL_CN[it.slug] || it.slug, FS.anatLab, LAB_W), x: edge, y: cy,
      size: FS.anatLab, weight: isPrim ? 800 : 600, color: isPrim ? pal.ink : pal.sub,
      align: align, baseline: 'middle', bg: labelBg
    });
    // 引线：从标签内侧拉到该肌群包围盒中心。
    // back 视图的路径 x 整体 +724（shapes.xOffset = -724），必须补回来，
    // 否则后视图的引线会整体飞出画布右侧 —— 这正是「同源坐标」要挡住的那类错。
    const bx = figX + (it.cx + shapes.xOffset) * scale;
    const by = top + it.cy * scale;
    ops.push({ t: 'line', kind: 'leader', side: side, x1: lineX, y1: cy, x2: bx, y2: by, color: pal.border, lw: 1 });
  });

  if (extra > 0) {
    const cy = top + slotH * (shown.length + 0.5);
    ops.push({
      t: 'text', s: '等 ' + extra + ' 处', x: edge, y: cy,
      size: FS.anatLab, weight: 600, color: pal.sub, align: align, baseline: 'middle', bg: labelBg
    });
  }
}

// 把模型摊成绘制指令。每个 text op 都带 bg（它压在什么底色上）——
// 守卫据此断言「亮绿底上必须是深字」「正文不许浮在不确定的底色上」，而不是靠肉眼看代码。
function layout(m) {
  // 空模型（没选到任何场次）返回空版式而不是抛错：调用方已经会拦，但脚本/守卫里
  // 一次空手滑就让整条流水线崩掉，不如在这里收口成「0 高的空卡」。
  if (!m) return { w: CARD_W, h: 0, ops: [], palette: PALETTE.key };
  const ops = [];
  const pal = paletteOf(m);
  const W = CARD_W;
  let y = PAGE_PAD;

  /* ---------- 卡片 A：身份行 + 结论条 + 解剖图 + 右列指标 ---------- */
  // 结论是这张卡片的「一句话标题」，被截断就等于没说 —— 允许折到第 2 行，行数决定条高。
  const vLines = m.verdict ? wrap(m.verdict, FS.verdict, INNER_W - 24 - 16, 2) : [];
  const verdictH = vLines.length ? (24 + vLines.length * 32) : 0;
  const aH = CARD_PAD + ID_H + (verdictH ? 20 + verdictH : 0) + 24 + FIG_H + CARD_PAD;
  ops.push({ t: 'rect', x: CARD_X, y: y, w: CARD_W_IN, h: aH, r: CARD_R, fill: pal.card, stroke: pal.border, lw: 1 });

  // 身份行
  const idY = y + CARD_PAD;
  const avCx = INNER_X + AV_R;
  const avCy = idY + AV_R;
  ops.push({ t: 'circle', cx: avCx, cy: avCy, r: AV_R, fill: pal.brand });
  // 文字头像（昵称首字）是**刻意的**：微信头像要异步下载，一旦这里依赖网络图片，
  // 「版式是纯函数」这个前提就没了，对比度与越界也就无法在 node 里穷尽断言。
  ops.push({ t: 'text', s: m.avatarText, x: avCx, y: avCy, size: FS.avatar, weight: 800, color: pal.brandInk, align: 'center', baseline: 'middle', bg: pal.brand });

  const cols = anatCols();
  ops.push({
    t: 'text', s: fit(m.nickname, FS.nickname, cols.kpiX - 24 - (avCx + AV_R + 20)),
    x: avCx + AV_R + 20, y: avCy, size: FS.nickname, weight: 800, color: pal.ink,
    align: 'left', baseline: 'middle', bg: pal.card
  });

  // 连续天数（与右列指标左对齐，形成一条竖线）
  const stVal = String(m.streakDays);
  const stValW = estWidth(stVal, FS.streakVal);
  ops.push({ t: 'text', s: stVal, x: cols.kpiX, y: avCy - 4, size: FS.streakVal, weight: 800, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card });
  ops.push({ t: 'text', s: '天', x: cols.kpiX + stValW + 4, y: avCy + 2, size: FS.streakUnit, weight: 700, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card });
  ops.push({ t: 'text', s: '连续训练', x: cols.kpiX, y: avCy + 26, size: FS.streakLab, weight: 600, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card });

  // 一句话结论条（浅绿底 → 深字；左侧亮绿竖条是装饰，不承载文字）
  if (vLines.length) {
    const vy = idY + ID_H + 20;
    ops.push({ t: 'rect', x: INNER_X, y: vy, w: INNER_W, h: verdictH, r: 16, fill: pal.accBg });
    ops.push({ t: 'rect', x: INNER_X, y: vy + (verdictH - 32) / 2, w: 6, h: 32, r: 3, fill: pal.brand });
    vLines.forEach((ln, i) => ops.push({
      t: 'text', s: ln, x: INNER_X + 24, y: vy + 28 + i * 32, size: FS.verdict, weight: 700,
      color: pal.ink, align: 'left', baseline: 'middle', bg: pal.accBg
    }));
    y = vy + verdictH + 24;
  } else {
    y = idY + ID_H + 24;
  }

  // 解剖图：前视图（标签在左）+ 后视图（标签在右）
  const anatY = y;
  const scale = FIG_W / bodymap.VBW;
  const front = anatomyShapes('front', m.anatomy.front, pal);
  const back = anatomyShapes('back', m.anatomy.back, pal);
  const primSet = {};
  m.anatomy.primary.forEach(s => { primSet[s] = 1; });
  ops.push({ t: 'body', side: 'front', x: cols.frontFigX, y: anatY, w: FIG_W, h: FIG_H, scale: scale, active: front.activeCount, slugs: m.anatomy.front });
  ops.push({ t: 'body', side: 'back', x: cols.backFigX, y: anatY, w: FIG_W, h: FIG_H, scale: scale, active: back.activeCount, slugs: m.anatomy.back });
  pushLabels(ops, pal, front, primSet, cols.frontFigX, cols.frontLabX, 'right', anatY, FIG_H, scale, pal.card, 'front');
  pushLabels(ops, pal, back, primSet, cols.backFigX, cols.backLabX, 'left', anatY, FIG_H, scale, pal.card, 'back');

  // 右列三指标（值在上、标签在下，纵向等分解剖图高度 —— 与左上的连续天数同列对齐）
  const slotH = FIG_H / m.kpis.length;
  m.kpis.forEach((mt, i) => {
    const cy = anatY + slotH * (i + 0.5);
    const unitW = mt.unit ? estWidth(mt.unit, FS.kpiUnit) + 6 : 0;
    const vSize = fitSize(mt.val, FS.kpiVal, KPI_W - unitW, 22);
    ops.push({ t: 'text', s: mt.val, x: cols.kpiX, y: cy, size: vSize, weight: 800, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card });
    if (mt.unit) ops.push({ t: 'text', s: mt.unit, x: cols.kpiX + estWidth(mt.val, vSize) + 6, y: cy + 6, size: FS.kpiUnit, weight: 700, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card });
    ops.push({ t: 'text', s: fit(mt.lab, FS.kpiLab, KPI_W), x: cols.kpiX, y: cy + 26, size: FS.kpiLab, weight: 600, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card });
  });

  y += FIG_H + CARD_PAD;

  /* ---------- 卡片 B：逐动作表现 ---------- */
  if (m.showActions) {
    y += GAP_CARD;
    const bodyH = m.empty ? 88 : (m.rows.length * ROW_H + (m.hiddenRows ? 44 : 0));
    const bH = CARD_PAD + SEC_H + bodyH + CARD_PAD;
    ops.push({ t: 'rect', x: CARD_X, y: y, w: CARD_W_IN, h: bH, r: CARD_R, fill: pal.card, stroke: pal.border, lw: 1 });

    ops.push({ t: 'text', s: '本场动作', x: INNER_X, y: y + CARD_PAD + SEC_H / 2, size: FS.secTit, weight: 800, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card });
    ops.push({
      t: 'text', s: fit(m.actionCount + ' 个动作 · ' + m.totalSets + ' 组', FS.secMeta, INNER_W * 0.5),
      x: INNER_X + INNER_W, y: y + CARD_PAD + SEC_H / 2, size: FS.secMeta, weight: 600, color: pal.sub,
      align: 'right', baseline: 'middle', bg: pal.card
    });

    const bodyY = y + CARD_PAD + SEC_H;
    if (m.empty) {
      // 没记录动作的场次（例如只记了时长）也要能出卡，给一句实话而不是一张空壳
      ops.push({ t: 'rect', x: INNER_X, y: bodyY + 4, w: INNER_W, h: 80, r: 20, fill: pal.chipBg });
      ops.push({ t: 'text', s: '这场训练没有记录动作明细', x: INNER_X + 28, y: bodyY + 44, size: FS.actName, weight: 600, color: pal.chipInk, align: 'left', baseline: 'middle', bg: pal.chipBg });
    } else {
      m.rows.forEach((r, i) => {
        const ry = bodyY + i * ROW_H;
        const cs = chipStyle(r.chip.cls, pal);
        const chipW = estWidth(r.chip.text, FS.actMeta) + 28;
        ops.push({
          t: 'text', s: fit(r.name, FS.actName, INNER_W - chipW - 16),
          x: INNER_X, y: ry + 24, size: FS.actName, weight: 700, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card
        });
        ops.push({ t: 'rect', x: INNER_X + INNER_W - chipW, y: ry + 4, w: chipW, h: 40, r: 20, fill: cs.bg });
        ops.push({
          t: 'text', s: r.chip.text, x: INNER_X + INNER_W - chipW / 2, y: ry + 24,
          size: FS.actMeta, weight: 700, color: cs.fg, align: 'center', baseline: 'middle', bg: cs.bg
        });

        // 逐组胶囊：最好的一组用亮绿实底（→ 深字），其余用中性胶囊底
        let cx = INNER_X;
        r.caps.forEach(c => {
          const cw = estWidth(c.txt, FS.capTxt) + 32;
          const cbg = c.best ? pal.brand : pal.chipBg;
          const cfg = c.best ? pal.brandInk : pal.chipInk;
          ops.push({ t: 'rect', x: cx, y: ry + 56, w: cw, h: CAP_H, r: CAP_H / 2, fill: cbg });
          ops.push({ t: 'text', s: c.txt, x: cx + cw / 2, y: ry + 56 + CAP_H / 2, size: FS.capTxt, weight: 700, color: cfg, align: 'center', baseline: 'middle', bg: cbg });
          cx += cw + CAP_GAP;
        });
        if (r.more > 0) {
          const t = '+' + r.more + ' 组';
          const cw = estWidth(t, FS.capTxt) + 32;
          ops.push({ t: 'rect', x: cx, y: ry + 56, w: cw, h: CAP_H, r: CAP_H / 2, fill: pal.chipBg, stroke: pal.border, lw: 1 });
          ops.push({ t: 'text', s: t, x: cx + cw / 2, y: ry + 56 + CAP_H / 2, size: FS.capTxt, weight: 700, color: pal.chipInk, align: 'center', baseline: 'middle', bg: pal.chipBg });
        }

        if (i < m.rows.length - 1) {
          ops.push({ t: 'line', kind: 'rule', x1: INNER_X, y1: ry + ROW_H, x2: INNER_X + INNER_W, y2: ry + ROW_H, color: pal.border, lw: 1 });
        }
      });
      if (m.hiddenRows) {
        ops.push({
          t: 'text', s: '另有 ' + m.hiddenRows + ' 个动作未列出', x: INNER_X, y: bodyY + m.rows.length * ROW_H + 22,
          size: FS.secMeta, weight: 600, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card
        });
      }
    }
    y += bH;
  }

  /* ---------- 个人纪录条（只在本场真的破了纪录时出现，不做「无数据也占位」）---------- */
  if (m.pbs.length) {
    y += GAP_CARD;
    const badgeW = 44;
    const txtX = INNER_X + 24 + badgeW + 14;
    const detail = m.pbs.map(x => x.name + ' ' + x.valTxt).join(' · ');
    // 圆角取 min(CARD_R, PB_H/2)：这条只有 56 高，写满 CARD_R=32 会被 roundRect 静默夹到 28。
    // 声明值要与渲染结果一致 —— 否则「圆角超过半高」这类结构检查就永远说不清了。
    ops.push({ t: 'rect', x: CARD_X, y: y, w: CARD_W_IN, h: PB_H, r: Math.min(CARD_R, PB_H / 2), fill: pal.brand });
    ops.push({ t: 'rect', x: INNER_X, y: y + 12, w: badgeW, h: 32, r: 16, fill: pal.brandInk });
    ops.push({ t: 'text', s: '新', x: INNER_X + badgeW / 2, y: y + 28, size: FS.pbBadge, weight: 800, color: pal.brand, align: 'center', baseline: 'middle', bg: pal.brandInk });
    ops.push({
      t: 'text', s: fit('本场刷新 ' + m.pbs.length + ' 项个人纪录 · ' + detail, FS.pbText, INNER_W - (txtX - INNER_X) - 24),
      x: txtX, y: y + 28, size: FS.pbText, weight: 700, color: pal.brandInk, align: 'left', baseline: 'middle', bg: pal.brand
    });
    y += PB_H;
  }

  /* ---------- 页脚（T2：左品牌两行 + 右小程序码托） ---------- */
  y = pushFooter(ops, pal, y);

  return { w: W, h: y, ops, palette: pal.key };
}

// 页脚（场次卡与周报卡共用）：左品牌两行 + 右白底圆角码托。
// 码托：白底圆角，恒在卡片内容区右下角。无码图时 draw 会跳过这两个 op
//（留白不画空框）——ops 上的 qr 标记就是给 draw 与守卫用的「码槽」指纹。
function pushFooter(ops, pal, y) {
  y += 20;
  const qrX = CARD_X + CARD_W_IN - QR_BOX;
  // 托底边框刻意不走 palette：白托在浅/深两种卡上都要可见且不抢眼，固定一档中性灰
  ops.push({ t: 'rect', qr: true, x: qrX, y: y, w: QR_BOX, h: QR_BOX, r: 20, fill: '#FFFFFF', stroke: '#D9D9D5', lw: 2 });
  ops.push({ t: 'image', qr: true, x: qrX + (QR_BOX - QR_SIZE) / 2, y: y + (QR_BOX - QR_SIZE) / 2, w: QR_SIZE, h: QR_SIZE });
  // 品牌两行：只占码托左侧（QR_GAP 静区），不再右对齐铺满，避免长文案逼近码托
  ops.push({ t: 'text', s: BRAND, x: CARD_X, y: y + 12, size: FS.foot, weight: 800, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.bg });
  ops.push({ t: 'text', s: SLOGAN, x: CARD_X, y: y + 44, size: FS.footSub, weight: 600, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.bg });
  return y + Math.max(QR_BOX, 56) + PAGE_PAD;
}

// 卡片总高（内容自适应：有没有结论条/纪录条、动作行数、是否隐藏训练内容，高度都不一样）
function measure(m) { return layout(m).h; }

/* ================= 周报卡版式（T3，纯函数 → ops 列表） =================
   输入 = utils/weeklyReport.js 的输出 + { style }（样式键与场次卡同一套 PALETTES，
   色对已由守卫 [A] 全量验过 AA；不引入任何新颜色）。数据**不许**在这里重算 ——
   「分享卡禁重算」口径对周报卡同样生效。 */
function layoutWeekly(rw) {
  if (!rw) return { w: CARD_W, h: 0, ops: [], palette: PALETTE.key };
  const ops = [];
  const pal = paletteOf(rw);
  const W = CARD_W;
  let y = PAGE_PAD;

  // ---- 高度预计算（与下方逐段落点严格一致，改一处必改另一处）----
  const cLines = rw.comment ? wrap(rw.comment, FS.verdict, INNER_W - 48, 2) : [];
  // A 卡：pad + 标题行 + 大数字行 + 进度条 + 评语 + 细行 + pad
  const aH = CARD_PAD + SEC_H + 20 + 60 + 14 + 12 + 22 + cLines.length * 32 + 10 + 34 + CARD_PAD;
  // B 卡：pad + 标题 + 行区（上周有记录=2 行 56 + 分隔；无=单行 40）
  const prevEmpty = !(rw.prev && rw.prev.sessions > 0);
  const bH = CARD_PAD + SEC_H + (prevEmpty ? 40 : 56 * 2 + 1) + CARD_PAD;
  // C 卡：PR 最多列 3 项
  const prs = (rw.prs || []).slice(0, 3);
  const prHidden = (rw.prs || []).length - prs.length;
  const hasC = prs.length > 0;
  const cH = hasC ? (CARD_PAD + SEC_H + prs.length * 48 + (prHidden > 0 ? 40 : 0) + CARD_PAD) : 0;

  /* ---------- A 卡：标题 + 达成 + 评语 ---------- */
  ops.push({ t: 'rect', x: CARD_X, y: y, w: CARD_W_IN, h: aH, r: CARD_R, fill: pal.card, stroke: pal.border, lw: 1 });
  const titY = y + CARD_PAD + SEC_H / 2;
  ops.push({ t: 'text', s: '本周周报', x: INNER_X, y: titY, size: FS.secTit, weight: 800, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card });
  ops.push({ t: 'text', s: fit(rw.label || '', FS.secMeta, INNER_W * 0.4), x: INNER_X + INNER_W, y: titY, size: FS.secMeta, weight: 600, color: pal.sub, align: 'right', baseline: 'middle', bg: pal.card });

  const bigMid = y + CARD_PAD + SEC_H + 20 + 30;
  ops.push({ t: 'text', s: String(rw.sessions), x: INNER_X, y: bigMid, size: 56, weight: 800, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card });
  const sValW = estWidth(String(rw.sessions), 56);
  ops.push({ t: 'text', s: '/' + rw.target + ' 次', x: INNER_X + sValW + 8, y: bigMid + 8, size: 24, weight: 700, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card });
  // 达成档 chip：hit=绿（up 色对，守卫已验），其余=中性
  const vTxt = rw.verdict === 'hit' ? '已达标' : (rw.verdict === 'miss' ? '未达标' : '未开始');
  const vCls = rw.verdict === 'hit' ? 'up' : 'flat';
  const vcs = chipStyle(vCls, pal);
  const vW = estWidth(vTxt, FS.actMeta) + 36;
  ops.push({ t: 'rect', x: INNER_X + INNER_W - vW, y: bigMid - 22, w: vW, h: 44, r: 22, fill: vcs.bg });
  ops.push({ t: 'text', s: vTxt, x: INNER_X + INNER_W - vW / 2, y: bigMid, size: FS.actMeta, weight: 700, color: vcs.fg, align: 'center', baseline: 'middle', bg: vcs.bg });

  const trackY = y + CARD_PAD + SEC_H + 20 + 60 + 14;
  ops.push({ t: 'rect', x: INNER_X, y: trackY, w: INNER_W, h: 12, r: 6, fill: pal.chipBg });
  const fillW = Math.max(0, Math.min(INNER_W, Math.round(INNER_W * (rw.pct || 0) / 100)));
  if (fillW > 0) ops.push({ t: 'rect', x: INNER_X, y: trackY, w: fillW, h: 12, r: 6, fill: pal.brand });

  const commentY = trackY + 12 + 22;
  cLines.forEach((ln, i) => ops.push({
    t: 'text', s: ln, x: INNER_X, y: commentY + 16 + i * 32, size: FS.verdict, weight: 600,
    color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card
  }));
  const fineMid = commentY + cLines.length * 32 + 10 + 17;
  ops.push({
    t: 'text', s: '练 ' + rw.days + ' 天 · ' + rw.durTxt + (rw.kcal > 0 ? ' · 约 ' + rw.kcal + ' 千卡（估算）' : ''),
    x: INNER_X, y: fineMid, size: 20, weight: 500, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card
  });
  y += aH;

  /* ---------- B 卡：对比上周 ---------- */
  y += GAP_CARD;
  ops.push({ t: 'rect', x: CARD_X, y: y, w: CARD_W_IN, h: bH, r: CARD_R, fill: pal.card, stroke: pal.border, lw: 1 });
  ops.push({ t: 'text', s: '对比上周', x: INNER_X, y: y + CARD_PAD + SEC_H / 2, size: FS.secTit, weight: 800, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card });
  const bRowsY = y + CARD_PAD + SEC_H;
  if (prevEmpty) {
    ops.push({ t: 'text', s: '上周没有训练记录，无从对比', x: INNER_X, y: bRowsY + 20, size: FS.actMeta, weight: 500, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card });
  } else {
    // 行 1：场次（差值 ±N 直接比，不设阈值）
    const dS = rw.dSessions;
    const dsCls = dS > 0 ? 'up' : (dS < 0 ? 'down' : 'flat');
    const dsTxt = dS === 0 ? '持平' : (dS > 0 ? '↑ 多 ' + dS + ' 场' : '↓ 少 ' + (-dS) + ' 场');
    pushCmpRow(ops, pal, bRowsY, '场次', rw.sessions + ' 场', '上周 ' + rw.prev.sessions + ' 场', dsCls, dsTxt, false);
    // 行 2：容量（±DELTA_SESSION 抑噪后给趋势，与复盘 chip 同一口径）
    const dVpct = rw.dVolPct;
    const dvTxt = rw.volTrend === 'flat' ? '持平'
      : (rw.volTrend === 'up' ? '↑ +' + dVpct + '%' : '↓ ' + (dVpct || 0) + '%');
    pushCmpRow(ops, pal, bRowsY + 57, '容量', rw.volTxt + ' kg', '上周 ' + stats.fmtVol(rw.prev.vol) + ' kg', rw.volTrend || 'flat', dvTxt, true);
  }
  y += bH;

  /* ---------- C 卡：本周 PR（每动作只留最高一次，weeklyReport 已去重）---------- */
  if (hasC) {
    y += GAP_CARD;
    ops.push({ t: 'rect', x: CARD_X, y: y, w: CARD_W_IN, h: cH, r: CARD_R, fill: pal.card, stroke: pal.border, lw: 1 });
    ops.push({ t: 'text', s: '本周亮点', x: INNER_X, y: y + CARD_PAD + SEC_H / 2, size: FS.secTit, weight: 800, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card });
    prs.forEach((p, i) => {
      const ry = y + CARD_PAD + SEC_H + i * 48;
      ops.push({ t: 'rect', x: INNER_X, y: ry + 8, w: 44, h: 32, r: 10, fill: pal.brand });
      ops.push({ t: 'text', s: 'PR', x: INNER_X + 22, y: ry + 24, size: FS.pbBadge, weight: 800, color: pal.brandInk, align: 'center', baseline: 'middle', bg: pal.brand });
      ops.push({ t: 'text', s: fit(p.name, FS.actName, INNER_W - 44 - 16 - 150 - 110), x: INNER_X + 44 + 16, y: ry + 24, size: FS.actName, weight: 700, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card });
      ops.push({ t: 'text', s: p.wTxt + ' kg', x: INNER_X + INNER_W - 110, y: ry + 24, size: FS.actName, weight: 800, color: pal.ink, align: 'right', baseline: 'middle', bg: pal.card });
      ops.push({ t: 'text', s: fit(p.date || '', 20, 90), x: INNER_X + INNER_W, y: ry + 24, size: 20, weight: 500, color: pal.sub, align: 'right', baseline: 'middle', bg: pal.card });
      if (i < prs.length - 1) {
        ops.push({ t: 'line', kind: 'rule', x1: INNER_X, y1: ry + 48, x2: INNER_X + INNER_W, y2: ry + 48, color: pal.border, lw: 1 });
      }
    });
    if (prHidden > 0) {
      ops.push({ t: 'text', s: '另有 ' + prHidden + ' 项纪录未列出', x: INNER_X, y: y + CARD_PAD + SEC_H + prs.length * 48 + 20, size: FS.secMeta, weight: 600, color: pal.sub, align: 'left', baseline: 'middle', bg: pal.card });
    }
    y += cH;
  }

  y = pushFooter(ops, pal, y);
  return { w: W, h: y, ops, palette: pal.key };
}

// 对比行：标签左、数值右（含上周基线小字），趋势 chip 走守卫已验的 up/down/flat 色对
function pushCmpRow(ops, pal, ry, lab, val, baseTxt, cls, chipTxt, withRule) {
  ops.push({ t: 'text', s: lab, x: INNER_X, y: ry + 28, size: FS.actName, weight: 600, color: pal.ink, align: 'left', baseline: 'middle', bg: pal.card });
  ops.push({ t: 'text', s: baseTxt, x: INNER_X + INNER_W - 210 - 16, y: ry + 28, size: FS.secMeta, weight: 500, color: pal.sub, align: 'right', baseline: 'middle', bg: pal.card });
  const cs = chipStyle(cls, pal);
  const cw = estWidth(chipTxt, FS.actMeta) + 28;
  ops.push({ t: 'rect', x: INNER_X + INNER_W - cw, y: ry + 6, w: cw, h: 44, r: 22, fill: cs.bg });
  ops.push({ t: 'text', s: chipTxt, x: INNER_X + INNER_W - cw / 2, y: ry + 28, size: FS.actMeta, weight: 700, color: cs.fg, align: 'center', baseline: 'middle', bg: cs.bg });
  if (withRule) {
    ops.push({ t: 'line', kind: 'rule', x1: INNER_X, y1: ry - 0.5, x2: INNER_X + INNER_W, y2: ry - 0.5, color: pal.border, lw: 1 });
  }
}

/* ================= 绘制 ================= */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r || 0, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  // ⚠️ 左下角 arcTo 只能出现一次。曾在这里把底左角 arcTo 重复了一遍：
  //    当前点已在左上，重复的 arcTo 会先沿左缘折返下行、再画一个 180° 回转的退化弧 ——
  //    fill 时零面积看不出来（全卡片都正常），但描边会把异常段照实画出：
  //    码托（全卡唯一带描边的矩形）左下角便拖出一条竖线（2026-10-30 真机截图实锤）。
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

// 把 ops 画到 canvas 2d 上下文。ctx 形状与 wx canvas 2d 一致：
// 只需 fillRect / clearRect / beginPath / moveTo / lineTo / arcTo / arc / closePath
// / fill / stroke / fillText / save / restore / translate / scale
// 与 fillStyle / strokeStyle / lineWidth / font / textAlign / textBaseline。
// 因此守卫可以用一个「只记录调用的假 ctx」把它跑完，验证真的产出了图元。
function draw(ctx, m, minicodeImg) {
  const L = layout(m);
  const pal = paletteOf(m);
  paintBg(ctx, L, pal);
  renderOps(ctx, L, pal, minicodeImg);
  return L;
}

// 周报卡：版式同样纯函数，绘制复用 renderOps。rw = weeklyReport 输出 + { style, avatarText? }
function drawWeekly(ctx, rw, minicodeImg) {
  const L = layoutWeekly(rw);
  const pal = paletteOf(rw);
  paintBg(ctx, L, pal);
  renderOps(ctx, L, pal, minicodeImg);
  return L;
}

function measureWeekly(rw) { return layoutWeekly(rw).h; }

function paintBg(ctx, L, pal) {
  ctx.clearRect(0, 0, L.w, L.h);
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, L.w, L.h);
}

// ops → canvas 图元（场次卡与周报卡共用；解剖图与其它图元分开画的注释见下）。
function renderOps(ctx, L, pal, minicodeImg) {
  // 解剖图与其它图元分开画：bodyPaths 的路径坐标在「图集 viewBox」里，
  // 必须先 save/translate/scale 定位，画完 restore 回来，否则后面所有图元都会被带偏。
  // 注意**不能**用 bodymap.drawBody：它会先 clearRect 把已经铺好的卡片擦掉。
  const shapeCache = {};
  L.ops.forEach(op => {
    if (op.t === 'body') {
      const skey = op.side + '|' + op.slugs.join(',');
      if (!shapeCache[skey]) shapeCache[skey] = anatomyShapes(op.side, op.slugs, pal);
      const shapes = shapeCache[skey];
      ctx.save();
      ctx.translate(op.x, op.y);
      ctx.scale(op.scale, op.scale);
      if (shapes.xOffset) ctx.translate(shapes.xOffset, 0);
      bodymap.drawShapes(ctx, shapes);
      ctx.restore();
    } else if (op.t === 'rect') {
      // 码槽只在有码图时画：没图还画个白框，就是给用户一个「点了扫不出」的空洞
      if (op.qr && !minicodeImg) return;
      ctx.beginPath();
      roundRect(ctx, op.x, op.y, op.w, op.h, op.r);
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.lw || 1; ctx.stroke(); }
    } else if (op.t === 'image') {
      if (op.qr && !minicodeImg) return;
      ctx.drawImage(minicodeImg, op.x, op.y, op.w, op.h);
    } else if (op.t === 'circle') {
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      ctx.fillStyle = op.fill;
      ctx.fill();
    } else if (op.t === 'line') {
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.lw || 1;
      ctx.stroke();
    } else if (op.t === 'text') {
      ctx.font = (op.weight || 400) + ' ' + op.size + 'px sans-serif';
      ctx.fillStyle = op.color;
      ctx.textAlign = op.align || 'left';
      ctx.textBaseline = op.baseline || 'alphabetic';
      ctx.fillText(op.s, op.x, op.y);
    }
  });
}

// T2 小程序码加载：wx canvas 2d 的图片必须由 canvas.createImage() 造（包内路径可直接 src）。
// 失败一律 resolve(null)——调用方照常出卡，只是页脚码槽留白（见常量区注释）。
function loadMinicode(canvas) {
  return new Promise(resolve => {
    try {
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = MINICODE_PATH;
    } catch (e) { resolve(null); }
  });
}

module.exports = {
  CARD_W, PAGE_PAD, CARD_PAD, CARD_W_IN, INNER_X, INNER_W, CARD_R,
  MAX_ROWS, ROW_H, MAX_CAPS, MAX_LABELS, FIG_W, FIG_H, LAB_W, KPI_W, AGAP,
  BRAND, SLOGAN,
  MINICODE_PATH, QR_BOX, QR_SIZE, QR_GAP, loadMinicode,
  PALETTE, PALETTES, STYLE_KEYS, FONT_SIZE: FS, LABEL_CN,
  estWidth, fit, fitSize, wrap,
  buildModel, layout, measure, draw, drawWeekly, measureWeekly, layoutWeekly
};
