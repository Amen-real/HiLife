// utils/mock.js
// 原型用 mock 数据：动作库 + 饮食推荐
const exercises = require('./exercises.js');
const { media } = require('./media.js');

// 分类 -> emoji 占位图
const categoryEmoji = {
  '胸部': '💪',
  '背部': '🔙',
  '肩膀': '🤷',
  '腿部': '🦵',
  '手臂': '💪',
  '核心': '🔥',
  '我的动作': '⭐'
};

// 为「我的动作」匹配本地数据集条目：按 部位 + 器械 取同池，用动作 id 数字做稳定索引，
// 借用语料的 缩略图(image)、中文步骤(steps)、演示视频(video)，保证每次渲染一致。
function matchDataset(act) {
  const pool = exercises.library[act.category] || [];
  if (!pool.length) return null;
  const sameEquip = pool.filter(e => e.equip === act.equip);
  const src = sameEquip.length ? sameEquip : pool;
  const n = parseInt(String(act.id).replace(/\D/g, ''), 10) || 0;
  return src[n % src.length] || src[0];
}

// 动作库（按分类）
const actionLibrary = {
  '胸部': [
    { id: 'c1', name: '杠铃平板卧推', equip: '杠铃', desc: '仰卧推举杠铃，主要刺激胸大肌中部，是胸肌训练的核心复合动作。' },
    { id: 'c2', name: '平板哑铃卧推', equip: '哑铃', desc: '哑铃活动范围更大，能更好地拉伸胸肌并改善两侧平衡。' },
    { id: 'c3', name: '杠铃上斜卧推', equip: '杠铃', desc: '上斜角度重点刺激胸大肌上束与三角肌前束。' },
    { id: 'c4', name: '上斜哑铃卧推', equip: '哑铃', desc: '上斜哑铃推举，对上胸厚度与线条塑造很有帮助。' },
    { id: 'c5', name: '史密斯卧推', equip: '器械', desc: '轨迹固定，适合新手找胸感、冲大重量。' },
    { id: 'c6', name: '器械推胸', equip: '器械', desc: '坐姿器械推胸，安全稳定，适合收尾泵感训练。' },
    { id: 'c7', name: '绳索夹胸', equip: '绳索', desc: '龙门架绳索夹胸，孤立刺激胸肌中缝。' },
    { id: 'c8', name: '蝴蝶机夹胸', equip: '器械', desc: '器械夹胸，固定轨迹，专注胸肌内侧收缩。' },
    { id: 'c9', name: '双杠臂屈伸', equip: '自重', desc: '身体前倾可更侧重胸肌下缘发展。' },
    { id: 'c10', name: '俯卧撑', equip: '自重', desc: '最基础的胸臂自重训练，随时可做。' }
  ],
  '背部': [
    { id: 'b1', name: '引体向上', equip: '自重', desc: '背部宽度之王，重点刺激背阔肌。' },
    { id: 'b2', name: '杠铃划船', equip: '杠铃', desc: '经典背部厚度动作，兼顾后链整体。' },
    { id: 'b3', name: '坐姿划船', equip: '器械', desc: '稳定躯干，集中刺激中背与菱形肌。' },
    { id: 'b4', name: '高位下拉', equip: '器械', desc: '引体向上的替代动作，适合建立背部宽度。' },
    { id: 'b5', name: '哑铃单臂划船', equip: '哑铃', desc: '单侧训练，改善左右肌力不平衡。' },
    { id: 'b6', name: '直臂下压', equip: '绳索', desc: '孤立背阔肌下缘，塑造倒三角。' },
    { id: 'b7', name: '俯身哑铃飞鸟', equip: '哑铃', desc: '刺激后束与上背，改善圆肩。' },
    { id: 'b8', name: '山羊挺身', equip: '器械', desc: '强化下背与竖脊肌，保护脊柱。' }
  ],
  '肩膀': [
    { id: 's1', name: '站姿杠铃推举', equip: '杠铃', desc: '实力推，全面打造肩部立体感与核心稳定。' },
    { id: 's2', name: '哑铃侧平举', equip: '哑铃', desc: '中束王牌动作，决定肩膀宽度。' },
    { id: 's3', name: '哑铃前平举', equip: '哑铃', desc: '刺激前束，提升肩部正面饱满度。' },
    { id: 's4', name: '俯身反向飞鸟', equip: '哑铃', desc: '强化后束，改善体态与肩袖健康。' },
    { id: 's5', name: '阿诺德推举', equip: '哑铃', desc: '旋转推举，前中束全程参与。' },
    { id: 's6', name: '绳索面拉', equip: '绳索', desc: '后束与斜方肌中下束，改善圆肩。' }
  ],
  '腿部': [
    { id: 'l1', name: '杠铃深蹲', equip: '杠铃', desc: '下肢训练之王，全面刺激股四与臀大肌。' },
    { id: 'l2', name: '腿举', equip: '器械', desc: '大重量安全刺激股四头肌。' },
    { id: 'l3', name: '罗马尼亚硬拉', equip: '杠铃', desc: '重点刺激腘绳肌与臀大肌。' },
    { id: 'l4', name: '保加利亚分腿蹲', equip: '哑铃', desc: '单侧蹲，改善腿臀不平衡。' },
    { id: 'l5', name: '腿屈伸', equip: '器械', desc: '孤立股四头肌，泵感强烈。' },
    { id: 'l6', name: '坐姿腿弯举', equip: '器械', desc: '孤立腘绳肌，平衡前后侧。' },
    { id: 'l7', name: '站姿提踵', equip: '器械', desc: '雕刻小腿线条。' },
    { id: 'l8', name: '箭步蹲', equip: '自重', desc: '综合下肢与核心稳定。' }
  ],
  '手臂': [
    { id: 'a1', name: '杠铃弯举', equip: '杠铃', desc: '二头经典，可上大重量。' },
    { id: 'a2', name: '哑铃锤式弯举', equip: '哑铃', desc: '刺激肱肌，让手臂更粗壮。' },
    { id: 'a3', name: '绳索下压', equip: '绳索', desc: '三头外侧头，泵感明显。' },
    { id: 'a4', name: '窄距卧推', equip: '杠铃', desc: '复合动作刺激三头整体。' },
    { id: 'a5', name: '集中弯举', equip: '哑铃', desc: '顶峰收缩，塑造二头峰值。' },
    { id: 'a6', name: '过顶臂屈伸', equip: '哑铃', desc: '长头拉伸，三头更立体。' }
  ],
  '核心': [
    { id: 'k1', name: '平板支撑', equip: '自重', desc: '核心抗伸展基础，提升躯干稳定。' },
    { id: 'k2', name: '卷腹', equip: '自重', desc: '腹直肌基础动作。' },
    { id: 'k3', name: '俄罗斯转体', equip: '自重', desc: '刺激腹斜肌，塑造侧腹线条。' },
    { id: 'k4', name: '悬垂举腿', equip: '自重', desc: '下腹王牌，强化髂腰肌与腹直肌下缘。' },
    { id: 'k5', name: '死虫', equip: '自重', desc: '安全的核心抗伸展训练。' },
    { id: 'k6', name: '登山跑', equip: '自重', desc: '动态核心，兼顾心肺。' },
    { id: 'k7', name: '侧平板支撑', equip: '自重', desc: '强化腹斜肌与侧向稳定。' }
  ]
};

