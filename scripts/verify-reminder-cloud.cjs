/**
 * verify-reminder-cloud.cjs —— 订阅消息提醒「云端链路」守卫（node 直跑，无 wx 环境）
 *
 * 覆盖：
 *   [S] reminderSync/normalize.js 纯函数归一（白名单 / hour 回落 / intent+intentDate 成对 / quota 钳制）
 *   [P] reminderPush/picker.js 纯函数筛选 / 去重 / 扣减
 *   [W] 小程序端 + 云函数接线静态断言（唯一通道 / 授权同步栈 / 全静默 / 判据真源不复刻）
 *   [G] 「尺子能看见被测物」自检：文件 / 函数体取不到必须显式 fail，不许空过
 *
 * 用法：node scripts/verify-reminder-cloud.cjs
 * 退出码：0 = 通过；1 = 存在违规
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok(msg) { pass++; console.log('  ✓ ' + msg); }
function bad(msg) { fail++; console.log('  ✗ ' + msg); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label + ' = ' + JSON.stringify(actual));
  else bad(label + ' 期望 ' + JSON.stringify(expect) + '，实际 ' + JSON.stringify(actual));
}
function truthy(cond, label) { cond ? ok(label) : bad(label); }

/* ══════════════ [G] 尺子自检：先确认「能看见被测物」 ══════════════ */
console.log('[G] 尺子自检（文件/函数体取不到必须显式 fail，不许空过）');

const FILES = [
  'cloudfunctions/reminderSync/index.js',
  'cloudfunctions/reminderSync/normalize.js',
  'cloudfunctions/reminderPush/index.js',
  'cloudfunctions/reminderPush/picker.js',
  'cloudfunctions/reminderPush/config.json',
  'utils/reminderCloud.js',
  'utils/reminder.js',
  'app.js',
  'pages/profile/profile.js',
  'pages/workout/workout.js',
  'pages/home/home.js'
];
const SRC = {};
FILES.forEach(rel => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { bad('[G] 文件缺失：' + rel); SRC[rel] = ''; return; }
  const s = fs.readFileSync(p, 'utf8');
  if (!s.trim()) { bad('[G] 文件为空：' + rel); }
  SRC[rel] = s;
});

