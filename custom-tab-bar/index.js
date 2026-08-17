// custom-tab-bar/index.js
const workoutSession = require('../utils/workoutSession.js');
const ICONS = require('../components/icon/icons-data.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

Component({
  data: {
    selected: 0,
    // 全局训练计时悬浮窗
    showWo: false,
    woClock: '00:00',
    woRunning: false,
    // 悬浮窗可拖拽位置（movable-view 坐标，单位 px，相对于全屏 movable-area）
    woX: 0,
    woY: 0,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: 'home', iconSrc: ICONS['home'] || '' },
      { pagePath: '/pages/training/training', text: '训练', icon: 'train', iconSrc: ICONS['train'] || '' },
      { pagePath: '/pages/list/list', text: '记录', icon: 'scale', iconSrc: ICONS['scale'] || '' },
      { pagePath: '/pages/advice/advice', text: '饮食', icon: 'diet', iconSrc: ICONS['diet'] || '' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: 'user', iconSrc: ICONS['user'] || '' }
    ]
  },
  lifetimes: {
    attached() {
      try {
        // 计算悬浮窗初始位置（右下角，浮于底栏之上）。rpx→px：px = rpx * windowWidth / 750
        const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const W = info.windowWidth || 375;
        const H = info.windowHeight || 667;
        const toPx = (r) => r * W / 750;
        const pill = toPx(136);
        const margin = toPx(32);
        const safeBottom = (info.safeAreaInsets && info.safeAreaInsets.bottom) || 0;
        const tabH = toPx(110) + safeBottom;
        this._winW = W;
        this._pillPx = pill;
        this._woX = W - pill - margin;
        this._woY = H - pill - tabH - toPx(20);
        this._woStartX = this._woX;
        this._woStartY = this._woY;

        this._unsub = workoutSession.subscribe(() => this.refreshWo());
        this.refreshWo();
        // 悬浮窗显示且计时进行中时，按真实时间每秒刷新 woClock（训练页已卸载也能继续走表）
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
    // 悬浮窗拖拽：开始记录起点
    onWoFloatStart() {
      this._startX = this._woX != null ? this._woX : 0;
      this._startY = this._woY != null ? this._woY : 0;
      this._moved = false;
    },
    // 拖拽中：同步坐标（避免 1s 计时 setData 把药丸重置回初始位），并标记是否产生位移
    onWoFloatChange(e) {
      const d = e.detail;
      if (d && typeof d.x === 'number') {
        this._woX = d.x;
        this._woY = d.y;
        this.setData({ woX: d.x, woY: d.y });
        if (this._startX != null && (Math.abs(d.x - this._startX) > 8 || Math.abs(d.y - this._startY) > 8)) {
          this._moved = true;
        }
      }
    },
    // 拖拽结束：松手自动贴左/右边缘（保持当前高度），若发生过位移则抑制紧随的 tap（避免误打开训练页）
    onWoFloatEnd() {
      const W = this._winW || 375;
      const pill = this._pillPx || (136 * W / 750);
      const margin = 32 * W / 750;
      const x = this._woX != null ? this._woX : 0;
      const targetX = (x + pill / 2 < W / 2) ? margin : (W - pill - margin);
      this.setData({ woX: targetX });
      if (this._moved) this._suppressTap = true;
    },
    // 点击悬浮窗：训练中页已在栈中则返回，否则重新进入（自动恢复进度）。
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
