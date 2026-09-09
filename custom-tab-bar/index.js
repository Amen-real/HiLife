// custom-tab-bar/index.js
const workoutSession = require('../utils/workoutSession.js');
// 主题：隔离组件不继承页面 data，启动时自行从 Storage 读一次；
// 之后各 tab 页 onShow 会通过 getTabBar().setData({ theme }) 覆盖为最新值。
const theme = require('../utils/theme.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 悬浮药丸设计尺寸（rpx），参考图「训练最小化」方案（收窄迭代：300→248→220→192→回退 220；104→88→84）
const PILL_W_RPX = 220;
const PILL_H_RPX = 84;
const MARGIN_RPX = 24;

Component({
  data: {
    selected: 0,
    // 'theme-light' | 'theme-dark'，由 tab 页 onShow 注入；此处仅作启动兜底
    theme: (theme.get() === theme.DARK ? 'theme-dark' : 'theme-light'),
    // 全局训练计时悬浮药丸
    showWo: false,
    woClock: '00:00',
    woRunning: false,
    // 药丸位置：JS 拼的完整内联 style（left/top px，单 mustache 合规）
    woStyle: '',
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: 'home' },
      { pagePath: '/pages/training/training', text: '训练', icon: 'train' },
      { pagePath: '/pages/plan/plan', text: '计划', icon: 'plan' },
      { pagePath: '/pages/list/list', text: '数据', icon: 'trendingup' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: 'user' }
    ]
  },
  lifetimes: {
    attached() {
      try {
        // 计算药丸初始位置（右下角，浮于底栏之上）。rpx→px：px = rpx * windowWidth / 750
        const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const W = info.windowWidth || 375;
        const H = info.windowHeight || 667;
        const toPx = (r) => r * W / 750;
        const safeBottom = (info.safeAreaInsets && info.safeAreaInsets.bottom) || 0;
        const tabH = toPx(110) + safeBottom;
        this._winW = W;
        this._winH = H;
        this._pillW = toPx(PILL_W_RPX);
        this._pillH = toPx(PILL_H_RPX);
        this._margin = toPx(MARGIN_RPX);
        this._woX = W - this._pillW - this._margin;
        this._woY = H - this._pillH - tabH - toPx(20);
        this.setData({ woStyle: this.woStyle(this._woX, this._woY) });

        this._unsub = workoutSession.subscribe(() => this.refreshWo());
        this.refreshWo();
        // 药丸显示且计时进行中时，按真实时间每秒刷新 woClock（训练页已卸载也能继续走表）
        this._woTick = setInterval(() => {
          if (this.data.showWo && this.data.woRunning) {
            const sec = workoutSession.getElapsed();
            this.setData({ woClock: pad(Math.floor(sec / 60)) + ':' + pad(sec % 60) });
          }
        }, 1000);
        // 关键：订阅全局路由变化。最小化后 wx.navigateBack() 完成时路由已切走，
        // 但此时不会触发 session 变化回调，showWo 仍为 false；靠 onAppRoute 重新计算才能显示药丸。
        // 同时进入训练页（navigateTo）时也借此隐藏药丸。
        this._routeHandler = (e) => {
          const p = e && e.path ? (e.path.charAt(0) === '/' ? e.path : '/' + e.path) : null;
          this.refreshWo(p);
        };
        if (typeof wx.onAppRoute === 'function') wx.onAppRoute(this._routeHandler);
      } catch (e) {
        // 订阅/刷新异常不应拖垮所有 tab 页渲染
        console.error('[custom-tab-bar] attached error:', e);
      }
    },
    detached() {
      if (this._unsub) this._unsub();
      if (this._woTick) { clearInterval(this._woTick); this._woTick = null; }
      if (this._routeHandler && typeof wx.offAppRoute === 'function') wx.offAppRoute(this._routeHandler);
    }
  },
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index;
      const path = this.data.list[idx].pagePath;
      wx.switchTab({ url: path });
    },
    // 刷新悬浮计时窗：存在未完成训练会话、且当前为 tab 页（非训练中页）时显示
    // route 可选：由 onAppRoute 回调直接传入新路由（最稳妥）；不传则回退到 getCurrentPages()
    refreshWo(route) {
      const sess = workoutSession.load();
      if (!route) {
        const pages = getCurrentPages() || [];
        const cur = pages.length ? pages[pages.length - 1] : null;
        route = cur ? ('/' + cur.route) : '';
      }
      const isTab = this.data.list.some(l => l.pagePath === route);
      const show = !!sess && isTab && route !== '/pages/workout/workout';
      const sec = workoutSession.getElapsed();
      this.setData({
        showWo: show,
        woClock: pad(Math.floor(sec / 60)) + ':' + pad(sec % 60),
        woRunning: !!(sess && sess.running)
      });
    },

    // —— 药丸 fixed + 自管 touch 拖拽（不用 movable-view） ——
    woStyle(x, y) {
      return 'left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px';
    },
    clampWo(x, y) {
      const maxX = Math.max(this._margin, this._winW - this._pillW - this._margin);
      const maxY = Math.max(this._margin, this._winH - this._pillH - this._margin);
      return {
        x: Math.max(this._margin, Math.min(maxX, x)),
        y: Math.max(this._margin, Math.min(maxY, y))
      };
    },
    applyWo(x, y) {
      this._woX = x; this._woY = y;
      this.setData({ woStyle: this.woStyle(x, y) });
    },
    onWoTouchStart(e) {
      const t = e.touches[0];
      this._drag = { sx: t.clientX, sy: t.clientY, ox: this._woX, oy: this._woY, moved: false, last: { x: this._woX, y: this._woY } };
    },
    onWoTouchMove(e) {
      const d = this._drag;
      if (!d) return;
      const t = e.touches[0];
      if (!d.moved && (Math.abs(t.clientX - d.sx) > 4 || Math.abs(t.clientY - d.sy) > 4)) d.moved = true;
      const p = this.clampWo(d.ox + (t.clientX - d.sx), d.oy + (t.clientY - d.sy));
      d.last = p;
      this.applyWo(p.x, p.y);
    },
    // 松手贴左/右边缘（保持当前高度）；发生过位移则抑制紧随的 tap（避免误打开训练页）
    onWoTouchEnd() {
      const d = this._drag;
      this._drag = null;
      if (!d) return;
      if (d.moved) this._suppressTap = true;
      const p = d.last || { x: this._woX, y: this._woY };
      const x = (p.x + this._pillW / 2 < this._winW / 2) ? this._margin : (this._winW - this._pillW - this._margin);
      const s = this.clampWo(x, p.y);
      this.applyWo(s.x, s.y);
    },
    // 点击药丸：训练中页已在栈中则返回，否则重新进入（自动恢复进度）。
    // 若刚结束拖拽（_suppressTap），本次点击仅作取消，不打开。
    openWorkout() {
      if (this._suppressTap) { this._suppressTap = false; return; }
      const pages = getCurrentPages() || [];
      const inStack = pages.some(p => p.route === 'pages/workout/workout');
      if (inStack) wx.navigateBack();
      else wx.navigateTo({ url: '/pages/workout/workout' });
    }
  }
});
