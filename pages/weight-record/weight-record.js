// pages/weight-record/weight-record.js —— 10（记录 + 大数字）在上，11（趋势筛选 + 统计 + 图表 + 记录列表）在下
const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) {            // 'YYYY-MM-DD' -> 'YYYY/MM/DD'
  const [y, m, day] = d.split('-');
  return y + '/' + m + '/' + day;
}
function fmtMD(d) {              // 'YYYY-MM-DD' -> 'M/D'
  const [, m, day] = d.split('-');
  return parseInt(m, 10) + '/' + parseInt(day, 10);
}
function round1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 「全部」视图：按真实跨度自适应生成 X 轴刻度（按天 / 按月 / 按季度）
// 刻度落在真实月首而非窗口均分点；相邻标签去重；总数上限 MAX 个，避免 15px 字号在 ~240px 绘图宽度内重叠
function buildAllTicks(startMs, totalDays, spanDays, padL, plotW) {
  const MS = 86400000;
  const endMs = startMs + totalDays * MS;
  const xOf = (ms) => padL + plotW * ((ms - startMs) / MS / totalDays);
  const yy = (d) => String(d.getFullYear()).slice(2);
  const crossYear = new Date(startMs).getFullYear() !== new Date(endMs).getFullYear();
  const cand = [];

  if (spanDays <= 10) {                       // 十天内：按天
    for (let ms = startMs; ms <= endMs + 1; ms += MS) {
      const d = new Date(ms);
      cand.push({ ms: ms, label: (d.getMonth() + 1) + '/' + d.getDate() });
    }
  } else if (spanDays <= 62) {                // 两个月内：按天取等距，目标 5 个刻度（避免落入「按月」后只剩 1 个刻度）
    const dayCount = Math.round(totalDays) + 1;
    const stepD = Math.max(1, Math.ceil(dayCount / 5));
    for (let k = 0; k < dayCount; k += stepD) {
      const d = new Date(startMs + k * MS);
      cand.push({ ms: startMs + k * MS, label: (d.getMonth() + 1) + '/' + d.getDate() });
    }
  } else if (spanDays <= 366) {               // 一年内：按真实月首（1 号）
    const sd = new Date(startMs);
    let d = new Date(sd.getFullYear(), sd.getMonth(), 1);
    if (d.getTime() < startMs) d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    while (d.getTime() <= endMs) {
      cand.push({
        ms: d.getTime(),
        label: crossYear ? yy(d) + '/' + (d.getMonth() + 1) : (d.getMonth() + 1) + '月'
      });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  } else {                                     // 跨年：按季度月首（1/4/7/10 月），标签必带年
    const sd = new Date(startMs);
    let d = new Date(sd.getFullYear(), Math.floor(sd.getMonth() / 3) * 3, 1);
    if (d.getTime() < startMs) d = new Date(d.getFullYear(), d.getMonth() + 3, 1);
    while (d.getTime() <= endMs) {
      cand.push({ ms: d.getTime(), label: yy(d) + '/' + (d.getMonth() + 1) });
      d = new Date(d.getFullYear(), d.getMonth() + 3, 1);
    }
  }

  // 相邻标签去重（消除 8/31 8/31 9/1 9/1 这类重复）
  const uniq = cand.filter((c, i) => i === 0 || c.label !== cand[i - 1].label);
  const MAX = 5;
  let out = uniq;
  if (out.length > MAX) {
    // 等距取 MAX 个索引（必含首尾）——保证间距均匀且总数不超限，避免末尾两格挤在一起
    const len = uniq.length;
    const picked = [];
    for (let k = 0; k < MAX; k++) {
      const idx = Math.round((len - 1) * k / (MAX - 1));
      if (!picked.length || picked[picked.length - 1] !== idx) picked.push(idx);
    }
    out = picked.map(i => uniq[i]);
  }
  if (!out.length) {
    const d = new Date(startMs);
    out = [{ ms: startMs, label: (d.getMonth() + 1) + '/' + d.getDate() }];
  }
  return out.map(c => ({ x: xOf(c.ms), label: c.label }));
}

Page({
  data: {
    theme: 'theme-light',
    current: { weight: '--', dateText: '' },
    change: { sign: '', value: '0.0' },
    empty: false,

    // 11 模块
    range: 7,
    rangeLabel: '7天',
    stats: { avg: '--', min: '--', max: '--' },
    records: [],
    allShown: false,
    hasMore: false,
    chartEmpty: false,
    showBubble: false,
    activeIndex: -1,          // 当前选中（点击）的记录点下标，指向 this._allPts
    chartImage: '',

    // 弹窗
    showInput: false,
    draft: '',
    inputDate: '',
    inputDateText: ''
  },

  onShow() {
    // 主题：同步自身（「我的 → 深色主题」开关持久化在 Storage）
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    this.loadData();
  },

  loadData() {
    const all = store.getWeightStats(0).list;          // 全部，升序
    if (!all.length) {
      this.setData({
        current: { weight: '--', dateText: '' },
        change: { sign: '', value: '0.0' },
        empty: true
      });
      return;
    }

    const last = all[all.length - 1];
    let change = { sign: '', value: '0.0' };
    if (all.length >= 2) {
      const prev = all[all.length - 2];
      const diff = Math.round((last.weight - prev.weight) * 10) / 10;
      change = { sign: diff < 0 ? '−' : '+', value: round1(Math.abs(diff)) };
    }

    this.setData({
      current: { weight: round1(last.weight), dateText: fmtDate(last.date) },
      change,
      empty: false
    });

    this.rebuildRange();
  },

  // ===== 11：时间筛选 =====
  switchRange(e) {
    const r = Number(e.currentTarget.dataset.range);
    const labelMap = { 7: '7天', 30: '30天', 90: '90天', 0: '全部' };
    this.setData({ range: r, rangeLabel: labelMap[r], allShown: false, showBubble: false, activeIndex: -1 }, () => this.rebuildRange());
  },

  rebuildRange() {
    const r = this.data.range === 0 ? 0 : this.data.range;
    const s = store.getWeightStats(r);
    const list = s.list || [];

    let avg = '--', min = '--', max = '--';
    if (list.length) {
      const ws = list.map(x => x.weight);
      const sum = ws.reduce((a, b) => a + b, 0);
      avg = round1(sum / ws.length);
      min = round1(Math.min.apply(null, ws));
      max = round1(Math.max.apply(null, ws));
    }

    const showList = this.data.allShown ? list : list.slice(0, 6);
    const records = showList.map(x => ({
      date: x.date,
      dateText: fmtDate(x.date),
      weight: round1(x.weight)
    }));

    this.setData({
      stats: { avg, min, max },
      records,
      hasMore: list.length > 6,
      chartEmpty: list.length === 0,
      showBubble: false,
      activeIndex: -1,
      chartImage: list.length === 0 ? '' : this.data.chartImage
    });

    this.drawChart(list);
  },

  toggleRecords() {
    this.setData({ allShown: !this.data.allShown }, () => this.rebuildRange());
  },

  // ===== 点击 kg 弹出体重输入框 =====
  openInput() {
    const d = new Date();
    const ds = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const w = this.data.current.weight !== '--' ? String(this.data.current.weight) : '';
    this.setData({
      showInput: true,
      draft: w,
      inputDate: ds,
      inputDateText: fmtDate(ds)
    });
  },
  onDraft(e) { this.setData({ draft: e.detail.value }); },
  closeInput() { this.setData({ showInput: false }); },
  noOp() {},
  confirmWeight() {
    const v = parseFloat(this.data.draft);
    if (isNaN(v) || v <= 0 || v > 400) {
      wx.showToast({ title: '请输入有效体重', icon: 'none' });
      return;
    }
    store.addWeight(this.data.inputDate, v);   // 按当天日期记录 / 覆盖当天记录
    this.setData({ showInput: false });
    this.loadData();
    wx.showToast({ title: '已记录', icon: 'success' });
  },

  // ===== 趋势图（canvas 2d 绘制 -> 导出图片，规避原生 canvas 不跟随滚动） =====
  drawChart(list) {
    if (!list || list.length < 1) { this._allPts = []; return; }   // 清空，避免点到上一个区间的残留记录
    this._list = list;
    const q = wx.createSelectorQuery().in(this);
    q.select('#weightChart').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        setTimeout(() => this.drawChart(list), 80);   // 首屏节点未就绪，重试一次
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const info = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      const dpr = info.pixelRatio || 2;
      const W = res[0].width, H = res[0].height;
      this._chartW = W; this._chartH = H;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      const padL = 44, padR = 16, padT = 30, padB = 30;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;
      const vals = list.map(r => r.weight);
      let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (lo === hi) { lo -= 1; hi += 1; }
      const span = hi - lo;
      lo = Math.floor((lo - span * 0.18) * 10) / 10;
      hi = Math.ceil((hi + span * 0.18) * 10) / 10;
      const range = (hi - lo) || 1;
      const n = vals.length;
      const yAt = v => padT + plotH - ((v - lo) / range) * plotH;

      // 时间轴：x 按真实日期定位，窗口随 range（默认一个礼拜），对齐 store 过滤窗口
      const MS = 86400000;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let startMs, totalDays, spanDays = 0;
      if (this.data.range === 0) {
        const first = parseDate(list[0].date), last = parseDate(list[n - 1].date);
        startMs = first.getTime() - MS;
        totalDays = Math.max(1, (last.getTime() + MS - startMs) / MS);
        spanDays = Math.max(0, Math.round((last.getTime() - first.getTime()) / MS));  // 真实跨度，驱动「全部」刻度粒度
      } else {
        let days = this.data.range - 1;
        if (this.data.range === 7) days = 4; // 默认视图用 5 天窗口：5 个连续日期刻度无间断、且与数据对齐
        startMs = new Date(today.getTime() - days * MS).getTime();
        totalDays = Math.max(1, days);
      }
      const xAt = (dateStr) => {
        let t = (parseDate(dateStr).getTime() - startMs) / MS / totalDays;
        t = Math.max(0, Math.min(1, t));
        return padL + plotW * t;
      };

      // 长跨度抽稀：记录过多时按桶取均值，避免折线糊成粗带；末端仍保留最新的真实记录（气泡/最新点要对齐真值）
      let src = list.map(r => ({ w: r.weight, d: r.date }));
      if (n > 120) {
        const bucket = Math.ceil(n / 80);
        const agg = [];
        for (let s = 0; s < n; s += bucket) {
          const seg = src.slice(s, s + bucket);
          const avg = seg.reduce((a, b) => a + b.w, 0) / seg.length;
          agg.push({ w: avg, d: seg[Math.floor(seg.length / 2)].d });
        }
        agg[agg.length - 1] = src[n - 1];
        src = agg;
      }
      const P = src.length;                    // 实际绘制点数（抽稀后 < n）
      const pts = src.map(s => ({ x: xAt(s.d), y: yAt(s.w), date: s.d }));
      this._pts = pts;
      this._lastPt = pts[P - 1];
      // 全部真实记录点的画布坐标（命中检测用）：存真实称重值，抽稀后的均值不用于气泡展示
      this._allPts = list.map(r => ({ x: xAt(r.date), y: yAt(r.weight), date: r.date, weight: r.weight }));

      // 横向网格（虚线）+ Y 轴标签
      ctx.font = '15px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      const ticks = 4;
      for (let t = 0; t <= ticks; t++) {
        const y = padT + plotH * t / ticks;
        ctx.strokeStyle = 'rgba(0,0,0,0.05)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.setLineDash([]);
        const val = (hi - range * t / ticks);
        ctx.fillStyle = '#B5B5B0';
        ctx.fillText(Math.round(val).toString(), padL - 10, y);
      }

      // 面积渐变
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, 'rgba(200,255,0,0.30)');
      grad.addColorStop(1, 'rgba(200,255,0,0)');

      // 平滑曲线路径（Catmull-Rom -> 贝塞尔）；close=true 时闭合到基线用于填充
      const tracePath = (close) => {
        ctx.beginPath();
        if (P === 1) {
          ctx.moveTo(pts[0].x, pts[0].y);
        } else {
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 0; i < P - 1; i++) {
            const p0 = pts[i - 1] || pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[i + 2] || p2;
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
          }
        }
        if (close) {
          ctx.lineTo(pts[P - 1].x, padT + plotH);
          ctx.lineTo(pts[0].x, padT + plotH);
          ctx.closePath();
        }
      };

      // 填充
      tracePath(true);
      ctx.fillStyle = grad; ctx.fill();

      // 平滑曲线描边
      tracePath(false);
      ctx.strokeStyle = '#C8FF00';
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();

      // 数据点：间距够宽时逐个画（保证「每个记录点都可点」有可见落点），过密则采样避免糊成一片
      if (P > 1) {
        const gap = plotW / Math.max(1, P - 1);
        const step = gap >= 9 ? 1 : Math.max(1, Math.floor(P / 8));
        ctx.fillStyle = '#C8FF00';
        for (let i = 0; i < P; i += step) {
          if (i === P - 1) continue;
          ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 3.5, 0, Math.PI * 2); ctx.fill();
        }
      }

      // 最新点：外光环 + 白心 + 绿环 + 绿点（始终显示，作为可点击目标）
      const lastPt = pts[P - 1];
      ctx.beginPath(); ctx.arc(lastPt.x, lastPt.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,255,0,0.25)'; ctx.fill();
      ctx.beginPath(); ctx.arc(lastPt.x, lastPt.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#C8FF00'; ctx.stroke();
      ctx.beginPath(); ctx.arc(lastPt.x, lastPt.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#C8FF00'; ctx.fill();

      // 点击任意记录点后显示：竖向虚线 + 气泡标签（该点的真实体重 + 日期）
      if (this.data.showBubble) {
        const ai = this.data.activeIndex;
        const actPt = (ai >= 0 && this._allPts && this._allPts[ai]) ? this._allPts[ai] : lastPt;

        // 选中点高亮：白心 + 深绿环 + 深绿点（选中最新点时跳过，它本身已有荧光绿环）
        if (ai !== this._allPts.length - 1) {
          ctx.beginPath(); ctx.arc(actPt.x, actPt.y, 8, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF'; ctx.fill();
          ctx.lineWidth = 4; ctx.strokeStyle = '#A6C24A'; ctx.stroke();
          ctx.beginPath(); ctx.arc(actPt.x, actPt.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#A6C24A'; ctx.fill();
        }

        ctx.strokeStyle = 'rgba(200,255,0,0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(actPt.x, actPt.y);
        ctx.lineTo(actPt.x, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        const label = round1(actPt.weight != null ? actPt.weight : vals[n - 1]) + 'kg';
        const sub = fmtMD(actPt.date);
        ctx.font = '700 22px sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.font = '400 16px sans-serif';
        const sw = ctx.measureText(sub).width;
        const padX = 16, bubH = 52, bubW = Math.max(tw, sw) + padX * 2;
        let bx = actPt.x - bubW / 2;
        bx = Math.max(padL - 8, Math.min(bx, W - padR - bubW + 8));
        let by = actPt.y - bubH - 16;
        if (by < padT - 6) by = actPt.y + 16;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.14)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
        ctx.beginPath(); roundRect(ctx, bx, by, bubW, bubH, 12);
        ctx.fillStyle = '#FFFFFF'; ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx + bubW / 2 - 7, by + bubH);
        ctx.lineTo(bx + bubW / 2 + 7, by + bubH);
        ctx.lineTo(actPt.x, actPt.y - 9);
        ctx.closePath();
        ctx.fillStyle = '#FFFFFF'; ctx.fill();
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#0A0A0A';
        ctx.font = '700 22px sans-serif';
        ctx.fillText(label, bx + bubW / 2, by + 18);
        ctx.fillStyle = '#B5B5B0';
        ctx.font = '400 16px sans-serif';
        ctx.fillText(sub, bx + bubW / 2, by + 38);
      }

      // X 轴刻度：按 range 选择粒度（数据点 x 仍按真实日期定位，仅刻度标签变化）
      ctx.fillStyle = '#B5B5B0';
      ctx.font = '15px sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      const xTicks = [];
      const r = this.data.range;
      if (r === 7) {
        // 默认视图：5 天窗口 -> 正好 5 个连续日期刻度（M/D，不含星期）、无间断、铺满全宽
        for (let k = 0; k <= 4; k++) {
          const d = new Date(startMs + k * MS);
          xTicks.push({ x: padL + plotW * (k / 4), label: (d.getMonth() + 1) + '/' + d.getDate() });
        }
      } else if (r === 30) {
        // 4 个星期刻度（均匀铺）
        for (let k = 0; k < 4; k++) {
          const tt = k / 3;
          const d = new Date(startMs + totalDays * MS * tt);
          xTicks.push({ x: padL + plotW * tt, label: (d.getMonth() + 1) + '/' + d.getDate() });
        }
      } else if (r === 90) {
        // 3 个月刻度
        for (let k = 0; k < 3; k++) {
          const tt = k / 2;
          const d = new Date(startMs + totalDays * MS * tt);
          xTicks.push({ x: padL + plotW * tt, label: (d.getMonth() + 1) + '月' });
        }
      } else {
        // 全部：单条记录只标它自己的日期；否则按真实跨度自适应（按天 / 按月 / 按季度）
        if (n === 1) {
          const only = parseDate(list[0].date);
          xTicks.push({ x: xAt(list[0].date), label: (only.getMonth() + 1) + '/' + only.getDate() });
        } else {
          buildAllTicks(startMs, totalDays, spanDays, padL, plotW).forEach(t => xTicks.push(t));
        }
      }
      xTicks.forEach(t => {
        // 标签横向仅按文字半宽夹紧到画布内，不再向内收 20px，保证与数据点/x 真实位置对齐
        ctx.fillText(t.label, Math.min(Math.max(t.x, 14), W - 14), padT + plotH + 10);
      });

      // 导出为图片：原生 canvas 在 scroll-view 中不会随内容滚动，改用 <image> 展示
      wx.canvasToTempFilePath({
        canvas,
        success: (r) => { this.setData({ chartImage: r.tempFilePath }); },
        fail: () => {}
      }, this);
    });
  },

  // 点击趋势图：命中任意记录点则显示该点气泡（再点同一点或点空白处收起）
  onChartTap(e) {
    const all = this._allPts;
    if (!all || !all.length || !this._chartW) return;
    wx.createSelectorQuery().in(this).select('#weightChart').boundingClientRect(rect => {
      if (!rect) return;
      const tx = (e.detail.x - rect.left) * (this._chartW / rect.width);
      const ty = (e.detail.y - rect.top) * (this._chartH / rect.height);

      // 找最近的记录点（命中半径 26px）
      let best = -1, bestD = Infinity;
      for (let i = 0; i < all.length; i++) {
        const dx = tx - all[i].x, dy = ty - all[i].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) { bestD = d; best = i; }
      }

      if (best >= 0 && bestD <= 26) {
        if (this.data.showBubble && this.data.activeIndex === best) {
          this.setData({ showBubble: false, activeIndex: -1 }, () => this.drawChart(this._list));
        } else {
          this.setData({ showBubble: true, activeIndex: best }, () => this.drawChart(this._list));
        }
      } else if (this.data.showBubble) {
        this.setData({ showBubble: false, activeIndex: -1 }, () => this.drawChart(this._list));
      }
    }).exec();
  }
});
