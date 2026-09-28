// scripts/verify-privacy-auth.cjs —— 隐私授权降级（B1-3）回归守卫
//
// 覆盖三块：
//   [A] utils/privacy.js 的分支配对：stub 一个 wx，**跑真实模块**，逐条走完
//       「老基础库 / 已同意 / 同意 / 拒绝后取消 / 拒绝后重试成功 / 拒绝两次 / 问不到 / 抛错 / 双回调」
//   [B] 全仓隐私接口调用点的不变式：每一处都必须让「拒绝授权」这条路径**可感知** ——
//       要么调用前过 privacy.ensure() 门禁，要么在该调用自己给出 fail 降级。
//       （只用字符串数 chooseMedia 是不够的：新增一处 wx.getLocation 就漏了。）
//   [C] 单源：requirePrivacyAuthorize / getPrivacySetting 只准出现在 utils/privacy.js
//
// 用法：node scripts/verify-privacy-auth.cjs
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok() { pass++; }
function bad(m) { fail++; console.log('  ✗ ' + m); }
function eq(a, e, l) { if (a === e) ok(); else bad(l + '：期望 ' + JSON.stringify(e) + '，实际 ' + JSON.stringify(a)); }
function truthy(v, l) { if (v) ok(); else bad(l); }
function has(hay, needle, l) { if (String(hay).indexOf(needle) >= 0) ok(); else bad(l + ' → 未找到 ' + JSON.stringify(needle)); }
function hasNot(hay, needle, l) { if (String(hay).indexOf(needle) < 0) ok(); else bad(l + ' → 仍含 ' + JSON.stringify(needle)); }

/* ═══════════ 工具 ═══════════ */
// 静态检查前先剥注释（wxml/js 同理）。整行注释 + 尾随注释两种都剥。
// 「尾随注释」要求 // 前有空白，避免把 'http://x' 这种字面量切断。
function stripJs(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, ''))
    .join('\n');
}
// 括号匹配用：把字符串**内容**挖空成等长空格（引号保留）。
// 必须等长 —— 否则挖空后的偏移量与原文不再对应，拿它去原文里定位处理器就会错位。
function blankStr(s) {
  return s
    .replace(/'([^'\\]|\\.)*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'")
    .replace(/"([^"\\]|\\.)*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"');
}
// 取 idx 处 '(' 起、与之配对的整段实参
function callArgs(src, openIdx) {
  let d = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') d++;
    else if (c === ')') { d--; if (d === 0) return src.slice(openIdx, i + 1); }
  }
  return src.slice(openIdx);
}
// 找 idx 所在行往前最近的一个「方法定义行」，取到 idx 为止的正文＝该调用点所在处理器。
// 只认 `name(args) {` 形状，因此不会把 `success: (res) => {` 这类回调当成新的处理器边界。
function handlerOf(src, idx) {
  const lines = src.split('\n');
  let pos = 0, lineNo = 0;
  for (let n = 0; n < lines.length; n++) {
    if (pos + lines[n].length >= idx) { lineNo = n; break; }
    pos += lines[n].length + 1;
  }
  for (let n = lineNo; n >= 0; n--) {
    if (/^[\w$]+\s*\([^)]*\)\s*\{$/.test(lines[n].trim())) {
      return lines.slice(n, lineNo + 1).join('\n');
    }
  }
  return lines.slice(0, lineNo + 1).join('\n');
}

/* ═══════════ [A] utils/privacy.js 分支配对 ═══════════ */
const privacy = require(path.join(ROOT, 'utils/privacy.js'));

