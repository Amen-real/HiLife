// scripts/gen-sharecard-preview.cjs
// 生成「训练分享卡」版式预览 HTML —— 给设计评审用，不进小程序包（.cjs 命中打包 suffix 忽略规则）。
//
// 为什么要有这个脚本：分享卡的解剖图是 utils/bodymap.js 里的 SVG 路径（724×1448，无图片资源），
// 光靠文字描述没法评审版式。本脚本把同一份路径数据直接渲染成 SVG 内联到一个静态 HTML 里，
// 于是「预览稿」和「真机出图」用的是**同一份几何**，不会出现「稿子好看、出图变形」。
//
// 用法：node scripts/gen-sharecard-preview.cjs
// 产物：deliverables/sharecard-ref-layout-preview.html
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const bm = require(path.join(ROOT, 'utils/bodymap.js'));
const EX = require(path.join(ROOT, 'utils/exercises.js'));
const stats = require(path.join(ROOT, 'utils/trainingStats.js'));

/* ---------- 1) 从真实动作库找到演示用动作，算出需要高亮的肌群 ---------- */
const WANT = ['杠铃卧推', '上斜哑铃卧推', '绳索夹胸', '双杠臂屈伸'];
const all = [];
Object.keys(EX.library).forEach(cat => EX.library[cat].forEach(a => all.push(a)));

const picked = WANT.map(w => {
  const hit = all.find(a => String(a.nameZh).indexOf(w) >= 0) || all.find(a => String(a.name).toLowerCase().indexOf(w.toLowerCase()) >= 0);
  return hit ? { want: w, rec: hit } : null;
}).filter(Boolean);

const slugSet = new Set();
picked.forEach(p => bm.collectSlugs(p.rec).forEach(s => slugSet.add(s)));

/* ---------- 2) 演示场次（与之前几版预览同一场数据，便于横向对照） ---------- */
const S = (w, r, rpe) => ({ weight: w, reps: r, trainSec: 40, restSec: 90, rpe });
const SESSION = [
  { name: '卧推', equip: '杠铃', sets: [S(60, 10, 8), S(60, 8, 8), S(60, 6, 9)] },
  { name: '上斜哑铃卧推', equip: '哑铃', sets: [S(22.5, 12, 8), S(22.5, 10, 8), S(22.5, 10, 9), S(22.5, 8, 9)] },
  { name: '绳索夹胸', equip: '龙门架', sets: [S(15, 15, 7), S(15, 15, 7), S(15, 12, 8)] },
  { name: '双杠臂屈伸', equip: '自重', sets: [S(0, 12, 8), S(0, 10, 9), S(0, 8, 10)] }
];
const LOG = { date: '2026-09-15', actions: SESSION.map(a => ({ name: a.name, equip: a.equip, setsDetail: a.sets })) };

const vol = stats.loadOfLog(LOG);
const sec = stats.durationSecOfLog(LOG);
const trainSec = stats.trainSecOfLog(LOG);
const kcal = stats.estKcal(trainSec);
const mmss = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
const fmtVol = stats.fmtVol(vol);

/* ---------- 3) 解剖图 —— 直接复用 bodymap 的路径数据 ---------- */
function bodySvg(side, cssClass) {
  const B = bm.bodyPaths(side, slugSet);
  const vb = side === 'back' ? '724 0 724 1448' : '0 0 724 1448';
  const out = [];
  out.push('<svg class="' + cssClass + '" viewBox="' + vb + '" xmlns="http://www.w3.org/2000/svg">');
  out.push('<path d="' + B.outline.d + '" fill="' + B.outline.fill + '" stroke="' + B.outline.stroke + '" stroke-width="2"/>');
  B.parts.forEach(p => out.push('<path d="' + p.d + '" fill="' + p.fill + '" stroke="' + p.stroke + '" stroke-width="2"/>'));
  out.push('</svg>');
  return out.join('\n      ');
}

const partsFront = bm.bodyPaths('front', slugSet);
const partsBack = bm.bodyPaths('back', slugSet);
const hitCn = [...slugSet].map(s => bm.SLUG_TO_CN[s] || s);

/* ---------- 4) 逐组胶囊（最多 3 个，超出折成「+N 组」） ----------
   为什么封顶：4 组以上的动作会把胶囊挤成两行，行高不齐会顶到破纪录条。
   胶囊是「本场练了什么」的摘要，不是完整训练日志 —— 完整明细在复盘页里。
   写死上限而不是靠 CSS 折行，是因为真机是 canvas 定坐标绘制，没有「自动换行」这回事。 */
