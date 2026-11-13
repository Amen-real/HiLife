#!/usr/bin/env node
/**
 * verify-workout-session.cjs —— 训练会话持久化（落盘 + 冷启动水合）回归
 *
 * 背景（2026-11-13 用户报障）：训练中误退/杀掉小程序后重新进入，当场训练进度全丢 ——
 * 旧 workoutSession 是纯内存单例。现改为「内存为主 + 同步落盘 + 冷启动水合」，
 * 本守卫用 wx 桩做跨重启功能测试，锁死以下契约：
 *   A. 每次变更同步落盘（save/update/markRunning/freeze/syncElapsed），clear 连落盘一起清
 *   B. 冷启动水合：load()/has()/getElapsed() 惰性从 storage 恢复，仅一次
 *   C. 新鲜度护栏：updatedAt 超 24h 的落盘会话作废
 *   D. 计时口径护栏：running 且离开间隔 > 30min → 自动冻结（不补记离开的墙上时间）；
 *      ≤ 30min 视为真实休息继续走表
 *   E. 结构校验：脏数据/空 storage/无 wx 环境一律静默降级不崩
 *
 * 用法：node scripts/verify-workout-session.cjs
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MOD_PATH = path.join(ROOT, 'utils', 'workoutSession.js');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \u2713 ' + m); };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (label, a, b) => (a === b) ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const isTrue = (label, v) => v ? ok(label) : bad(label);
const isFalse = (label, v) => !v ? ok(label) : bad(label);

const KEY = 'hh_workout_session';

function freshRequire(wxStub) {
  delete require.cache[require.resolve(MOD_PATH)];
  if (wxStub) global.wx = wxStub; else delete global.wx;
  return require(MOD_PATH);
}
function mkStub(store) {
  return {
    getStorageSync: (k) => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; }
  };
}
const HOUR = 3600 * 1000;
function mkSession(over) {
  return Object.assign({
    signature: 'a,b',
    actions: [{ id: 'a', name: 'x', sets: [{ weight: 40, reps: 8 }] }],
    planName: '测试计划', expandedId: 'a',
    elapsed: 100, running: false, startTs: null,
    updatedAt: Date.now()   // 真实落盘恒有此字段（persist 写入）；缺了会被新鲜度护栏正确判废
  }, over || {});
}

/* ===== A. 每次变更同步落盘 ===== */
console.log('\n[A] 变更同步落盘');
{
  const store = {};
  const S = freshRequire(mkStub(store));
  S.save(mkSession());
  isTrue('save 后 storage 有会话', !!store[KEY]);
  isTrue('save 落盘含 updatedAt', !!(store[KEY] && store[KEY].updatedAt > 0));
  S.update({ expandedId: 'b' });
  eq('update 落盘同步 expandedId', store[KEY] && store[KEY].expandedId, 'b');
  S.markRunning();
  isTrue('markRunning 落盘 running=true', !!(store[KEY] && store[KEY].running === true && store[KEY].startTs > 0));
  S.freeze();
  isTrue('freeze 落盘 running=false', !!(store[KEY] && store[KEY].running === false));
  S.syncElapsed();
  isTrue('syncElapsed 无 running 时不崩', !!store[KEY]);
  S.clear();
  isFalse('clear 连落盘一起清（防已完成训练复活）', KEY in store);
  eq('clear 后内存也为空', S.load(), null);
}

/* ===== B+C+D. 跨重启水合 ===== */
console.log('\n[B] 跨重启水合（模拟杀进程后冷启动）');
{
  // B1: running 且间隔 2min → 继续走表
  const store1 = {};
  store1[KEY] = mkSession({ running: true, startTs: Date.now() - 2 * 60 * 1000 });
  let S = freshRequire(mkStub(store1));
  const sess1 = S.load();
  isTrue('B1 冷启动恢复会话', !!sess1 && sess1.signature === 'a,b');
  isTrue('B1 间隔 2min ≤ 30min：保持 running', sess1.running === true);
  const e1 = S.getElapsed();
  isTrue('B1 getElapsed ≈ elapsed(100s)+gap(120s)', e1 >= 218 && e1 <= 224);

  // B2: running 且间隔 40min → 自动冻结，不补记
  const store2 = {};
  store2[KEY] = mkSession({ running: true, startTs: Date.now() - 40 * 60 * 1000 });
  S = freshRequire(mkStub(store2));
  const sess2 = S.load();
  isTrue('B2 间隔 40min > 30min：自动冻结', sess2.running === false && sess2.startTs === null);
  eq('B2 不补记离开期间的墙上时间', sess2.elapsed, 100);
  eq('B2 getElapsed 停在冻结值', S.getElapsed(), 100);

  // B3: updatedAt 超 24h → 作废
  const store3 = {};
  store3[KEY] = mkSession({ updatedAt: Date.now() - 25 * HOUR });
  S = freshRequire(mkStub(store3));
  eq('B3 超 24h 的落盘会话作废', S.load(), null);
  eq('B3 has() 同样为 false', S.has(), false);

  // B4: 脏数据/空 storage → 静默降级
  const store4 = {};
  store4[KEY] = 'garbage-string';
  S = freshRequire(mkStub(store4));
  eq('B4 脏数据当无会话', S.load(), null);
  const store5 = {};
  S = freshRequire(mkStub(store5));
  eq('B5 空 storage 无会话', S.load(), null);

  // B6: 水合只发生一次 —— load 后改内存再重读不会被 storage 覆盖
  const store6 = {};
  store6[KEY] = mkSession();
  S = freshRequire(mkStub(store6));
  S.load();
  S.update({ planName: '内存新值' });
  eq('B6 水合仅一次：内存单例不被 storage 旧值覆盖', S.load().planName, '内存新值');
}

/* ===== E. 无 wx 环境（node 守卫/探针直跑） ===== */
console.log('\n[E] 无 wx 环境静默降级');
{
  const S = freshRequire(null);
  S.save(mkSession());
  eq('E1 save 不崩', S.has(), true);
  eq('E2 load 正常返回内存会话', S.load().signature, 'a,b');
  S.clear();
  eq('E3 clear 不崩', S.load(), null);
}

/* ===== F. 接线断言：workout 页恢复仍走来源签名校验 ===== */
console.log('\n[F] 接线契约');
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'pages', 'workout', 'workout.js'), 'utf8');
  isTrue('F1 workout.onLoad 恢复仍校验 signature === 来源签名', /sess\.signature\s*===\s*sig/.test(src));
  isTrue('F2 完成训练仍调 workoutSession.clear()', /workoutSession\.clear\(\)/.test(src));
  isTrue('F3 落盘键名与守卫一致', fs.readFileSync(path.join(ROOT, 'utils', 'workoutSession.js'), 'utf8').indexOf("'" + KEY + "'") >= 0);
}

console.log('\npass=' + pass + '  fail=' + fail);
process.exit(fail ? 1 : 0);