// 造一台「设备 + 用户」的替身。
//   noAuthorizeApi  老基础库（< 2.32.3），没有 requirePrivacyAuthorize
//   noSettingApi    有 requirePrivacyAuthorize 却没有 getPrivacySetting
//   needAuth        getPrivacySetting 报「需要授权」
//   settingNull     getPrivacySetting 成功但返回 null
//   settingFail     getPrivacySetting 失败
//   authorizeResult 'ok' | 'fail' | 'both' | 函数(第 n 次) → 'ok' | 'fail'
//   authorizeThrow  requirePrivacyAuthorize 同步抛错
//   modalChoice     'confirm'（点「重新授权」）| 'cancel'（点「暂不」）
function stubWx(opts) {
  opts = opts || {};
  const log = { authorize: 0, setting: 0, modal: [] };
  const wx = {};

  if (!opts.noAuthorizeApi) {
    wx.requirePrivacyAuthorize = (o) => {
      log.authorize++;
      if (opts.authorizeThrow) throw new Error('requirePrivacyAuthorize 抛错');
      const act = typeof opts.authorizeResult === 'function'
        ? opts.authorizeResult(log.authorize) : opts.authorizeResult;
      if (act === 'ok') { o.success && o.success({}); return; }
      if (act === 'fail') { o.fail && o.fail({ errMsg: 'requirePrivacyAuthorize:fail auth deny' }); return; }
      // 真机不会 success/fail 都给，但状态机必须受得住（漏了会弹一个莫名其妙的「你刚刚拒绝了」）
      if (act === 'both') { o.success && o.success({}); o.fail && o.fail({ errMsg: 'fail' }); return; }
    };
  }
  if (!opts.noSettingApi) {
    wx.getPrivacySetting = (o) => {
      log.setting++;
      if (opts.settingFail) { o.fail && o.fail({ errMsg: 'getPrivacySetting:fail' }); return; }
      if (opts.settingNull) { o.success && o.success(null); return; }
      o.success && o.success({ needAuthorization: !!opts.needAuth, privacyContractName: '《用户隐私保护指引》' });
    };
  }
  if (!opts.noModalApi) {
    wx.showModal = (o) => {
      log.modal.push(o.content || '');
      const confirm = opts.modalChoice === 'confirm';
      o.success && o.success({ confirm, cancel: !confirm });
    };
  }
  return { wx, log };
}

function runEnsure(stub, label) {
  global.wx = stub.wx;
  return privacy.ensure(label).then((v) => ({ v, log: stub.log }));
}

