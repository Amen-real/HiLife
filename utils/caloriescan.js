// utils/caloriescan.js
// 自托管 CalorieScan 后端客户端：拍照 -> 上传 -> 返回热量/重量
//
// 后端服务见 server/ 目录（FastAPI）。开发期在 project.config.json 已 urlCheck:false 可直接联调；
// 生产环境需在小程序后台「服务器域名 -> uploadFile 合法域名」登记后端域名（必须 HTTPS）。

// 后端地址：优先读 globalData.backendUrl（可在启动时/设置页配置），否则用默认值
function backendUrl() {
  try {
    const g = getApp().globalData;
    if (g && g.backendUrl) return String(g.backendUrl).replace(/\/$/, '');
  } catch (e) {}
  return 'http://192.168.1.100:8000'; // TODO: 改成你自托管服务的地址/域名
}

// tempFilePath: wx.chooseMedia 返回的临时图片路径
// 返回: Promise<{ success, name, items, total_weight_g, total_calories, confidence, mock, note }>
function analyzeImage(tempFilePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: backendUrl() + '/analyze',
      filePath: tempFilePath,
      name: 'image',
      success: (res) => {
        try {
          const data = JSON.parse(res.data);
          resolve(data);
        } catch (e) {
          reject(new Error('返回数据解析失败'));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

module.exports = { analyzeImage: analyzeImage, backendUrl: backendUrl };