// 饮食推荐（按餐别）
// 每条补上 image 字段，指向 images/food/ 下本地生成的食物图；
// 相似菜品共用一张（如燕麦类共用 food_oatmeal_egg），无图时回退 emoji。
const dietRecommend = {
  '早餐': [
    { id: 'm1', name: '燕麦 + 鸡蛋', calories: 260, protein: 18, carb: 30, fat: 8, emoji: '🥣', image: '/images/food/food_oatmeal_egg.jpg', desc: '慢碳提供持久能量，鸡蛋补充优质蛋白。' },
    { id: 'm2', name: '无糖酸奶 + 蓝莓', calories: 190, protein: 12, carb: 24, fat: 5, emoji: '🫐', image: '/images/food/food_yogurt_berry.jpg', desc: '益生菌助消化，抗氧化物丰富。' },
    { id: 'm3', name: '全麦吐司 + 生菜蛋', calories: 260, protein: 15, carb: 32, fat: 8, emoji: '🍞', image: '/images/food/food_toast_egg.jpg', desc: '全麦膳食纤维饱腹，搭配蔬果更均衡。' },
    { id: 'm4', name: '鸡胸肉沙拉杯', calories: 320, protein: 30, carb: 18, fat: 10, emoji: '🥗', image: '/images/food/food_chicken_salad.jpg', desc: '高蛋白低脂，适合减脂期。' },
    { id: 'm5', name: '鸡蛋白 + 小番茄', calories: 150, protein: 14, carb: 8, fat: 4, emoji: '🍅', image: '/images/food/food_egg_tomato.jpg', desc: '纯蛋白补给，热量极低。' },
    { id: 'm6', name: '玉米 + 无糖豆浆', calories: 240, protein: 13, carb: 38, fat: 4, emoji: '🌽', image: '/images/food/food_corn_soy.jpg', desc: '优质植物蛋白与粗粮组合。' },
    { id: 'm7', name: '红薯 + 水煮蛋', calories: 260, protein: 14, carb: 36, fat: 6, emoji: '🍠', image: '/images/food/food_sweetpotato.jpg', desc: '低 GI 碳水，稳定血糖。' },
    { id: 'm8', name: '牛奶燕麦杯', calories: 260, protein: 16, carb: 30, fat: 8, emoji: '🥛', image: '/images/food/food_oatmeal_egg.jpg', desc: '钙与蛋白双补，方便携带。' },
    { id: 'm9', name: '苹果 + 原味酸奶', calories: 190, protein: 10, carb: 28, fat: 4, emoji: '🍎', image: '/images/food/food_yogurt_berry.jpg', desc: '轻负担早餐，富含果胶。' },
    { id: 'm10', name: '鸡肉生菜卷', calories: 320, protein: 28, carb: 20, fat: 12, emoji: '🌯', image: '/images/food/food_chicken_salad.jpg', desc: '用生菜替代面饼，碳水更低。' }
  ],
  '午餐': [
    { id: 'd1', name: '糙米饭 + 煎鸡胸 + 西兰花', calories: 480, protein: 42, carb: 45, fat: 12, emoji: '🍗', image: '/images/food/food_rice_chicken.jpg', desc: '标准减脂餐，蛋白足、碳水稳。' },
    { id: 'd2', name: '荞麦面 + 牛肉片 + 菠菜', calories: 520, protein: 38, carb: 55, fat: 14, emoji: '🍜', image: '/images/food/food_noodle_beef.jpg', desc: '荞麦低 GI，补铁又饱腹。' },
    { id: 'd3', name: '紫薯 + 清蒸鱼 + 芦笋', calories: 430, protein: 40, carb: 40, fat: 10, emoji: '🐟', image: '/images/food/food_fish_veg.jpg', desc: '优质脂肪酸与蛋白来源。' }
  ],
  '晚餐': [
    { id: 'e1', name: '鸡胸豆腐汤 + 凉拌黄瓜', calories: 300, protein: 32, carb: 14, fat: 10, emoji: '🥒', image: '/images/food/food_tofu_soup.jpg', desc: '清淡低卡，减轻夜间负担。' },
    { id: 'e2', name: '虾仁炒蛋 + 半根玉米', calories: 360, protein: 34, carb: 22, fat: 14, emoji: '🍤', image: '/images/food/food_shrimp_egg.jpg', desc: '高蛋白低脂，恢复肌肉。' },
    { id: 'e3', name: '牛肉沙拉 + 油醋汁', calories: 380, protein: 36, carb: 16, fat: 18, emoji: '🥩', image: '/images/food/food_beef_salad.jpg', desc: '晚间少碳水，保留优质脂肪。' }
  ],
  '加餐': [
    { id: 'n1', name: '原味坚果一小把', calories: 160, protein: 6, carb: 6, fat: 14, emoji: '🥜', image: '/images/food/food_nuts.jpg', desc: '健康脂肪补给，控制分量。' },
    { id: 'n2', name: '香蕉 + 乳清蛋白', calories: 220, protein: 27, carb: 28, fat: 2, emoji: '🍌', image: '/images/food/food_banana_shake.jpg', desc: '训练前后快速补充。' },
    { id: 'n3', name: '无糖豆浆一杯', calories: 90, protein: 9, carb: 6, fat: 4, emoji: '🥛', image: '/images/food/food_corn_soy.jpg', desc: '低卡植物蛋白。' }
  ],
  '蔬果': [
    { id: 'v1', name: '西兰花', calories: 35, protein: 3, carb: 7, fat: 0, emoji: '🥦', image: '/images/food/food_rice_chicken.jpg', desc: '低卡高纤维，减脂必备。' },
    { id: 'v2', name: '小番茄', calories: 18, protein: 1, carb: 4, fat: 0, emoji: '🍅', image: '/images/food/food_egg_tomato.jpg', desc: '富含番茄红素，热量极低。' },
    { id: 'v3', name: '牛油果半个', calories: 120, protein: 1, carb: 6, fat: 11, emoji: '🥑', image: '/images/food/food_avocado.jpg', desc: '优质单不饱和脂肪。' },
    { id: 'v4', name: '蓝莓', calories: 57, protein: 1, carb: 14, fat: 0, emoji: '🫐', image: '/images/food/food_yogurt_berry.jpg', desc: '抗氧化水果，控量食用。' }
  ]
};

// 我的动作（示范）：把各部位中文示例动作展平，作为「我的动作」标签页内容。
// 展平时补上 category，并按 部位+器械 匹配本地数据集条目，借用语料的
// 缩略图(image)、中文步骤(steps)、演示视频(video)，替换原本的 emoji 占位。
const myActions = []
  .concat(...Object.entries(actionLibrary).map(([cat, list]) =>
    list.map(a => {
      const d = matchDataset({ ...a, category: cat });
      return {
        ...a,
        category: cat,
        emoji: categoryEmoji[cat] || '🏋️',
        image: d ? media(d.image) : '',
        steps: d ? d.steps : null,
        video: d ? media(d.video) : ''
      };
    })
  ));

// 食物图同步云端化（PNG 已转 JPG，这里顺手把 .png 后缀换成 .jpg，再拼最终 URL）
Object.keys(dietRecommend).forEach(k => {
  (dietRecommend[k] || []).forEach(m => { m.image = media(m.image.replace(/\.png$/, '.jpg')); });
});

module.exports = {
  categoryEmoji,
  actionLibrary,
  myActions,
  dietRecommend
};
