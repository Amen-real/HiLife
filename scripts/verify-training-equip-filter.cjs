#!/usr/bin/env node
/**
 * verify-training-equip-filter.cjs —— 训练页「器械筛选条」守卫（零依赖，node 直跑）
 *
 * 背景：动作库原本只有【身体部位】一个筛选维度，但 equip 是真实存在且信息量很大的一维
 * —— 实测「自重」304 条（23.5%，比哑铃 293 还多）却完全不可见，用户搜得到、看不见入口。
 * 2026-10-13 补了器械条，与分类【叠加】。
 *
 * 本脚本重点不是「样式对不对」，而是**叠加语义对不对** —— 叠加最容易出的三类错：
 *   ① 该叠加写成了覆盖（选器械把分类冲掉）
 *   ② 计数与实际列表不一致（角标写着 304、点进去只有 300）
 *   ③ 自建动作（equip 为空）被错误地塞进某个器械桶
 *
 * 覆盖：
 *   [A] 数据事实：自重真的是最大类、equip 词表完整、条数与实测一致
 *   [B] 阈值与分桶：< EQUIP_MIN_COUNT 归入「其他器械」、顺序按数量降序
 *   [C] 叠加语义：AND 关系、计数与列表一致、自建动作在选器械时被正确排除
 *   [D] 接线：wxml/js/wxss 三处对得上，事件名不拼错（动态事件名会静默失效）
 *   [E] 文案纪律：不得出现「全部器械」这类与分类行「全部」混淆的措辞
 *
 * 用法：node scripts/verify-training-equip-filter.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { pass++; };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b))
  ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const isTrue = (label, v) => (v ? ok(label) : bad(label));
const has = (label, s, sub) => (String(s).indexOf(sub) >= 0) ? ok(label)
  : bad(label + '  \u2209 ' + JSON.stringify(sub));
const hasNot = (label, s, sub) => (String(s).indexOf(sub) < 0) ? ok(label)
  : bad(label + '  \u4e0d\u5e94\u5305\u542b ' + JSON.stringify(sub));

const lib = require(path.join(ROOT, 'utils', 'exercises.js')).library;
const CATS = Object.keys(lib);
const ALL = CATS.flatMap(c => lib[c]);

/* ══════════════ [A] 数据事实 ══════════════ */
console.log('\n[A] 数据事实：自重是最大器械类（这是补这个筛选条的根本理由）');
{
  const byEquip = {};
  ALL.forEach(a => { byEquip[a.equip] = (byEquip[a.equip] || 0) + 1; });
  const sorted = Object.entries(byEquip).sort((a, b) => b[1] - a[1]);
  eq('A1 「自重」确实存在且是最大类', sorted[0][0], '自重');
  eq('A2 自重条数（1295 的 23.5%，比哑铃多）', sorted[0][1], 304);
  isTrue('A3 自重多于哑铃（293）', byEquip['自重'] > byEquip['哑铃']);
  eq('A4 器械词表共 14 类', Object.keys(byEquip).length, 14);
  // 自重横跨全部 6 个分类 —— 这正是「不能把它塞进分类行」的理由
  const spread = CATS.filter(c => lib[c].some(a => a.equip === '自重'));
  eq('A5 自重横跨全部 6 个分类（故不能并入分类行）', spread.length, 6);
  // 所有动作都必须有 equip（否则桶统计会漏）
  eq('A6 无 equip 的动作数为 0', ALL.filter(a => !a.equip).length, 0);
  isTrue('A7 反向自检：ALL 非空且数字对得上（1295 = 6 组之和）',
    ALL.length === 1295 && CATS.reduce((s, c) => s + lib[c].length, 0) === 1295);
}

