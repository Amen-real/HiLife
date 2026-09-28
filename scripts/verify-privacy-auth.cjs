// scripts/verify-privacy-auth.cjs —— 隐私授权降级（B1-3）回归守卫
//
// 覆盖三块：
//   [A] utils/privacy.js 的分支配对：stub 一个 wx，**跑真实模块**，逐条走完
//       「老基础库 / 已同意 / 同意 / 拒绝后取消 / 拒绝后重试成功 / 拒绝两次 / 问不到 / 抛错 / 双回调」
//   [B] 全仓隐私接口调用点的不变式：每一处都必须让「拒绝授权」这条路径**可感知** ——
//       要么调用前过 privacy.ensure() 门禁，要么在该调用自己给出 fail 降级。
//       （只用字符串数 chooseMedia 是不够的：新增一处 wx.getLocation 就漏了。）
//   [C] 单源：requirePrivacyAuthorize / getPrivacySetting 只准出现在 utils/privacy.js
//   [D] 隐私政策页的声明 ⊇ 全仓实际用到的隐私接口（接口 → 官方「信息类型」声明式映射）
//   [E] 隐私政策页的第三方披露 ↔ 服务端真实的模型出口（vision_llm.py 的默认域名）
//       出口是第三方，政策就必须写「第三方」；出口换回自托管，政策就不许再写「第三方大模型」。
//       —— B7-3（2026-09-28）：旧文案把识别能力归给「微信云开发提供」，而云开发根本不提供
//          视觉识别，真实出口是阿里云百炼（第三方）。两者一错一漏，靠这条反查盯住。
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
// wxml 注释同样要剥：文档注释里写的「我们要声明的信息类型」不是声明本身，
// 而解释「旧文案错在哪」的注释会原样引用旧文案 —— 不剥就会和待检查的正文互相抵消（假绿灯）。
function stripWxml(s) {
  return String(s).replace(/<!--[\s\S]*?-->/g, '');
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

  /* ═══════════ [D] 隐私政策页声明 ⊇ 实际用到的隐私接口 ═══════════ */
  console.log('[D] 隐私政策页声明 ↔ 实际调用（审核会逐条核对这一对）');

  // 官方《用户隐私保护指引》里的「信息类型」名称。用了哪个接口，页内就必须出现对应类型名。
  // 刻意写成声明式映射：将来新增隐私接口时在这里补一行 —— 忘了同步隐私政策，这条守卫就按红。
  // （B7-2 就是这么来的：用了「相册（仅写入）」与「剪贴板」却没声明，用户看不到，审核也会问。）
  const DECLARE_RULES = [
    { api: 'saveImageToPhotosAlbum', need: '相册（仅写入）', why: '保存训练分享卡到相册' },
    { api: 'setClipboardData', need: '剪贴板', why: '导出时复制备份文件路径' },
    { api: 'getClipboardData', need: '剪贴板', why: '读取剪贴板' },
    { api: 'chooseMedia', need: '相册', why: '拍照/选图识别、换头像' },
    { api: 'chooseImage', need: '相册', why: '选图' },
    { api: 'getLocation', need: '位置', why: '地理位置' }
  ];

  const usedApis = new Set();
  jsFiles.forEach((f) => {
    const bare = blankStr(stripJs(fs.readFileSync(f, 'utf8')));
    const rx = new RegExp('[A-Za-z_$][\\w$]*\\.(' + PRIV.join('|') + ')\\s*\\(', 'g');
    let m;
    while ((m = rx.exec(bare))) usedApis.add(m[1]);
  });
  truthy(usedApis.size >= 3, 'D0 全仓扫到 ' + usedApis.size + ' 个在用的隐私接口（样本量正常）：' + [...usedApis].join(', '));

  // 先剥 wxml 注释：声明必须写在正文里，写在注释里不算（见 stripWxml 的说明）。
  const privPage = stripWxml(fs.readFileSync(path.join(ROOT, 'pages/privacy/privacy.wxml'), 'utf8'));
  const misses = (pageText) => DECLARE_RULES.filter(r => usedApis.has(r.api) && pageText.indexOf(r.need) < 0);
  const undeclared = misses(privPage);
  eq(undeclared.length, 0, 'D1 用到的隐私接口在隐私政策里都有对应声明' + (undeclared.length
    ? ' → 缺：' + undeclared.map(r => r.api + ' 须声明「' + r.need + '」（用途：' + r.why + '）').join('；') : ''));

  // 尺子自检：把已声明的类型名从文本里抠掉，规则必须立刻报红（否则「全绿」可能只是规则空转）
  eq(misses(privPage.replace(/相册（仅写入）/g, '').replace(/剪贴板/g, '')).length >= 2, true,
    'D2 抠掉「相册（仅写入）」「剪贴板」后规则报红（证明尺子盯着这几个词）');

  // 反向：实际没用的接口不该在页里瞎声明（空承诺的另一种形态）
  ['getLocation', 'getWeRunData', 'startRecord'].forEach((api) => {
    if (usedApis.has(api)) return;
    const name = api === 'getLocation' ? '位置信息' : (api === 'getWeRunData' ? '微信运动' : '麦克风');
    truthy(privPage.indexOf(name) < 0, 'D3 未使用 ' + api + ' → 页内不声明「' + name + '」（不写做不到的事）');
  });

  /* ═══════════ [E] 第三方披露 ↔ 服务端真实出口 ═══════════ */
  console.log('[E] 第三方披露 ↔ 服务端模型出口（说了没有 / 有了没说，两种都算错）');

  const llmSrc = fs.readFileSync(path.join(ROOT, 'server/vision_llm.py'), 'utf8');
  const hostM = llmSrc.match(/DEFAULT_BASE_URL\s*=\s*["']https?:\/\/([^/"']+)/);
  truthy(!!hostM, 'E0 能从 vision_llm.py 读出默认出口域名（读不到说明改了写法，须同步这条守卫）');
  const llmHost = hostM ? hostM[1] : '';

  // 第三方判定写成「判非微信自家」而不是「匹配 dashscope」：
  // 换供应商（百炼 → 火山 / 硅基流动 / 自建代理）时不必改守卫，判定自动跟着走。
  const isThirdParty = !!llmHost && !/(^|\.)(tcb\.qcloud\.la|weixin\.qq\.com|qq\.com)$/i.test(llmHost);
  truthy(!!llmHost, 'E1 出口域名 = ' + (llmHost || '(空)') + ' ⇒ 判定为' + (isThirdParty ? '第三方' : '自托管 / 微信自家'));

  // 只认**正文**：段标题（class="h"）不算声明 ——
  // 「四、第三方服务」这个标题里天然带「第三方」，拿它去满足断言就是假绿灯。
  // （本守卫第一版真踩了这个坑：注入旧文案时 E2 没报「缺第三方声明」，全靠后来做注入复核才发现。）
  const privBody = privPage.replace(/<view class="h">[\s\S]*?<\/view>/g, '');

  // 纯函数：喂一段政策正文，报出第三方披露的缺失项（做成纯函数才能喂已知违规样本自检，见 E3）。
  function disclosureMisses(text) {
    const out = [];
    if (text.indexOf('第三方') < 0) out.push('缺「第三方」声明');
    if (text.indexOf('大模型') < 0) out.push('未点明是大模型服务');
    return out;
  }
  // 旧文案（B7-3 之前的原文）—— 既把能力归错给云开发，又完全没提第三方。
  const OLD_TP_TEXT = '饮食照片识别依赖微信云开发提供的视觉识别能力；媒体资源（动作图片 / 演示）由云存储或 CDN 提供。';

  if (isThirdParty) {
    const miss = disclosureMisses(privBody);
    eq(miss.length, 0, 'E2 出口是第三方 ⇒ 政策正文须写明第三方' + (miss.length ? ' → ' + miss.join('；') : ''));
    eq(disclosureMisses(OLD_TP_TEXT).length, 2,
      'E3 尺子自检：旧文案必须被报出 2 项缺失（证明规则盯着正文，不是恒绿）');
    eq(privBody.indexOf('第三方服务') < 0, true,
      'E3b 段标题已从待检正文中剥离（「四、第三方服务」不许顶替正文声明）');
    eq(disclosureMisses('<view class="h">四、第三方服务</view>'.replace(/<view class="h">[\s\S]*?<\/view>/g, '')).length, 2,
      'E3c 尺子自检：只有那个标题、正文为空 ⇒ 两项都报缺（标题不顶用）');
  } else {
    // 反向：出口已换回自托管 ⇒ 政策里不许再点名第三方大模型（空承诺的另一种形态）。
    // 只盯「第三方多模态大模型」这个具体说法，不波及正文里合法的「不会提供给任何第三方」。
    hasNot(privBody, '第三方多模态大模型', 'E2′ 出口已是自托管 → 政策正文不许再写「第三方多模态大模型」');
  }

  // 归属正确性：本项目里微信云开发只承载云托管 / 云存储，**不提供**视觉识别。
  const FALSE_ATTR_RX = /云开发[^。；]{0,24}(提供|负责|实现|识别|运算)/;
  eq(FALSE_ATTR_RX.test(OLD_TP_TEXT), true,
    'E4 尺子自检：注入旧的错误归属文案 → 规则必须报红');
  eq(FALSE_ATTR_RX.test(privPage), false,
    'E5 政策未把识别能力归给微信云开发（云开发不提供视觉识别，识别由云托管上的服务完成）');

  console.log('\npass=' + pass + '  fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