(async () => {
  console.log('[A] utils/privacy.js 分支配对（stub wx，跑真实模块）');

  truthy(typeof privacy.ensure === 'function', 'A0 模块导出 ensure()');
  const p0 = privacy.ensure();
  truthy(p0 && typeof p0.then === 'function', 'A0b ensure() 返回 Promise');
  await p0;

  // A1 老基础库：没有 requirePrivacyAuthorize → 放行，且不去问 getPrivacySetting
  let s = stubWx({ noAuthorizeApi: true });
  let r = await runEnsure(s, '拍照识别食物');
  eq(r.v, true, 'A1 老基础库无 requirePrivacyAuthorize → 静默放行（不阻断本来能用的功能）');
  eq(r.log.setting, 0, 'A1b 老基础库连 getPrivacySetting 都不问');
  eq(r.log.modal.length, 0, 'A1c 老基础库不弹自家提示');

  // A2 已同意过：needAuthorization=false → 不打扰（这是「同意率」的关键：别每次点都烦用户）
  s = stubWx({ needAuth: false });
  r = await runEnsure(s, '拍照识别食物');
  eq(r.v, true, 'A2 已同意过 → 放行');
  eq(r.log.authorize, 0, 'A2b 已同意过 → 不再拉起官方授权窗');

  // A3 需授权 + 用户同意
  s = stubWx({ needAuth: true, authorizeResult: 'ok' });
  r = await runEnsure(s, '拍照识别食物');
  eq(r.v, true, 'A3 需授权且同意 → 放行');
  eq(r.log.authorize, 1, 'A3b 需授权 → 拉起 1 次官方授权窗');
  eq(r.log.modal.length, 0, 'A3c 成功路径不弹自家提示');

  // A4 需授权 + 拒绝 + 点「暂不」→ 必须给出人话（这是 B1-3 修的原缺陷）
  s = stubWx({ needAuth: true, authorizeResult: 'fail', modalChoice: 'cancel' });
  r = await runEnsure(s, '从相册选图识别食物');
  eq(r.v, false, 'A4 拒绝且不重试 → 明确返回 false（调用方安静退出）');
  eq(r.log.authorize, 1, 'A4b 只弹了 1 次官方窗');
  eq(r.log.modal.length, 1, 'A4c 拒绝后**有**一句人话提示（原先这里什么都没有）');
  has(r.log.modal[0], '从相册选图识别食物', 'A4d 提示里点明了是为哪件事授权');
  has(r.log.modal[0], '是否重新授权', 'A4e 提示里有可执行的下一步');
  hasNot(r.log.modal[0], 'undefined', 'A4f 文案里没有 undefined');

  // A5 拒绝后点「重新授权」且第二次同意 → 放行
  s = stubWx({ needAuth: true, authorizeResult: (n) => (n === 1 ? 'fail' : 'ok'), modalChoice: 'confirm' });
  r = await runEnsure(s, '更换头像');
  eq(r.v, true, 'A5 拒绝后重试且同意 → 放行（给用户回心转意的机会）');
  eq(r.log.authorize, 2, 'A5b 恰好拉起 2 次官方窗');
  eq(r.log.modal.length, 1, 'A5c 重试成功后不再弹自家提示');

  // A6 两次都拒绝且都点「重新授权」→ 必须停下（连弹 3 次以上就成了骚扰）
  s = stubWx({ needAuth: true, authorizeResult: 'fail', modalChoice: 'confirm' });
  r = await runEnsure(s, '更换头像');
  eq(r.v, false, 'A6 两次都拒绝 → 返回 false');
  eq(r.log.authorize, 2, 'A6b 官方授权窗上限 2 次（第二次拒绝即终局）');
  eq(r.log.modal.length, 2, 'A6c 自家提示上限 2 次，不成循环');

  // A7 问不到隐私设置（老基础库/接口异常）→ 不阻断
  s = stubWx({ needAuth: true, settingFail: true });
  r = await runEnsure(s, '拍照识别食物');
  eq(r.v, true, 'A7 getPrivacySetting 失败 → 放行（拿不准就别拦）');
  eq(r.log.authorize, 0, 'A7b 不因为问不到就去拉授权窗');

  // A8 getPrivacySetting 成功但返回 null
  s = stubWx({ needAuth: true, settingNull: true });
  r = await runEnsure(s, '拍照识别食物');
  eq(r.v, true, 'A8 getPrivacySetting 返回 null → 放行');

  // A9 requirePrivacyAuthorize 同步抛错
  s = stubWx({ needAuth: true, authorizeThrow: true });
  r = await runEnsure(s, '拍照识别食物');
  eq(r.v, true, 'A9 requirePrivacyAuthorize 抛错 → 放行（行为不比不接这个模块更差）');
  eq(r.log.modal.length, 0, 'A9b 抛错时不弹自家提示');

  // A10 success 与 fail 同时回调 → settled 必须真的生效
  s = stubWx({ needAuth: true, authorizeResult: 'both' });
  r = await runEnsure(s, '拍照识别食物');
  eq(r.v, true, 'A10 双回调 → 按成功结算');
  eq(r.log.modal.length, 0, 'A10b 双击时**不许**弹「你刚刚拒绝了隐私授权」（settled 要真生效）');

  // A11 不传 label（兜底文案）
  s = stubWx({ needAuth: true, authorizeResult: 'fail', modalChoice: 'cancel' });
  r = await runEnsure(s, undefined);
  has(r.log.modal[0] || '', '该功能', 'A11 不传 label → 兜底成「该功能」');
  hasNot(r.log.modal[0] || '', 'undefined', 'A11b 兜底文案里没有 undefined');

  /* ═══════════ [B] 全仓隐私接口调用点不变式 ═══════════ */
  console.log('[B] 隐私接口调用点不变式');

  // 官方《用户隐私保护指引》里列到的、本项目可能用到的隐私接口。
  // 注意 saveImageToPhotosAlbum / setClipboardData 也在列 ——
  // 「保存到相册」「复制路径」看起来人畜无害，拒绝授权时同样会失败。
  const PRIV = [
    'chooseMedia', 'chooseImage', 'chooseVideo',
    'getLocation', 'chooseLocation', 'chooseAddress', 'chooseInvoiceTitle', 'chooseInvoice',
    'getWeRunData', 'startRecord', 'getRecorderManager', 'joinVoIPChat',
    'saveImageToPhotosAlbum', 'saveVideoToPhotosAlbum',
    'getClipboardData', 'setClipboardData',
    'addPhoneContact', 'addPhoneCalendar', 'addPhoneRepeatCalendar',
    'startAccelerometer', 'startCompass', 'startDeviceMotionListening', 'startGyroscope',
    'takePhoto'   // 相机组件取帧（wx.createCameraContext().takePhoto）
  ];
  // 名字前必须是「<标识符>.」——否则 `takePhoto() {` 这种**方法定义**也会被当成调用点，
  // 而定义的实参天然是空的（无 fail），会报出一堆假警报（假警报比漏报更糟）。
  const PRIV_RX = new RegExp('[A-Za-z_$][\\w$]*\\.(' + PRIV.join('|') + ')\\s*\\(', 'g');

  const SKIP_DIR = ['node_modules', '.git', 'assets', 'images', 'videos', 'scripts',
    'server', 'static', 'miniprogram_npm', '.workbuddy'];
  function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIR.indexOf(e.name) >= 0) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.js$/.test(e.name)) out.push(p);
    }
  }
  const jsFiles = [];
  walk(ROOT, jsFiles);
  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

  // 纯函数：给一份源码，报出所有「拒绝后不可感知」的隐私接口调用点。
  // 做成纯函数是为了能喂已知违规/已知良样本进去，验证尺子本身有效（见 B0）。
  function violationsOf(src) {
    const code = stripJs(src);
    const bare = blankStr(code);          // 与 code 等长，可共用偏移量
    const out = [];
    let m;
    PRIV_RX.lastIndex = 0;
    while ((m = PRIV_RX.exec(bare))) {
      const openIdx = m.index + m[0].length - 1;
      const args = callArgs(bare, openIdx);
      const handler = handlerOf(code, m.index);
      const gated = /privacy\.ensure\(/.test(handler) || /privacy\.ensure\(/.test(args);
      const hasFail = /(^|[\s,{])fail\s*[:,=]/.test(args);
      const line = code.slice(0, m.index).split('\n').length;
      if (!gated && !hasFail) out.push({ api: m[1], line, why: '既无 privacy.ensure 门禁，也无 fail 降级' });
      // 有门禁但没看返回值 = 门禁形同虚设（.then 里第一件事必须是 if (!ok) return）
      if (gated) {
        const after = handler.slice(handler.indexOf('privacy.ensure('));
        if (!/privacy\.ensure\([^)]*\)\s*\.then\([^)]*\)\s*=>\s*\{\s*if\s*\(!ok\)\s*return;/.test(after)) {
          out.push({ api: m[1], line, why: '过了门禁却没检查 ok（拒绝后仍会继续调用）' });
        }
      }
    }
    return out;
  }

  // B0 尺子自检：先确认它能看见违规、也不冤枉良样本
  eq(violationsOf('  bad() {\n    wx.chooseMedia({ count: 1 });\n  },').length, 1,
    'B0 注入已知违规样本 → 报 1 处（证明规则确实生效，不是恒绿）');
  eq(violationsOf("  good() {\n    privacy.ensure('x').then((ok) => { if (!ok) return; wx.chooseMedia({ count: 1 }); });\n  },").length, 0,
    'B0b 注入已知良样本（过门禁 + 检查 ok）→ 不报');
  eq(violationsOf('  g2() {\n    wx.saveImageToPhotosAlbum({ filePath: p, fail: () => {} });\n  },').length, 0,
    'B0c 有 fail 降级的调用点 → 不报');
  eq(violationsOf("  g3() {\n    privacy.ensure('x').then((ok) => { wx.chooseMedia({}); });\n  },").length, 1,
    'B0d 过了门禁却不看返回值 → 报 1 处（门禁形同虚设也算违规）');

  truthy(jsFiles.length > 20, 'B1 扫到 ' + jsFiles.length + ' 个 js 文件（样本量正常，不是没扫到）');
  const allViol = [];
  jsFiles.forEach((f) => {
    if (rel(f) === 'utils/privacy.js') return;   // 门禁模块自身就是实现
    violationsOf(fs.readFileSync(f, 'utf8')).forEach(v => {
      allViol.push(rel(f) + ':' + v.line + ' [' + v.api + '] ' + v.why);
    });
  });
  eq(allViol.length, 0, 'B2 所有隐私接口调用点都有降级' + (allViol.length ? ' → ' + allViol.join(' | ') : ''));

  // 反向：门禁不能是死的（有 privacy.ensure 就必须真有一处被门禁的隐私调用）
  let gateCount = 0, privCount = 0;
  ['pages/advice/advice.js', 'pages/food-scan/food-scan.js', 'pages/profile/profile.js'].forEach((f) => {
    const code = stripJs(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const bare = blankStr(code);
    gateCount += (code.match(/privacy\.ensure\(/g) || []).length;
    let n = 0, m2;
    const rx = new RegExp('[A-Za-z_$][\\w$]*\\.(' + PRIV.join('|') + ')\\s*\\(', 'g');
    while ((m2 = rx.exec(bare))) {
      if (/privacy\.ensure\(/.test(handlerOf(code, m2.index))) n++;
    }
    privCount += n;
    ok();
  });
  eq(gateCount, privCount, 'B3 门禁数与受门禁的调用点数一致（门禁没有空挂）' + gateCount + '/' + privCount);
  eq(gateCount, 3, 'B4 三处 chooseMedia 都过了门禁（食物识别拍照 / 饮食页拍照 / 换头像）');

  /* ═══════════ [C] 单源 ═══════════ */
  console.log('[C] 单源：授权 API 只准出现在 utils/privacy.js');
  const privSrc = fs.readFileSync(path.join(ROOT, 'utils/privacy.js'), 'utf8');
  has(privSrc, 'requirePrivacyAuthorize', 'C0 utils/privacy.js 是 requirePrivacyAuthorize 的实现处');
  has(privSrc, 'getPrivacySetting', 'C0b utils/privacy.js 是 getPrivacySetting 的调用处');
  has(privSrc, 'module.exports', 'C0c utils/privacy.js 有导出');

  let leaked = [];
  jsFiles.forEach((f) => {
    if (rel(f) === 'utils/privacy.js') return;
    const code = stripJs(fs.readFileSync(f, 'utf8'));
    if (/requirePrivacyAuthorize/.test(code)) leaked.push(rel(f) + ' → requirePrivacyAuthorize');
    if (/getPrivacySetting/.test(code)) leaked.push(rel(f) + ' → getPrivacySetting');
  });
  eq(leaked.length, 0, 'C1 授权 API 未在门禁模块之外重复出现' + (leaked.length ? ' → ' + leaked.join(', ') : ''));

  // app.js 特别点：原先在 onLaunch 里提前拉授权窗，冷启动就弹一个说不清的窗
  const appCode = stripJs(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
  hasNot(appCode, 'requirePrivacyAuthorize', 'C2 app.js 不再提前请求隐私授权（交回平台在真正调用时弹）');

  // 门禁必须覆盖三个真实入口，而不只是存在于某处
  ['pages/food-scan/food-scan.js', 'pages/advice/advice.js', 'pages/profile/profile.js'].forEach((f) => {
    const code = stripJs(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    has(code, "require('../../utils/privacy.js')", 'C3 ' + f + ' 引入 privacy 门禁');
  });

  console.log('\npass=' + pass + '  fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