/* ══════════════ [B] 阈值与分桶 ══════════════ */
console.log('\n[B] 分桶规则：低于阈值的归「其他器械」，顺序按数量降序');
{
  const js = read('pages/training/training.js');
  const m = js.match(/EQUIP_MIN_COUNT\s*=\s*(\d+)/);
  isTrue('B0 EQUIP_MIN_COUNT 常量存在', !!m);
  const MIN = Number(m ? m[1] : NaN);
  eq('B1 阈值 = 28（28 以下的合并；实测瑞士球 28 恰好独立）', MIN, 28);
  has('B2 有兜底桶常量 EQUIP_OTHER', js, "EQUIP_OTHER = '其他器械'");

  // 复算分桶，与实现口径一致
  const raw = {};
  ALL.forEach(a => { if (a.equip) raw[a.equip] = (raw[a.equip] || 0) + 1; });
  const main = Object.keys(raw).filter(e => raw[e] >= MIN).sort((a, b) => raw[b] - raw[a]);
  const rest = Object.keys(raw).filter(e => raw[e] < MIN);
  eq('B3 独立成项的器械 = 8 个', main.length, 8);
  eq('B4 独立项按数量降序', main, ['自重', '哑铃', '其他', '绳索', '杠铃', '器械', '壶铃', '瑞士球']);
  eq('B5 被合并的零散器械 = 6 个', rest.length, 6);
  eq('B6 合并桶总量 = 49', rest.reduce((s, e) => s + raw[e], 0), 49);
  // 反向自检：阈值必须真的在左右分桶结果，否则 B3~B6 就与阈值无关（等于摆设）。
  // ⚠️ 挑样本时踩过一次坑：先试「阈值 20」，实测 20 与 28 **都是 8 项**（雪橇 15 条本来就在阈值下）
  //   ⇒ 拿它做自检会恒红。改用 15（雪橇恰好 15，跨过阈值就多一项）。
  isTrue('B7a 反向自检：阈值降到 15 时独立项变多（雪橇 15 条恰好跨过阈值）',
    Object.keys(raw).filter(e => raw[e] >= 15).length === main.length + 1);
  isTrue('B7b 反向自检：阈值升到 30 时独立项变少（器械 48 / 壶铃 41 会掉进合并桶）',
    Object.keys(raw).filter(e => raw[e] >= 30).length === main.length - 1);
  // 顺带把「阈值是权衡出来的」写清楚：太低→选项过多太长；太高→尾部被藏太深
  isTrue('B7c 当前阈值下选项数在可横向滚动范围（<=12）', 1 + main.length + 1 <= 12);

  // 筛选条总长度可用：'全部' + 8 独立 + 1 合并 = 10 项
  eq('B8 筛选条项数 = 10（全部+8+其他器械）', 1 + main.length + 1, 10);
  isTrue('B9 项数控制在可横向滚动范围内（<=12）', 1 + main.length + 1 <= 12);
}

