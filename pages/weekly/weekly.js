// pages/weekly/weekly.js —— 周报页（T2）：聚合/对比/PR 全部走 utils/weeklyReport.js 单源
// 入口：「我的」页「我的训练」卡头「本周周报 ›」（顶替原「查看全部」——记录浏览本就有 tab 级入口）。
// 场次行点击 → 记录 tab 复盘并深链到该天（list 页 focusDate 既有通道）。
const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');
const dateRange = require('../../utils/dateRange.js');
const stats = require('../../utils/trainingStats.js');
const wr = require('../../utils/weeklyReport.js');
const shareCard = require('../../utils/shareCard.js');

Page({
  data: {
    theme: 'theme-light',
    off: 0,            // 0=本周，-1=上周……
    r: null,           // weeklyReport 输出（含 label/verdict/comment/对比/PR）
    rows: [],          // 本周场次视图模型（倒序展示）
    canNext: false,    // 已在「本周」时不可再往后翻
    // 分享卡弹层（出图流程与 training-review 组件同一套，仅去掉「合并/隐藏」选项）
    shareShow: false,
    shareBusy: false,
    shareImg: '',
    shareStyle: 'light',
    shareStyleName: '浅色',
    canvasH: 900      // 画布显示高（rpx）= 卡片高，随内容自适应（750 宽 = 750rpx 同比）
  },

  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    wx.setNavigationBarColor({
      frontColor: themeCls === 'theme-dark' ? '#ffffff' : '#000000',
      backgroundColor: themeCls === 'theme-dark' ? '#0A0A0A' : '#F7F7F5'
    });
    this.rebuild();
  },

  rebuild() {
    const g = store.get();
    const off = this.data.off || 0;
    const r = wr.weeklyReport(g.trainingLogs || [], g.profile || {}, store.getActivePlan(), off);
    // 本周场次行（日志已是倒序；范围过滤即可）
    const rows = (g.trainingLogs || [])
      .filter(l => l && dateRange.inRange(l.date, r.monStr, r.sunStr))
      .map(l => ({
        date: l.date,
        dateTxt: dateRange.fmtDateSlash(l.date),
        acts: (l.actions || []).length,
        durTxt: wr.fmtDuration(stats.durationSecOfLog(l)),
        volTxt: stats.fmtVol(stats.loadOfLog(l)),
        isToday: l.date === dateRange.todayStr()
      }));
    this.setData({ r: r, rows: rows, canNext: off < 0 });
  },

  prevWeek() {
    this.setData({ off: (this.data.off || 0) - 1 }, () => this.rebuild());
  },
  nextWeek() {
    if ((this.data.off || 0) < 0) {
      this.setData({ off: this.data.off + 1 }, () => this.rebuild());
    }
  },

  // 场次行 → 记录 tab 的复盘视图，并定位到该天。
  // 复用「我的」页既有约定：pendingListTab 切 tab 内视图；pendingListDate 由 list.onShow
  // 消费成 selectedDate → training-review focus-date 直接落到该场。
  goReview(e) {
    const d = e.currentTarget.dataset.date;
    if (!d) return;
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.pendingListTab = 'review';
      app.globalData.pendingListDate = d;
    }
    wx.switchTab({ url: '/pages/list/list' });
  },

  /* ================= 周报分享卡（T3） =================
     禁重算口径：模型 = weeklyReport 输出原样 + style 键，这里不做任何指标计算。
     出图流程与 training-review 组件逐行同构（750 宽固定 backing store、不乘 dpr、
     码图异步加载失败照出卡），仅去掉「合并/隐藏内容」两个场次卡专属开关。 */
  genShare() {
    if (!this.data.r) return;
    this._rwModel = Object.assign({}, this.data.r, { style: this.data.shareStyle });
    this.setData({
      shareShow: true, shareBusy: true, shareImg: '',
      canvasH: Math.round(shareCard.measureWeekly(this._rwModel))
    }, () => this._renderWeekly());
  },

  _renderWeekly() {
    const q = wx.createSelectorQuery();
    q.select('#weeklyShareCanvas').fields({ node: true, size: true }).exec(res => {
      const canvas = res && res[0] && res[0].node;
      if (!canvas) { this._cardFail('画布初始化失败，请重试'); return; }
      let ctx;
      try {
        ctx = canvas.getContext('2d');
        canvas.width = shareCard.CARD_W;
        canvas.height = shareCard.measureWeekly(this._rwModel);
      } catch (e) {
        this._cardFail('生成周报卡失败，请重试');
        return;
      }
      shareCard.loadMinicode(canvas).then(img => {
        try {
          shareCard.drawWeekly(ctx, this._rwModel, img);
        } catch (e) {
          this._cardFail('生成周报卡失败，请重试');
          return;
        }
        wx.canvasToTempFilePath({
          canvas,
          success: r2 => this.setData({ shareBusy: false, shareImg: r2.tempFilePath }),
          fail: () => this._cardFail('导出图片失败，请重试')
        });
      });
    });
  },

  _cardFail(msg) {
    this.setData({ shareShow: false, shareBusy: false, shareImg: '' });
    wx.showToast({ title: msg, icon: 'none' });
  },

  closeShare() { this.setData({ shareShow: false, shareBusy: false, shareImg: '' }); },

  // 样式键唯一真源 = shareCard.STYLE_KEYS（不写死「浅色↔深色」）
  cycleShareStyle() {
    const keys = shareCard.STYLE_KEYS;
    const i = keys.indexOf(this.data.shareStyle);
    const next = keys[(i + 1) % keys.length];
    this._rwModel = Object.assign({}, this.data.r, { style: next });
    this.setData({
      shareStyle: next, shareStyleName: shareCard.PALETTES[next].name, shareImg: '',
      canvasH: Math.round(shareCard.measureWeekly(this._rwModel))
    }, () => this._renderWeekly());
  },

  shareShareCard() {
    const path = this.data.shareImg;
    if (!path) { wx.showToast({ title: '分享卡还没生成好', icon: 'none' }); return; }
    if (typeof wx.showShareImageMenu !== 'function') {
      wx.showModal({
        title: '当前微信版本不支持直接分享图片',
        content: '可以先把卡片保存到相册，再在聊天里手动发给好友。',
        confirmText: '保存到相册', cancelText: '取消',
        success: r => { if (r.confirm) this.saveShareCard(); }
      });
      return;
    }
    wx.showShareImageMenu({
      path,
      needShowEntrance: true,
      fail: e => {
        if (/cancel/i.test(String((e && e.errMsg) || ''))) return;
        wx.showToast({ title: '分享未完成，可试试保存到相册', icon: 'none' });
      }
    });
  },

  saveShareCard() {
    const path = this.data.shareImg;
    if (!path) { wx.showToast({ title: '分享卡还没生成好', icon: 'none' }); return; }
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: e => {
        const msg = String((e && e.errMsg) || '');
        if (/cancel/i.test(msg)) return;
        if (/auth|deny|permission/i.test(msg)) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存图片需要「保存到相册」权限，去设置里打开即可。',
            confirmText: '去设置',
            success: r => { if (r.confirm) wx.openSetting({}); }
          });
          return;
        }
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    });
  },

  noop() {}
});
