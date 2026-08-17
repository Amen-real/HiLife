// utils/foodvision.js
// 拍照/选图 → 视觉识别 → 结构化营养结果
//
// 两种调用模式（由 globalData.useCallContainer 切换）：
//   1) 云托管 callContainer 模式（上线默认）：压缩图片→base64→JSON，
//      wx.cloud.callContainer 调用，免备案、免服务器域名。
//      受云托管 100K 请求体限制，前端会把图压到 ~480px / quality 20。
//   2) uploadFile 模式（开发/自有服务器）：wx.uploadFile 传原图到 visionBackendUrl。

function getCfg() {
  const app = getApp();
  const g = (app && app.globalData) || {};
  return {
    useCC: !!g.useCallContainer,
    env: g.cloudEnv || '',
    service: g.visionService || 'hilife-vision',
    url: (g.visionBackendUrl && g.visionBackendUrl.trim()) || 'http://192.168.1.100:8000'
  };
}

// 把临时图片压缩到 100K 以内并读成 base64（云托管 callContainer 限制）
function compressToBase64(tempFilePath) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: tempFilePath,
      quality: 20,
      compressedWidth: 480,
      success: (r) => {
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: r.tempFilePath,
          encoding: 'base64',
          success: (res) => resolve('data:image/jpeg;base64,' + res.data),
          fail: reject
        });
      },
      fail: reject
    });
  });
}

function analyzeByCallContainer(tempFilePath, cfg) {
  return compressToBase64(tempFilePath).then((b64) => new Promise((resolve, reject) => {
    if (typeof wx.cloud === 'undefined' || !wx.cloud.callContainer) {
      reject(new Error('wx.cloud.callContainer 不可用，请确认已 wx.cloud.init 且基础库 >= 2.13.1'));
      return;
    }
    wx.cloud.callContainer({
      config: { env: cfg.env },
      path: '/analyze',
      method: 'POST',
      header: { 'X-WX-SERVICE': cfg.service, 'content-type': 'application/json' },
      data: { image: b64 },
      success: (res) => {
        try {
          const d = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          resolve(d);
        } catch (e) {
          reject(new Error('返回数据解析失败'));
        }
      },
      fail: reject
    });
  }));
}

function analyzeByUpload(tempFilePath, cfg) {
  return new Promise((resolve, reject) => {
    const base = cfg.url.replace(/\/+$/, '');
    wx.uploadFile({
      url: base + '/analyze',
      filePath: tempFilePath,
      name: 'image', // 与服务端 multipart 字段名一致
      formData: {},
      success: (res) => {
        try {
          const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          resolve(data);
        } catch (e) {
          reject(new Error('返回数据解析失败'));
        }
      },
      fail: reject
    });
  });
}

// tempFilePath: wx.chooseMedia 返回的临时文件路径
// 返回 Promise<{ foods:[...], total:{...}, note, mock, provider }>
function analyzeImage(tempFilePath) {
  const cfg = getCfg();
  if (cfg.useCC) return analyzeByCallContainer(tempFilePath, cfg);
  return analyzeByUpload(tempFilePath, cfg);
}

module.exports = { analyzeImage, getCfg };