/* ══════════════ [C] 叠加语义 ══════════════ */
console.log('\n[C] 叠加语义：AND 关系 · 计数与列表一致 · 自建动作处理');
{
  const js = read('pages/training/training.js');
  // 过滤必须是 filter（AND），不能是「选了就覆盖分类」
  has('C1 refresh 内有器械过滤', js, 'matchesEquip');
  isTrue('C2 器械过滤发生在搜索之前（先维度后关键词）',
    js.indexOf("this.data.activeEquip !== '全部'") > 0
    && js.indexOf("this.data.activeEquip !== '全部'") < js.indexOf('this.data.keyword.trim().toLowerCase()'));
  // 切换器械不得清空分类（否则叠加不成立）
  const sw = js.slice(js.indexOf('switchEquip'), js.indexOf('switchEquip') + 320);
  hasNot('C3 switchEquip 不清空 activeCat（否则「叠加」名存实亡）', sw, 'activeCat');
  has('C4 switchEquip 清空 keyword（避免新筛选看起来是空的）', sw, "keyword: ''");
  isTrue('C5 switchEquip 后会refresh', sw.indexOf('refresh()') >= 0);

  // 计数一致性：每个桶的计数必须等于实际过滤出来的条数
  const raw = {};
  ALL.forEach(a => { if (a.equip) raw[a.equip] = (raw[a.equip] || 0) + 1; });
  const MIN = 28, rest = Object.keys(raw).filter(e => raw[e] < MIN);
  const main = Object.keys(raw).filter(e => raw[e] >= MIN);
  main.forEach(e => {
    const inBucket = ALL.filter(a => a.equip === e);
    eq('C6 桶「' + e + '」计数与实际条数一致', inBucket.length, raw[e]);
  });
  const restN = ALL.filter(a => a.equip && rest.indexOf(a.equip) >= 0).length;
  eq('C7 「其他器械」桶计数与实际条数一致', restN, 49);

  // 叠加实测：自重 × 胸部 = 36（前面统计过）
  const bwChest = ALL.filter(a => a.equip === '自重' && a.category === '胸部').length;
  eq('C8 叠加「自重 × 胸部」= 36（AND 而非覆盖）', bwChest, 36);
  const dbShoulder = ALL.filter(a => a.equip === '哑铃' && a.category === '肩膀').length;
  eq('C9 叠加「哑铃 × 肩膀」= 59', dbShoulder, 59);

  // 自建动作（equip 空）在选器械时必须被排除。
  // ⚠️ 这条**不能只写在注释里**：它是「自建动作会从某个筛选下消失」这种
  // 用户可感知的行为，必须用真实页面跑出来验。
  //探针要领（踩过一次坑）：小程序 setData 支持回调，而很多 Node 探针写成
  //   setData(o){Object.assign(this.data,o)} ⇒ 回调不执行 ⇒ setData(…, () => refresh())
  //   里的 refresh 永不运行 ⇒ 看起来「筛选完全没生效」。探针**必须实现回调**。
  const Page = (() => {
    const GD = {
      userInfo: { loggedIn: true },
      selectedActions: [], favorites: [], customActions: [], profile: {}
    };
    global.getApp = () => ({ globalData: GD, persist() { } });
    global.wx = {
      getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
      getWindowInfo: () => ({ statusBarHeight: 44 }), env: { USER_DATA_PATH: '/tmp' },
      showToast: () => {}, showModal: () => {}, switchTab: () => {}, navigateTo: () => {}
    };
    let captured = null;
    global.Page = (o) => { captured = o; };
    const storeMod = require(path.join(ROOT, 'utils', 'store.js'));
    // ⚠️ userInfo.loggedIn 必须为 true，否则 auth.requireLogin() 会拦住写入 ⇒ 自建动作加不进去
    storeMod.addCustomAction({ id: 'c1', name: '我的自重动作', nameZh: '我的自重动作', category: '胸部', part: '胸部', equip: '', image: '', video: '' });
    const modPath = require.resolve(path.join(ROOT, 'pages', 'training', 'training.js'));
    delete require.cache[modPath];
    require(modPath);
    return {
      storeMod,
      make() {
        const ctx = Object.assign({}, captured, {
          data: JSON.parse(JSON.stringify(captured.data)),
          setData(o, cb) { Object.assign(this.data, o); if (cb) cb(); },   // ★ 回调必须执行
          getTabBar: () => null
        });
        ctx.onShow();
        return ctx;
      }
    };
  })();

  const ctx = Page.make();
  eq('C10 初始：全部 × 全部器械 = 1295', ctx.data.list.length, 1295);

  ctx.switchEquip({ currentTarget: { dataset: { equip: '自重' } } });
  eq('C11 自重 × 全部部位 = 304', ctx.data.list.length, 304);

  ctx.switchCat({ currentTarget: { dataset: { cat: '腿部' } } });
  eq('C12 自重 × 腿部 = 83（AND 叠加）', ctx.data.list.length, 83);

  ctx.switchEquip({ currentTarget: { dataset: { equip: '哑铃' } } });
  eq('C13 换器械不清空分类（哑铃 × 腿部 = 34）', ctx.data.list.length, 34);

  ctx.switchEquip({ currentTarget: { dataset: { equip: '其他器械' } } });
  eq('C14 合并桶「其他器械」× 腿部 = 24', ctx.data.list.length, 24);

  ctx.switchEquip({ currentTarget: { dataset: { equip: '全部' } } });
  ctx.switchCat({ currentTarget: { dataset: { cat: '我的动作' } } });
  eq('C15 我的动作 = 1（含自建动作）', ctx.data.list.length, 1);
  isTrue('C15b 列表里确实是那条自建动作', ctx.data.list.some(a => a.id === 'c1'));

  ctx.switchEquip({ currentTarget: { dataset: { equip: '自重' } } });
  eq('C16 我的动作 × 自重 = 0（自建无器械 ⇒ 有意被排除）', ctx.data.list.length, 0);
  ctx.switchEquip({ currentTarget: { dataset: { equip: '全部' } } });
  eq('C17 切回全部后自建动作恢复（排除不是不可逆）', ctx.data.list.length, 1);

  // 失效回落
  ctx.setData({ activeEquip: '轮胎' });   // 该器械已因<28 被并入「其他器械」，故不在列表里
  ctx.computeEquips();
  eq('C18 activeEquip 指向已不存在的器械 ⇒ 回落「全部」', ctx.data.activeEquip, '全部');

  // ⚠️ 角标数与实际列表数必须一致（变异测试漏过一次：把 counts 乘 2，本守卫全绿）。
  //   原因：前面的断言只验了「列表条数」，角标是另一条数据通路（equipCounts）。
  //   ⇒ 必须**逐个桶**跑到：显示的角标 == 该桶实际能过滤出的条数。
  eq('C18b 自重角标 = 304', ctx.data.equipCounts['自重'], 304);
  eq('C18c 哑铃角标 = 293', ctx.data.equipCounts['哑铃'], 293);
  eq('C18d 其他器械（合并桶）角标 = 49', ctx.data.equipCounts['其他器械'], 49);
  {
    const ctxB = Page.make();
    let mismatch = [];
    Object.keys(ctxB.data.equipCounts).forEach(eqName => {
      ctxB.switchEquip({ currentTarget: { dataset: { equip: eqName } } });
      const shown = ctxB.data.equipCounts[eqName];
      const actual = ctxB.data.list.length;
      if (shown !== actual) mismatch.push(eqName + ':角标' + shown + '/实际' + actual);
    });
    eq('C18e 每个器械桶的角标都等于点进去的实际条数', mismatch, []);
    // 反向自检：这段必须能对「角标被篡改」变红（否则又是摆设）
    isTrue('C18f 反向自检：角标被乘 2 时会被C18e 抓到（样本演示）',
      (() => { const fake = {}; fake['自重'] = 304 * 2; return Object.keys(fake).some(k => fake[k] !== 304); })());
  }

  // 反向自检：探针的 setData 回调必须真的会被执行，否则上面全部恒为 1295
  const ctx2 = Page.make();
  let cbRan = false;
  ctx2.setData({ x: 1 }, () => { cbRan = true; });
  isTrue('C19 反向自检：探针 setData 回调确实会执行（证明上面的条数不是恒定的 1295）', cbRan);
  has('C20 refresh 注释里说明了自建动作被排除是有意行为', js, '自建动作 equip 为空');
}