// 函数体提取：function name( ... ) 与对象方法 name( ... ) { ... } 两种形态通用（花括号配平）
function methodBody(src, name) {
  const m = src.match(new RegExp('\\b' + name + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!m) return '';
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  return '';
}

// 剥注释后的「纯代码」：静态禁词/结构断言只认代码，注释里提到相关词不算实现
function code(src) {
  return String(src || '').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

let normalize = null;
let pick = null;try {
  normalize = require(path.join(ROOT, 'cloudfunctions/reminderSync/normalize.js')).normalize;
  pick = require(path.join(ROOT, 'cloudfunctions/reminderPush/picker.js')).pick;
} catch (e) {
  bad('[G] 纯函数模块加载失败（守卫核心被测物不可达）：' + e.message);
}
truthy(typeof normalize === 'function', '[G] normalize 是可调用纯函数');
truthy(typeof pick === 'function', '[G] pick 是可调用纯函数');

/* ══════════════ [S] reminderSync/normalize.js 归一边界 ══════════════ */
if (typeof normalize === 'function') {
  console.log('\n[S] reminderSync/normalize：payload 白名单归一');
  const T = '2026-11-05';
  let p = normalize({
    on: true, hour: 20, intent: true, intentDate: '2026-11-04',
    lastTrainDate: '2026-11-04', quotaDelta: 1,
    // 白名单外的注入字段必须全部丢弃（防篡改）
    evil: 'x', quota: 999, lastPushDate: T, admin: true, _openid: 'spoof'
  }, T);
  eq(p.evil, undefined, 'S1a 白名单外字段 evil 被丢弃');
  eq(p.quota, undefined, 'S1b quota 不接受直写（只能走 quotaDelta 增量）');
  eq(p.lastPushDate, undefined, 'S1c lastPushDate 不接受客户端直写（只在下发成功后由 push 云函数写）');
  eq(p.admin, undefined, 'S1d 白名单外字段 admin 被丢弃');
  eq(p._openid, undefined, 'S1e openid 不接受客户端伪造');
  eq(p.on, true, 'S1f on 透传');
  eq(p.hour, 20, 'S1g 合法档位 hour 透传');
  eq(p.intent, true, 'S1h intent 透传');
  eq(p.intentDate, '2026-11-04', 'S1i 显式合法 intentDate 保留');
  eq(p.lastTrainDate, '2026-11-04', 'S1j 合法 lastTrainDate 透传');
  eq(p.quotaDelta, 1, 'S1k quotaDelta=+1 接受');

  eq(normalize({ hour: 25 }, T).hour, 18, 'S2a hour 越界（25）回落 18');
  eq(normalize({ hour: -1 }, T).hour, 18, 'S2b hour 越界（-1）回落 18');
  eq(normalize({ hour: 'abc' }, T).hour, 18, 'S2c hour 脏值回落 18');
  eq(normalize({}, T).hour, undefined, 'S2d 缺 hour 不写（{quotaDelta:1} 上报不得覆盖用户档位）');

  eq(normalize({ intent: true }, T).intentDate, T, 'S3a 写 intent 缺 intentDate → 成对补 today');
  eq(normalize({ intent: false }, T).intentDate, T, 'S3b intent:false 同样成对带 intentDate');
  eq(normalize({ intent: true, intentDate: 'bad' }, T).intentDate, T,
    'S3c intentDate 形态非法 → 回落 today（intent+intentDate 永不成对失散）');
  eq(normalize({ intentDate: T }, T).intentDate, T, 'S3d 只报 intentDate（不带 intent）→ 透传日期');
  eq(normalize({ intent: 'yes' }, T).intent, undefined, 'S3e intent 非 boolean 不写');

  eq(normalize({ lastTrainDate: '2026/11/05' }, T).lastTrainDate, undefined,
    'S4a lastTrainDate 形态非法不写（云端保留原值）');
  eq(normalize({ lastTrainDate: '' }, T).lastTrainDate, undefined,
    'S4b 空串不写（「今天没练」不得覆盖云端 lastTrainDate）');

  console.log('\n[S2] quota 增量钳制（防篡改红线：单次只接受 +1）');
  eq(normalize({ quotaDelta: 1 }, T).quotaDelta, 1, 'S5a +1 接受');
  eq(normalize({ quotaDelta: 0 }, T).quotaDelta, 0, 'S5b 0 归 0');
  eq(normalize({ quotaDelta: -5 }, T).quotaDelta, 0, 'S5c 负增量归 0（防篡改）');
  eq(normalize({ quotaDelta: 2 }, T).quotaDelta, 0, 'S5d 大幅正值归 0（防篡改）');
  eq(normalize({ quotaDelta: 1.5 }, T).quotaDelta, 0, 'S5e 非整数归 0');
  eq(normalize({ quotaDelta: 'x' }, T).quotaDelta, 0, 'S5f 脏值归 0');
  eq(normalize({ quotaDelta: '1' }, T).quotaDelta, 0, 'S5g 字符串 "1" 不当 +1（typeof 收口，QA Bug2 加固）');
  eq(normalize({ quotaDelta: true }, T).quotaDelta, 0, 'S5h boolean true 不当 +1（typeof 收口，QA Bug2 加固）');
  eq(normalize({}, T).quotaDelta, 0, 'S5i 缺省归 0');

  console.log('\n[S3] 脏 payload 不崩');
  eq(normalize(null, T).quotaDelta, 0, 'S6a null payload 不崩');
  eq(normalize([], T).quotaDelta, 0, 'S6b 数组 payload 不崩');
  eq(normalize(undefined, T).quotaDelta, 0, 'S6c undefined payload 不崩');
}

/* ══════════════ [P] reminderPush/picker.js 筛选/去重/扣减 ══════════════ */
if (typeof pick === 'function') {
  console.log('\n[P] reminderPush/picker：档位匹配 / 当日意图 / 未训练 / 同日去重 / 额度');
  const DAY = '2026-11-05';
  function u(o) {
    return Object.assign({
      _id: 'd1', _openid: 'o1', on: true, hour: 18, quota: 3, intent: true,
      intentDate: DAY, lastTrainDate: '2026-11-03', lastPushDate: ''
    }, o);
  }
  const r = pick([
    u({}),                        // ✓ 唯一合规
    u({ _id: 'd2', on: false }),  // 关开关
    u({ _id: 'd3', hour: 19 }),   // 档位不匹配
    u({ _id: 'd4', quota: 0 }),   // 额度耗尽
    u({ _id: 'd5', intent: false }),           // 无意图
    u({ _id: 'd6', intentDate: '2026-11-04' }),// 意图跨天失效
    u({ _id: 'd7', lastTrainDate: DAY }),      // 今天已练
    u({ _id: 'd8', lastPushDate: DAY }),       // 今天已推过（同日去重）
    null                                        // 脏数据不崩
  ], { hour: 18, today: DAY });

  eq(r.targets.length, 1, 'P1 九个候选里只有完全合规的 1 个被选中');
  eq(r.targets[0]._id, 'd1', 'P2 命中的是全条件满足的用户');
  eq(r.patches.length, 1, 'P3 补丁与目标一一对应');
  eq(r.patches[0].quota, -1, 'P4 扣减补丁 quota=-1（成功下发才扣）');
  eq(r.patches[0].lastPushDate, DAY, 'P5 补丁写 lastPushDate=今天（同日去重落点）');
  eq(r.patches[0].id, 'd1', 'P6 补丁带文档 id');
  eq(r.patches[0].openid, 'o1', 'P7 补丁带 openid');

  eq(pick(null, { hour: 18, today: DAY }).targets.length, 0, 'P8 null 入参不崩');
  eq(pick([u({})], { today: DAY }).targets.length, 0, 'P9 缺 hour → 无命中（脏 ctx 保守不放行）');
  eq(pick([u({})], { hour: 18 }).targets.length, 0, 'P10 缺 today → 无命中');
  eq(pick([u({ quota: 0.5 })], { hour: 18, today: DAY }).targets.length, 1,
    'P11 quota>0 即可（0.5 也算有额度）；扣减恒为 -1 由补丁固定，不会出现负额度');
}

/* ══════════════ [W] 接线静态断言 ══════════════ */
console.log('\n[W] 小程序端接线 + 云函数结构');

// —— 判据唯一真源 ——
{
  const cloudJs = SRC['utils/reminderCloud.js'];
  const rj = SRC['utils/reminder.js'];
  truthy(!!cloudJs, '[G] reminderCloud.js 源码可读');
  truthy(!!rj, '[G] reminder.js 源码可读');
  truthy(/require\(\s*['"][^'"]*reminder\.js['"]\s*\)/.test(cloudJs),
    'W1 reminderCloud require 判据真源 reminder.js');
  truthy(/intentToday\s*\(/.test(cloudJs), 'W2 intent 只调 reminder.intentToday（唯一真源）');
  truthy(!/weekBehind|hasPlan\s*\|\|/.test(cloudJs), 'W2b reminderCloud 不复刻意图判据');
  truthy(/intentToday/.test(rj) && /module\.exports[\s\S]*intentToday/.test(rj),
    'W2c reminder.js 导出 intentToday');

  // —— 云端唯一通道 ——
  const PROFILE = SRC['pages/profile/profile.js'];
  const WORKOUT = SRC['pages/workout/workout.js'];
  const HOME = SRC['pages/home/home.js'];
  [['profile.js', PROFILE], ['workout.js', WORKOUT], ['home.js', HOME]].forEach(([name, s]) => {
    truthy(!!s && !/wx\.cloud\.callFunction/.test(code(s)), 'W3 ' + name + ' 不直接 callFunction（唯一通道 reminderCloud）');
    truthy(!!s && !/requestSubscribeMessage/.test(code(s)), 'W3b ' + name + ' 不直接 requestSubscribeMessage');
  });
  truthy(/callFunction/.test(code(cloudJs)), 'W4 reminderCloud 确实走 wx.cloud.callFunction');
  truthy(!/setStorageSync/.test(code(cloudJs)), 'W4b 云端档案数据不进本地存储（单键 1MB 红线）');

  // —— 全静默红线 ——
  truthy(!/\bthrow\b/.test(code(cloudJs)), 'W5 reminderCloud 不 throw');
  truthy(/fail\s*:/.test(cloudJs), 'W6 callFunction 带 fail 静默回调');
  const rsBody = methodBody(cloudJs, 'reportState');
  truthy(rsBody.length > 0, '[G] 取到 reportState 函数体');
  truthy(/try\s*\{/.test(rsBody) && /catch\s*\(/.test(rsBody), 'W7 reportState 全程 try/catch');
  const rgBody = methodBody(cloudJs, 'requestGrant');
  truthy(rgBody.length > 0, '[G] 取到 requestGrant 函数体');
  truthy(/try\s*\{/.test(rgBody) && /catch\s*\(/.test(rgBody), 'W8 requestGrant 全程 try/catch');
  truthy(/requestSubscribeMessage/.test(rgBody), 'W8b requestSubscribeMessage 收拢在 requestGrant 内');
  truthy(/if\s*\(!tmplId\)\s*return/.test(rgBody), 'W9 tmplId 为空直接 return（不弹窗，安全空转）');
  truthy(/quotaDelta:\s*1/.test(rgBody), 'W10 accept → quotaDelta:1（授权攒额度）');
  truthy(!/quotaDelta:\s*-\d/.test(cloudJs), 'W11 客户端不扣额度（扣减只在云端下发成功后）');
  truthy(/buildSnapshot/.test(cloudJs) && /function\s+buildSnapshot|buildSnapshot\s*\(/.test(cloudJs),
    'W12 buildSnapshot 纯函数存在并被消费');

  // —— 授权只在用户点击同步栈内 ——
  const tapBody = methodBody(PROFILE, 'tapReminder');
  truthy(tapBody.length > 0, '[G] 取到 profile.tapReminder 方法体');
  truthy(/requestGrant\s*\(/.test(tapBody), 'W13 tapReminder 开启分支同步栈内调 requestGrant');
  truthy(/reportState\s*\(/.test(tapBody), 'W14 tapReminder 接 reportState（开/关两分支均上报）');
  // QA Bug1 回归锁定：空事实会把云端当日 intent:true 覆盖成 false —— reportState 必须喂
  // reminderFacts() 真实事实，profile 内禁止出现 reportState(x, {}) 形态
  const factsBody = methodBody(PROFILE, 'reminderFacts');
  truthy(factsBody.length > 0, '[G] 取到 profile.reminderFacts 方法体');
  ['hasPlan', 'trainedToday', 'weekDone', 'weekTarget'].forEach(k => {
    truthy(new RegExp('\\b' + k + '\\s*:').test(factsBody), 'W14b reminderFacts 喂真实事实含 ' + k);
  });
  truthy(/intentToday|intentToday|weekRange|inRange/.test(factsBody) && /resolveTodayPlan/.test(factsBody),
    'W14b2 reminderFacts 口径与首页一致（todayPlan / 自然周 dateRange），判据仍归 intentToday');
  truthy((tapBody.match(/reminderFacts\s*\(/g) || []).length >= 2, 'W14c tapReminder 开/关两分支都传 reminderFacts（非空事实）');
  truthy(!/reportState\s*\([^)]*,\s*\{\}\s*\)/.test(tapBody), 'W14d tapReminder 无空事实上报');
  const pickHourBody = methodBody(PROFILE, 'onPickReminderHour');
  truthy(pickHourBody.length > 0, '[G] 取到 profile.onPickReminderHour 方法体');
  truthy(/reportState\s*\(/.test(pickHourBody), 'W15 onPickReminderHour 末尾 reportState（档位同步）');
  truthy(/reminderFacts\s*\(/.test(pickHourBody) && !/reportState\s*\([^)]*,\s*\{\}\s*\)/.test(pickHourBody),
    'W15b onPickReminderHour 传 reminderFacts（非空事实）');

  const swBody = methodBody(WORKOUT, 'saveWorkout');
  truthy(swBody.length > 0, '[G] 取到 workout.saveWorkout 方法体');
  const idxAuth = swBody.search(/auth\.requireLogin\(\)/);
  const idxGrant = swBody.search(/requestGrant\s*\(/);
  const idxTimeout = swBody.indexOf('setTimeout(');
  truthy(idxAuth >= 0, '[G] saveWorkout 内存在 auth.requireLogin（守卫锚点）');
  truthy(idxGrant > idxAuth, 'W16 saveWorkout 中 requestGrant 在 requireLogin 之后');
  truthy(idxTimeout < 0 || idxGrant < idxTimeout,
    'W17 requestGrant 在任何 setTimeout 之前（授权留在用户点击同步栈）');
  truthy(/reportState\s*\(/.test(swBody), 'W18 saveWorkout 落库后 reportState');
  truthy(/trainedToday:\s*true/.test(swBody), 'W18b 上报事实含 trainedToday:true（→ lastTrainDate=今天、intent=false）');

  const rfBody = methodBody(HOME, 'refresh');
  truthy(rfBody.length > 0, '[G] 取到 home.refresh 方法体');
  truthy(/reportState\s*\(/.test(rfBody), 'W19 home.refresh 末尾 reportState（喂 intentToday 所需事实）');
  ['hasPlan', 'trainedToday', 'weekDone', 'weekTarget'].forEach(k => {
    truthy(new RegExp('\\b' + k + '\\s*:').test(rfBody), 'W20 refresh 上报事实含 ' + k);
  });
  ['closeReminder', 'snoozeReminder'].forEach(fn => {
    const b = methodBody(HOME, fn);
    truthy(b.length > 0, '[G] 取到 home.' + fn + ' 方法体');
    truthy(/reportState\s*\(/.test(b), 'W21 ' + fn + ' 内 reportState（当日 intent 归 false）');
  });

  // —— 占位常量 ——
  truthy(/reminderTmplId\s*:\s*'[0-9A-Za-z_-]{20,}'/.test(SRC['app.js']), 'W22 app.js globalData 有 reminderTmplId 非空合法模板 ID');
  truthy(/process\.env\.TMPL_ID\s*\|\|\s*'[0-9A-Za-z_-]{20,}'/.test(SRC['cloudfunctions/reminderPush/index.js'] || ''),
    'W22b reminderPush 环境变量之外有真实模板 ID 兜底');
}

// —— 云函数结构：薄壳只做 IO，纯函数零 wx-server-sdk ——
{
  const syncIdx = SRC['cloudfunctions/reminderSync/index.js'];
  const syncNorm = SRC['cloudfunctions/reminderSync/normalize.js'];
  const pushIdx = SRC['cloudfunctions/reminderPush/index.js'];
  const pushPicker = SRC['cloudfunctions/reminderPush/picker.js'];

  truthy(!!syncNorm && !/wx-server-sdk/.test(code(syncNorm)), 'W23 normalize.js 纯函数零 wx-server-sdk');
  truthy(!!pushPicker && !/wx-server-sdk/.test(code(pushPicker)), 'W23b picker.js 纯函数零 wx-server-sdk');
  truthy(!!syncIdx && /require\(['"]wx-server-sdk['"]\)/.test(code(syncIdx)), 'W24 reminderSync 薄壳引 wx-server-sdk');
  truthy(!!pushIdx && /require\(['"]wx-server-sdk['"]\)/.test(code(pushIdx)), 'W24b reminderPush 薄壳引 wx-server-sdk');
  truthy(/getWXContext/.test(code(syncIdx)) && /OPENID/.test(code(syncIdx)), 'W25 openid 由 getWXContext 取（客户端不传）');
  truthy(/serverDate/.test(code(syncIdx)), 'W26 updatedAt 用 db.serverDate()');
  truthy(/TMPL_ID/.test(code(pushIdx)), 'W27 reminderPush 读环境变量 TMPL_ID');
  truthy(/subscribeMessage\.send/.test(code(pushIdx)), 'W28 走 cloud.openapi.subscribeMessage.send');
  truthy(/pages\/training\/training/.test(code(pushIdx)), 'W29 卡片落地训练 tab');
  truthy(/lastPushDate/.test(code(pushIdx)) && /inc\(\s*-1\s*\)|\.quota,\s*-1|p\.quota/.test(code(pushIdx)),
    'W30 send 成功才扣额度 + 写 lastPushDate');
  truthy(/continue/.test(code(pushIdx)), 'W30b send 失败静默跳过（不扣额度）');
  truthy(/pick\s*\(/.test(code(pushIdx)), 'W30c 精筛交给 picker 纯函数（薄壳只做 IO）');

  let cfg = null;
  try { cfg = JSON.parse(SRC['cloudfunctions/reminderPush/config.json'] || 'null'); } catch (e) { bad('W31 config.json 解析失败'); }
  truthy(!!cfg && Array.isArray(cfg.triggers) && cfg.triggers.length === 1
    && cfg.triggers[0].name === 'reminder-hourly'
    && cfg.triggers[0].type === 'timer'
    && cfg.triggers[0].config === '0 0 * * * * *',
    'W31 定时触发器 reminder-hourly 每小时整点（0 0 * * * * *）');

  truthy(/require\(['"]\.\/normalize\.js['"]\)/.test(code(syncIdx)), 'W32 薄壳复用 normalize 纯函数');
  truthy(/require\(['"]\.\/picker\.js['"]\)/.test(code(pushIdx)), 'W32b 薄壳复用 picker 纯函数');

  // QA Bug2 回归锁定：并发建档竞态 —— where().get()+add() 非原子会产生影子文档
  truthy(/\.doc\(OPENID\)/.test(code(syncIdx)), 'W33 建档走 doc(openid)（_id=openid 天然幂等，无并发影子文档）');
  truthy(/\.set\(\s*\{/.test(code(syncIdx)), 'W33b 不存在时 doc(openid).set 建档（set 语义幂等）');
  truthy(!/\.add\(/.test(code(syncIdx)), 'W33c 不再使用 add（where+add 非原子，已废弃）');
  truthy(!/where\(\s*\{\s*_openid/.test(code(syncIdx)), 'W33d 不再按 _openid where 查询（改 doc(openid) 直取）');

  // W34 卡片键名契约 —— 模板 518「打卡提醒」详情页实际键名；不符会 47003 静默全失败
  truthy(/time13\s*:\s*\{\s*value/.test(code(pushIdx)), 'W34a cardData 用 time13（提醒时间）');
  truthy(/thing8\s*:\s*\{\s*value/.test(code(pushIdx)), 'W34b cardData 用 thing8（任务说明）');
  truthy(/phrase10\s*:\s*\{\s*value/.test(code(pushIdx)), 'W34c cardData 用 phrase10（打卡状态，phrase ≤5 字）');
  truthy(!/thing1\s*:\s*\{\s*value|time2\s*:\s*\{\s*value|thing3\s*:\s*\{\s*value/.test(code(pushIdx)),
    'W34d cardData 不再含旧占位键名 thing1/time2/thing3');
}

console.log('\npass=' + pass + '  fail=' + fail);
process.exit(fail ? 1 : 0);