const MAX_CHIPS = 3;
function chipsOf(a) {
  const all = a.sets.map(s => (Number(s.weight) > 0 ? stats.fmtW(Number(s.weight)) + 'kg×' + s.reps : '自重×' + s.reps));
  if (all.length <= MAX_CHIPS) return all.map(t => ({ t: t, more: false }));
  const head = all.slice(0, MAX_CHIPS).map(t => ({ t: t, more: false }));
  head.push({ t: '+' + (all.length - MAX_CHIPS) + ' 组', more: true });
  return head;
}
const chipsHtml = (a) => chipsOf(a)
  .map(c => '<span class="set' + (c.more ? ' more' : '') + '">' + c.t + '</span>').join('');

/* ---------- 5) 产出版式稿 ---------- */
const C = 750;   // 设计稿 rpx 口径

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>训练分享卡 · 参考图落地版（真实解剖路径）</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:40px 32px 80px; background:#F1F1EF; color:#0A0A0A;
         font-family:"PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif; }
  h1 { font-size:22px; font-weight:800; margin:0 0 10px; }
  .lede { font-size:14px; line-height:1.8; color:#3A3A3A; max-width:860px; margin:0 0 8px; }
  .lede code { background:#fff; border:1px solid #E4E4E0; border-radius:4px; padding:1px 5px; font-size:13px; }
  .warn { font-size:13px; line-height:1.75; color:#5A5A5A; max-width:860px; margin:0 0 28px;
          border-left:3px solid #C8FF00; padding:2px 0 2px 12px; }
  .stage { display:flex; gap:36px; align-items:flex-start; flex-wrap:wrap; }
  .cap { font-size:14px; font-weight:800; margin:0 0 6px; }
  .cap span { font-weight:400; color:#5A5A5A; font-size:13px; }
  .frame { border:1px solid #E4E4E0; border-radius:16px; overflow:hidden; background:#fff; }

  /* ===== 卡片本体：全部数值都是 750rpx 口径 ===== */
  .card { position:relative; width:${C}px; height:1182px; background:#F7F7F5; overflow:hidden; }
  .sheet { position:absolute; left:24px; top:24px; width:702px; height:1134px; background:#fff;
           border-radius:28px; box-shadow:0 10px 30px rgba(10,10,10,.06); }
  .abs { position:absolute; }

  .id { left:64px; top:64px; width:622px; height:64px; display:flex; align-items:center; }
  .av { width:64px; height:64px; border-radius:50%; background:#EFEFEC; color:#444;
        font-size:28px; font-weight:800; display:flex; align-items:center; justify-content:center; }
  .nm { margin-left:20px; font-size:32px; font-weight:800; line-height:64px; }
  .st { margin-left:auto; font-size:22px; font-weight:600; color:#444; line-height:64px; }

  .hero { left:64px; top:152px; width:622px; height:288px; display:flex; }
  .body { height:288px; width:144px; }
  .body.back { margin-left:24px; }
  .kpis { margin-left:auto; text-align:right; }
  .kpi { margin-bottom:20px; }
  .kpi b { display:block; font-size:44px; font-weight:800; line-height:50px; letter-spacing:-.5px; }
  .kpi i { display:block; font-style:normal; font-size:20px; font-weight:600; color:#444; line-height:26px; }

  .muscles { left:64px; top:466px; width:622px; font-size:22px; font-weight:600; color:#444; line-height:30px; }

  .acts { left:64px; top:522px; width:622px; height:424px; }
  .act { margin-bottom:28px; }
  .act b { display:block; font-size:30px; font-weight:800; line-height:38px; margin-bottom:10px; }
  .sets { display:flex; gap:10px; }
  .set { height:36px; line-height:36px; padding:0 14px; border-radius:18px; background:#F4F4F1;
         color:#444; font-size:22px; font-weight:600; white-space:nowrap; }
  .set.more { background:#fff; border:1px dashed #D3D3CF; color:#5A5A5A; }

  .pb { left:64px; top:978px; width:622px; height:84px; border-radius:20px; background:#C8FF00;
        padding:14px 24px; }
  .pb b { display:block; font-size:26px; font-weight:800; line-height:30px; color:#0A0A0A; }
  .pb span { display:block; font-size:22px; font-weight:600; line-height:28px; color:#0A0A0A; margin-top:6px; }

  .foot { left:64px; top:1090px; width:622px; display:flex; justify-content:space-between;
          font-size:22px; font-weight:600; color:#444; line-height:28px; }
  .foot b { font-weight:800; color:#0A0A0A; }

  /* 抽屉（预览用，不是卡片的一部分） */
  .sheetui { width:${C}px; margin-top:28px; border:1px solid #E4E4E0; border-radius:16px; background:#fff; padding:24px; }
  .sheetui h3 { font-size:15px; font-weight:800; margin:0 0 4px; }
  .sheetui p { font-size:13px; color:#5A5A5A; line-height:1.7; margin:0 0 18px; }
  .btnrow { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:22px; }
  .btn { height:52px; line-height:50px; padding:0 22px; border-radius:12px; border:1px solid #E4E4E0;
         font-size:15px; font-weight:600; }
  .ch { display:flex; gap:34px; }
  .chi { text-align:center; font-size:13px; font-weight:600; color:#444; }
  .chi .ci { width:56px; height:56px; border-radius:50%; background:#F4F4F1; margin:0 auto 8px;
             display:flex; align-items:center; justify-content:center; font-size:22px; }
  .chi.dead .ci { background:#F7F7F5; color:#A0A0A0; }
  .chi.dead { color:#A0A0A0; }
  .cancel { text-align:center; font-size:15px; font-weight:600; padding-top:18px; }
</style>
</head>
<body>

<h1>训练分享卡 · 参考图落地版</h1>
<p class="lede">
  按你的参考图重排：<b>身份行（头像/昵称/连续天数）→ 解剖主视觉 + 右列三指标 → 动作列表（逐组胶囊）</b>。
  两个人体用的是 <code>utils/bodymap.js</code> 的 724×1448 真实解剖路径（前 19 段 / 后 16 段），
  <b>没有任何图片资源</b> —— 所以守卫那套「纯数据穷举断言」得以保留。
</p>
<p class="warn">
  高亮肌群由本场 4 个动作的 <code>collectSlugs()</code> 并集算出：${hitCn.join(' · ')}（${slugSet.size} 个 slug）。
  <b>背视图全灰是正确结果</b>——这场是推日，没练背。
</p>

<div class="stage">
  <div>
    <p class="cap">卡片（1:1，750rpx 口径） <span>— 高 1182</span></p>
    <div class="frame">
      <div class="card">
        <div class="abs sheet"></div>

        <div class="abs id">
          <div class="av">A</div>
          <div class="nm">A-men</div>
          <div class="st">连续 6 天</div>
        </div>

        <div class="abs hero">
          ${bodySvg('front', 'body front')}
          ${bodySvg('back', 'body back')}
          <div class="kpis">
            <div class="kpi"><b>${kcal}</b><i>消耗(大卡) · 估算</i></div>
            <div class="kpi"><b>${fmtVol}</b><i>总重量(kg)</i></div>
            <div class="kpi"><b>${mmss}</b><i>总耗时</i></div>
          </div>
        </div>

        <div class="abs muscles">本场练到 · ${hitCn.join(' · ')}</div>

        <div class="abs acts">
          ${SESSION.map(a => `<div class="act">
            <b>${a.name}</b>
            <div class="sets">${chipsHtml(a)}</div>
          </div>`).join('\n          ')}
        </div>

        <div class="abs pb">
          <b>本场刷新 2 项个人纪录</b>
          <span>卧推 60kg × 10 · 上斜哑铃卧推 22.5kg × 12</span>
        </div>

        <div class="abs foot"><b>衡砺健身记录</b><span>记录每一次进步</span></div>
      </div>
    </div>
  </div>
</div>

<div class="sheetui">
  <h3>配的下拉面板（对应参考图底部那一排）</h3>
  <p>三个开关 + 三个分享通道。其中「分享到朋友圈」参考图有，但小程序无法用 API 直接把生成图发朋友圈，<b>不能用它做假按钮</b>。</p>
  <div class="btnrow">
    <div class="btn">隐藏训练内容</div>
    <div class="btn">合并当天</div>
    <div class="btn">更多样式</div>
  </div>
  <div class="ch">
    <div class="chi"><div class="ci">微</div>分享给朋友</div>
    <div class="chi dead"><div class="ci">朋</div>分享到朋友圈</div>
    <div class="chi"><div class="ci">存</div>保存到相册</div>
  </div>
  <div class="cancel">取消</div>
</div>

<p class="warn" style="margin-top:32px">
  说明：本页由 <code>scripts/gen-sharecard-preview.cjs</code> 生成，解剖路径取自 <code>utils/bodymap.js</code> 的
  <code>bodyPaths()</code>。真机出图时这些路径由 <code>canvas 2d</code> 在同一坐标系下绘制，版式数值一致。
</p>

</body>
</html>
`;

const OUT = path.join(ROOT, 'deliverables', 'sharecard-ref-layout-preview.html');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');

console.log('写入 ' + path.relative(ROOT, OUT));
console.log('  高亮肌群 slug：' + [...slugSet].join(', '));
console.log('  前视 parts ' + partsFront.parts.length + ' / 后视 parts ' + partsBack.parts.length);
console.log('  指标：kcal=' + kcal + ' 总量=' + fmtVol + 'kg 耗时=' + mmss + '（纯训练 ' + trainSec + 's）');
picked.forEach(p => console.log('  取到动作库记录：' + p.rec.nameZh + '（' + p.rec.category + ' / ' + p.rec.target + '）← ' + p.want));