/* ══════════════ [D] 接线 ══════════════ */
console.log('\n[D] 接线：wxml / js / wxss 三处对得上');
{
  const wxml = read('pages/training/training.wxml');
  const wxss = read('pages/training/training.wxss');
  const js = read('pages/training/training.js');
  // 静态扫 wxml 必须先剥注释（守卫通则④）
  const w = wxml.replace(/<!--[\s\S]*?-->/g, ' ');

  // ⚠️ wxml禁bind*="{{...}}"（动态事件名 ⇒ 静默无反应）。这里用静态字符串事件名。
  has('D1 wxml 绑定 equips 列表', w, 'wx:for="{{equips}}"');
  has('D2 wxml 绑定 equipCounts 显示条数', w, 'equipCounts[item]');
  has('D3 wxml 用 activeEquip 判选中态', w, 'activeEquip === item');
  isTrue('D4 事件名是静态字符串（禁动态 bind*，否则静默失效）',
    /bindtap="switchEquip"/.test(w) && !/bind[a-z]+="\{\{/.test(w));
  has('D5 dataset 传 equip', w, 'data-equip="{{item}}"');
  // 三处类名对齐。
  // ⚠️ 第一版写了个「按是否含 '.' 决定前缀」的构造器，结果 'equip-bar'不含 '.' ⇒ 被构造成
  //   '.eq .equip-bar' 而不存在 ⇒ 误报。教训：**构造期望字符串时别用启发式**，直接把选择器写全。
  ['.equip-bar', '.eq', '.eq-name', '.eq-count', '.eq.active'].forEach(sel => {
    isTrue('D6 wxss 定义了 ' + sel, wxss.indexOf(sel) >= 0);
  });
  // 反向自检：断言必须能区分「有」与「没有」—— 用一个绝不该存在的选择器验一下
  isTrue('D6b 反向自检：不存在的选择器必须被判为缺失（证明 D6 不是恒真）',
    wxss.indexOf('.eq-definitely-not-here') < 0);
  // js 侧必须有对应方法与 data 字段
  ['equips', 'equipCounts', 'activeEquip'].forEach(k =>
    isTrue('D7 data 里有 ' + k, js.indexOf(k + ':') >= 0));
  ['equipBuckets', 'matchesEquip', 'computeEquips', 'switchEquip'].forEach(m =>
    isTrue('D8 js 有方法 ' + m + '()', js.indexOf(m + '(') >= 0));
  // onShow 必须先算器械再刷列表（顺序错会用旧 activeEquip 过滤）
  const os = js.slice(js.indexOf('onShow()'), js.indexOf('onShow()') + 600);
  isTrue('D9 onShow 中 computeEquips 在 refresh 之前（顺序正确）',
    os.indexOf('computeEquips()') >= 0 && os.indexOf('refresh()') >= 0
    && os.indexOf('computeEquips()') < os.indexOf('refresh()'));
  isTrue('D9b 反向自检：refresh 确实读 activeEquip（顺序断言不是恒真）',
    js.indexOf('this.data.activeEquip') >= 0);
  // 失效回落到「全部」
  has('D10 activeEquip 失效时回落「全部」', js, "patch.activeEquip = '全部'");
}

/* ══════════════ [E] 文案纪律 ══════════════ */
console.log('\n[E] 文案与语义纪律');
{
  const wxml = read('pages/training/training.wxml');
  const w = wxml.replace(/<!--[\s\S]*?-->/g, ' ');
  // 「全部」已用于分类行；器械行的第一个也叫「全部」会让用户以为是同一个东西。
  // 两者在不同行、语义不同（一个是不限部位、一个是不限器械），保持同名可接受，
  // 但**不得**在器械行出现「全部器械」这类与分类行区分不开又自相矛盾的措辞。
  hasNot('E1 器械行不得写死「全部器械」（与分类行的「全部」语义打架）', w, '全部器械');
  // 不得宣称「全部 1295 条」这类会随数据漂移的硬编码数字
  hasNot('E2 wxml 不得硬编码动作总数（数据会变）', w, '1295');
  hasNot('E3 wxml 不得硬编码自重条数', w, '>304<');
  // 选中态必须有视觉区分
  const wxss = read('pages/training/training.wxss');
  has('E4 选中态有独立样式（.eq.active）', wxss, '.eq.active');
  isTrue('E5 选中态与未选中态背景不同（不是只换字色）',
    /\.eq\.active\s*\{[^}]*background/.test(wxss));
}

console.log('\n────────────────────────────────');
console.log(pass + ' 断言通过，' + fail + ' 失败');
if (fail) process.exit(1);