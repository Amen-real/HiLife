// gen_names.cjs — 临时脚本：为 exercises.js 的每个动作生成中文名(nameZh)与本地演示视频(video)
// 中文名采用「组合式术语表」(器械/动作/部位/修饰) 由 LLM 编写，脚本自动组合，保证一致性与质量。
const fs = require('fs');
const path = require('path');

const ex = require('./utils/exercises.js');
const lib = ex.library;

// ---------- 视频映射：videos/<id>-<hash>.mp4 -> /videos/<file> ----------
const videoDir = path.join(__dirname, 'videos');
const videoMap = {};
if (fs.existsSync(videoDir)) {
  for (const f of fs.readdirSync(videoDir)) {
    if (!f.toLowerCase().endsWith('.mp4')) continue;
    const id = f.split('-')[0];
    if (id) videoMap[id] = '/videos/' + f;
  }
}

// ---------- 术语表 ----------
const EQUIP = {
  'barbell': '杠铃', 'dumbbell': '哑铃', 'kettlebell': '壶铃', 'cable': '绳索',
  'machine': '器械', 'smith machine': '史密斯', 'smith': '史密斯',
  'bodyweight': '自重', 'body weight': '自重', 'body-weight': '自重', 'weighted': '负重',
  'medicine ball': '药球', 'stability ball': '健身球', 'swiss ball': '瑞士球',
  'exercise ball': '健身球', 'physio ball': '健身球', 'fitness ball': '健身球',
  'foam roller': '泡沫轴', 'resistance band': '弹力带', 'band': '弹力带',
  'mini band': '迷你弹力带', 'e-z bar': 'EZ杆', 'ez bar': 'EZ杆', 'ez-bar': 'EZ杆',
  'sledge hammer': '大锤', 'hammer': '锤', 'tire': '轮胎', 'bench': '凳',
  'box': '跳箱', 'wall': '墙', 'parallel bars': '双杠', 'rings': '吊环',
  'bosu': '博苏球', 'bosu ball': '博苏球', 'sandbag': '沙袋', 'battle rope': '战绳',
  'suspension trainer': '悬挂带', 'trx': '悬挂带', 'sled': '雪橇', 'landmine': '地雷管',
  'plate': '杠铃片', 'ball': '球', 'chair': '椅', 'step': '台阶', 'roller': '滚轮',
  'mat': '垫', 'pully': '滑轮', 'leverage machine': '器械', 'lever': '器械'
};

const BODY = {
  'chest': '胸', 'back': '背', 'shoulder': '肩', 'shoulders': '肩', 'leg': '腿',
  'legs': '腿', 'arm': '臂', 'arms': '臂', 'core': '核心', 'abs': '腹',
  'abdominal': '腹', 'glute': '臀', 'glutes': '臀', 'hip': '髋', 'hips': '髋',
  'calf': '小腿', 'calves': '小腿', 'quad': '股四头', 'quads': '股四头',
  'hamstring': '腘绳', 'hamstrings': '腘绳', 'bicep': '二头', 'biceps': '二头',
  'tricep': '三头', 'triceps': '三头', 'deltoid': '三角肌', 'delts': '三角肌',
  'lats': '背阔', 'lat': '背阔', 'pec': '胸', 'pecs': '胸', 'serratus': '锯肌',
  'trap': '斜方', 'traps': '斜方', 'neck': '颈', 'obliques': '腹斜',
  'forearm': '前臂', 'wrist': '腕',   'toe': '脚趾', 'foot': '脚', 'heel': '脚跟',
  'pectoralis major': '胸大肌', 'pectoralis': '胸', 'gluteus': '臀肌',
  'gluteusmaximus': '臀大肌', 'piriformis': '梨状肌', 'trapezius': '斜方肌',
  'teres': '圆肌', 'infraspinatus': '冈下肌', 'supraspinatus': '冈上肌',
  'rhomboids': '菱形肌', 'erector': '竖脊肌', 'spinal': '脊柱', 'lumbar': '腰椎',
  'thoracic': '胸椎', 'scapula': '肩胛', 'scapular': '肩胛', 'delt': '三角肌',
  'levator': '上提肌', 'latissimus': '背阔肌', 'quadriceps': '股四头肌',
  'hamstrings': '腘绳肌', 'adductors': '内收肌', 'abductors': '外展肌',
  'gastrocnemius': '腓肠肌', 'soleus': '比目鱼肌', 'tensor': '张肌',
  'fascia': '筋膜', 'tendon': '肌腱', 'ligament': '韧带'
};

const MOVE = {
  'bench press': '卧推', 'push up': '俯卧撑', 'push-up': '俯卧撑',
  'pull up': '引体向上', 'pull-up': '引体向上', 'chin up': '反握引体',
  'chin-up': '反握引体', 'pulldown': '下拉', 'pull down': '下拉',
  'lat pulldown': '高位下拉', 'row': '划船', 'squat': '深蹲', 'lunge': '箭步蹲',
  'deadlift': '硬拉', 'curl': '弯举', 'extension': '臂屈伸', 'press': '推举',
  'fly': '飞鸟', 'flye': '飞鸟', 'raise': '平举', 'crunch': '卷腹',
  'sit up': '仰卧起坐', 'sit-up': '仰卧起坐', 'plank': '平板支撑', 'dip': '臂屈伸',
  'leg raise': '举腿', 'leg-raise': '举腿', 'hip thrust': '髋推', 'bridge': '桥',
  'twist': '转体', 'shrug': '耸肩', 'kickback': '后踢', 'pullover': '颈后臂屈伸',
  'face pull': '面拉', 'side bend': '侧屈', 'slam': '砸球', 'roll': '滚动',
  'rollout': '滚轮', 'climb': '攀爬', 'march': '踏步', 'jump': '跳',
  'sprint': '冲刺', 'jog': '慢跑', 'kick': '踢', 'swing': '摆动', 'snatch': '抓举',
  'clean': '翻站', 'jerk': '上挺', 'thruster': '推举', 'good morning': '早安式',
  'hyperextension': '超伸', 'reverse hyper': '反向超伸', 'leg press': '腿举',
  'calf raise': '提踵', 'toe raise': '提踵', 'wrist curl': '腕弯举', 'stretch': '拉伸',
  'rotation': '旋转', 'neck stretch': '颈部拉伸', 'side stretch': '侧拉伸',
  'hip raise': '髋部上抬', 'glute bridge': '臀桥', 'hip bridge': '臀桥',
  'leg curl': '腿弯举', 'leg extension': '腿屈伸', 'pushdown': '下压',
  'push down': '下压', 'upright row': '直立划船', 'lateral raise': '侧平举',
  'front raise': '前平举', 'rear delt fly': '后束飞鸟', 'reverse fly': '反向飞鸟',
  'chest press': '推胸', 'shoulder press': '肩上推举', 'overhead press': '过顶推举',
  'military press': '军事推举', 'arnold press': '阿诺德推举', 'push press': '借力推举',
  'split squat': '分腿蹲', 'bulgarian split squat': '保加利亚分腿蹲',
  'goblet squat': '高脚杯深蹲', 'front squat': '前蹲', 'back squat': '后蹲',
  'sumo squat': '相扑深蹲', 'pistol squat': '单腿深蹲', 'box squat': '箱式深蹲',
  'wall sit': '靠墙静蹲', 'russian twist': '俄罗斯转体', 'v-up': 'V字起身',
  'bicycle crunch': '自行车卷腹', 'mountain climber': '登山者', 'burpee': '波比跳',
  'plank jack': '平板开合', 'side plank': '侧平板', 'hollow hold': '空心支撑',
  'dead bug': '死虫', 'bird dog': '鸟狗式', 'pallof press': '帕洛夫推举',
  'farmer carry': '农夫行走', 'suitcase carry': '提箱行走', 'zercher': '泽彻',
  'hack squat': '哈克深蹲', 'leg lift': '抬腿', 'knee raise': '抬膝',
  'hip abduction': '髋外展', 'hip adduction': '髋内收', 'cable crossover': '绳索夹胸',
  'pec deck': '夹胸', 'chest fly': '夹胸', 'seated row': '坐姿划船',
  'bent over row': '俯身划船', 't-bar row': 'T杠划船', 'one arm row': '单臂划船',
  'pull through': '胯下拉伸', 'glute kickback': '臀后踢', 'fire hydrant': '消防栓式',
  'clamshell': '蚌式', 'donkey kick': '驴踢', 'jump squat': '跳深蹲',
  'jump rope': '跳绳', 'high knees': '高抬腿', 'butt kick': '踢臀',
  'side lunge': '侧箭步蹲', 'curtsy lunge': '屈膝箭步蹲', 'reverse lunge': '反向箭步蹲',
  'walking lunge': '行走箭步蹲', 'hip thrusts': '髋推', 'hip thrust': '髋推',
  'glute bridge': '臀桥', 'cable crunch': '绳索卷腹', 'rope climb': '爬绳',
  'muscle up': '双力臂', 'handstand': '倒立', 'toe touch': '触脚尖',
  'windmill': '风车', 'superman': '超人', 'leg circle': '画圈抬腿',
  'scapular': '肩胛', 'retraction': '后缩', 'protraction': '前伸',
  'external rotation': '外旋', 'internal rotation': '内旋', 'abduction': '外展',
  'adduction': '内收', 'flexion': '屈曲', 'extension': '伸展', 'elevation': '上抬',
  'depression': '下沉',
  'concentration curl': '集中弯举', 'preacher curl': '牧师凳弯举',
  'y-raise': 'Y字平举', 'y raise': 'Y字平举', 'shoulder tap': '触肩',
  'shoulder taps': '触肩', 'toe touches': '触脚尖', 'heel toucher': '触脚跟',
  'heel touchers': '触脚跟', 'cross body': '交叉', 'cross-body': '交叉',
  'planche': '平面支撑', 'handstand push-up': '倒立俯卧撑',
  'handstand pushup': '倒立俯卧撑', 'air bike': '空中自行车', 'airbike': '空中自行车',
  'ankle circles': '脚踝画圈', 'ankle circle': '脚踝画圈', 'leg circles': '画圈抬腿',
  'lat pulldown': '高位下拉', 'calf raise': '提踵', 'toe raise': '提踵',
  'hip thrust': '髋推', 'glute bridge': '臀桥', 'cable crunch': '绳索卷腹',
  'rope climb': '爬绳', 'leg lift': '抬腿', 'knee raise': '抬膝',
  'hip abduction': '髋外展', 'hip adduction': '髋内收', 'good morning': '早安式',
  'hyperextension': '超伸', 'reverse hyper': '反向超伸', 'leg press': '腿举',
  'leg curl': '腿弯举', 'leg extension': '腿屈伸', 'pushdown': '下压',
  'upright row': '直立划船', 'lateral raise': '侧平举', 'front raise': '前平举',
  'rear delt fly': '后束飞鸟', 'reverse fly': '反向飞鸟', 'chest press': '推胸',
  'shoulder press': '肩上推举', 'overhead press': '过顶推举', 'arnold press': '阿诺德推举',
  'push press': '借力推举', 'split squat': '分腿蹲', 'bulgarian split squat': '保加利亚分腿蹲',
  'goblet squat': '高脚杯深蹲', 'front squat': '前蹲', 'back squat': '后蹲',
  'sumo squat': '相扑深蹲', 'pistol squat': '单腿深蹲', 'box squat': '箱式深蹲',
  'wall sit': '靠墙静蹲', 'russian twist': '俄罗斯转体', 'v-up': 'V字起身',
  'bicycle crunch': '自行车卷腹', 'mountain climber': '登山者', 'burpee': '波比跳',
  'plank jack': '平板开合', 'side plank': '侧平板', 'pallof press': '帕洛夫推举',
  'farmer carry': '农夫行走', 'suitcase carry': '提箱行走', 'hack squat': '哈克深蹲',
  'seated row': '坐姿划船', 'bent over row': '俯身划船', 't-bar row': 'T杠划船',
  'one arm row': '单臂划船', 'pull through': '胯下拉伸', 'glute kickback': '臀后踢',
  'clamshell': '蚌式', 'jump squat': '跳深蹲', 'side lunge': '侧箭步蹲',
  'curtsy lunge': '屈膝箭步蹲', 'reverse lunge': '反向箭步蹲', 'walking lunge': '行走箭步蹲',
  'cable crossover': '绳索夹胸', 'pec deck': '夹胸', 'chest fly': '夹胸',
  'face pull': '面拉', 'hip raise': '髋部上抬', 'side bend': '侧屈', 'slam': '砸球',
  'rollout': '滚轮', 'twist': '转体', 'shrug': '耸肩', 'kickback': '后踢',
  'pullover': '颈后臂屈伸', 'crunch': '卷腹', 'sit up': '仰卧起坐', 'sit-up': '仰卧起坐',
  'plank': '平板支撑', 'dip': '臂屈伸', 'leg raise': '举腿', 'bridge': '桥',
  'stretch': '拉伸', 'rotation': '旋转', 'neck stretch': '颈部拉伸',
  'side stretch': '侧拉伸', 'wrist curl': '腕弯举', 'snatch': '抓举', 'clean': '翻站',
  'jerk': '上挺', 'thruster': '推举', 'sprint': '冲刺', 'jog': '慢跑', 'kick': '踢',
  'swing': '摆动', 'jump': '跳', 'march': '踏步', 'climb': '攀爬',
  'bench press': '卧推', 'push up': '俯卧撑', 'push-up': '俯卧撑',
  'pull up': '引体向上', 'pull-up': '引体向上', 'chin up': '反握引体',
  'chin-up': '反握引体', 'pulldown': '下拉', 'row': '划船', 'squat': '深蹲',
  'lunge': '箭步蹲', 'deadlift': '硬拉', 'curl': '弯举', 'extension': '臂屈伸',
  'press': '推举', 'fly': '飞鸟', 'flye': '飞鸟', 'raise': '平举'
};

const MOD = {
  'incline': '上斜', 'decline': '下斜', 'seated': '坐姿', 'standing': '站姿',
  'lying': '卧姿', 'prone': '俯卧', 'supine': '仰卧', 'side': '侧',
  'single arm': '单臂', 'single-arm': '单臂', 'one arm': '单臂',
  'single leg': '单腿', 'one leg': '单腿', 'alternating': '交替', 'alternate': '交替',
  'twisting': '转体', 'rotational': '旋转', 'with': '带', 'on': '在', 'to': '至',
  'and': '与', 'neutral grip': '中立握', 'wide grip': '宽握', 'close grip': '窄握',
  'reverse grip': '反握', 'overhand': '正握', 'underhand': '反握', 'neutral': '中立',
  'isometric': '等长', 'eccentric': '离心', 'tempo': '节奏', 'kneeling': '跪姿',
  'half': '半程', 'full': '全程', 'elevated': '垫高', 'suspended': '悬挂',
  'assisted': '助力', 'resisted': '抗阻', 'isometric': '等长', 'slow': '慢速',
  'fast': '快速', 'explosive': '爆发', 'controlled': '控制', 'compound': '复合',
  'isolation': '孤立', 'unilateral': '单侧', 'bilateral': '双侧', 'static': '静态',
  'dynamic': '动态', 'resisted': '抗阻', 'band': '弹力带', 'double': '双臂',
  'both': '双', 'left': '左', 'right': '右', 'upper': '上', 'lower': '下',
  'inner': '内', 'outer': '外', 'front': '前', 'rear': '后', 'deep': '深',
  'shallow': '浅', 'wide': '宽', 'narrow': '窄', 'high': '高', 'low': '低',
  'reverse': '反向', 'straight': '直', 'overhead': '过顶', 'preacher': '牧师凳',
  'two': '双', 'ezbar': 'EZ杆', 'vbar': 'V杆', 'blaster': '训练器', 'over': '过',
  'bent': '俯身', 'ropeattachment': '绳附件', 'grip': '握', 'towel': '毛巾',
  'inverted': '倒置', 'bar': '杆', 'behindhead': '颈后', 'tap': '触',
  'behind': '后', 'forward': '前', 'bentover': '俯身', 'donkey': '驴',
  'archer': '射手', 'plyo': '增强式', 'squating': '深蹲', 'pul': '下拉',
  'parallelgrip': '平行握', 'vertical': '垂直', 'lift': '提', 'stif': '直',
  'stiff': '直', 'inverse': '反向', 'push': '推', 'hang': '悬挂',
  'selfinverse': '自反向', 'raised': '抬', 'crosbody': '交叉', 'crossbody': '交叉',
  'cross': '交叉', 'french': '法式', 'zotman': '佐特曼', 'zottman': '佐特曼',
  'whelrolerout': '滚轮', 'cage': '笼', 'straightbar': '直杆', 'palmin': '掌心',
  'palm': '掌心', 'planche': '平面支撑', 'fixed': '固定', 'pulups': '引体',
  'floor': '地面', 'flor': '地面', 'rope': '绳', 'attachment': '附件',
  'concentration': '集中', 'lateral': '侧', 'laterial': '侧', 'up': '上',
  'of': '', 'the': '', 'release': '放松', 'hold': '保持', 'reach': '伸展',
  'touch': '触', 'touchers': '触', 'circle': '画圈', 'rock': '摇摆',
  'balance': '平衡', 'jack': '开合', 'jacks': '开合', 'hop': '跳', 'skip': '跳',
  'bound': '跨', 'punch': '拳', 'throw': '抛', 'catch': '接', 'sweep': '扫',
  'drag': '拖', 'relax': '放松', 'breathe': '呼吸', 'pause': '停顿',
  'contraction': '收缩', 'activation': '激活', 'stabilization': '稳定',
  'negative': '离心', 'positive': '向心', 'reversepreacher': '反向牧师凳',
  'hangingstraight': '悬挂直腿', 'hanging': '悬挂', 'ez': 'EZ', 'paralel': '平行',
  'squad': '深蹲', 'all fours': '四肢', 'all-fours': '四肢', 'apart': '分开',
  'circular': '画圈', 'slingers': '摆动', 'knee': '膝', 'knees': '膝',
  'double': '双', 'both': '双', 'pov': '', 'flexor': '屈肌', 'depresor': '下掣',
  'retractor': '后缩肌', 'extensor': '伸肌', 'abductor': '外展肌',
  'adductor': '内收肌', 'flexors': '屈肌', 'extensors': '伸肌',
  'parallel': '平行', 'elbow': '肘', 'elbows': '肘', 'pike': '折叠',
  'spider': '蜘蛛', 'cuban': '古巴', 'romanian': '罗马尼亚', 'pelvictilt': '骨盆倾斜',
  'pelvic tilt': '骨盆倾斜', 'spine': '脊柱', 'iron': '铁', 'sumo': '相扑',
  'hack': '哈克', 'support': '支撑', 'suport': '支撑', 'palmsin': '掌心向内',
  'onehand': '单手', 'horizontal': '水平', 'circles': '画圈', 'raises': '平举',
  'dips': '臂屈伸', 'self': '自', 'drop': '递减', 'revers': '反向', 'down': '下',
  'head': '头', 't bar': 'T杆', 'tbar': 'T杆', 'crosovers': '交叉',
  'crossovers': '交叉', 'whellrolerout': '滚轮', 'body': '身', 'extended': '伸展',
  'griples': '无握', 'gripless': '无握', 'poty': '', 'in': '', 'a': '',
  'palms': '掌心', 'pulley': '滑轮', 'puley': '滑轮', 'pul up': '引体',
  'pullups': '引体', 'hands': '手', 'hand': '手', 'one hand': '单手',
  'handsagainst': '手靠', 'flat': '平板', 'jm': 'JM', 'skulcrusher': '碎颅',
  'skull crusher': '碎颅', 'storkstance': '鹤立', 'stork stance': '鹤立',
  'vsit': 'V字坐', 'fingercurls': '手指弯举', 'curls': '弯举',
  'pronation': '旋前', 'supination': '旋后', 'olympic': '奥林匹克',
  'thre': '三', 'sited': '坐姿', 'tuck': '收腿', 'frog': '蛙式',
  'oblique': '腹斜', 'obliques': '腹斜', 'inchworm': '尺蠖', 'twisted': '转体',
  'whellrolerout': '滚轮', 'squating': '深蹲', 'pul': '下拉', 'pulups': '引体',
  'rolerout': '滚轮', 'kickbacks': '后踢', 'modified': '改良', 'hindu': '印度式',
  'maltese': '马耳他', 'london': '伦敦', 'w': 'W', 'bowling': '保龄球'
};

// 合并所有可匹配短语（多词优先）：MOVE > BODY > EQUIP > MOD
const PHRASES = [];
for (const [k, v] of Object.entries(MOVE)) PHRASES.push({ key: k, val: v, cat: 'move' });
for (const [k, v] of Object.entries(BODY)) PHRASES.push({ key: k, val: v, cat: 'body' });
for (const [k, v] of Object.entries(EQUIP)) PHRASES.push({ key: k, val: v, cat: 'equip' });
for (const [k, v] of Object.entries(MOD)) PHRASES.push({ key: k, val: v, cat: 'mod' });
PHRASES.sort((a, b) => b.key.split(' ').length - a.key.split(' ').length); // 长词优先

function normalize(s) {
  return s.toLowerCase().replace(/[_\-]/g, ' ').replace(/\./g, ' ').replace(/v\.?\s*2/g, '').trim();
}

function translateName(en) {
  let core = en;
  // 处理括号内容：翻译后作为补充说明追加
  const extras = [];
  core = core.replace(/\(([^)]*)\)/g, (m, inner) => {
    const t = inner.trim().toLowerCase();
    if (t === 'male' || t === 'female' || t === 'men' || t === 'women') return '';
    const zh = translateCore(inner);
    if (zh) extras.push('（' + zh + '）');
    return '';
  });
  let main = translateCore(core);
  // 去掉可能的重复（如 侧哑铃侧平举 -> 哑铃侧平举）
  main = dedupe(main);
  return (main + extras.join('')).trim();
}

function translateCore(text) {
  const tokens = normalize(text).split(/\s+/).filter(Boolean);
  const groups = { mod: [], equip: [], body: [], move: [] };
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (const p of PHRASES) {
      const pk = p.key.split(' ');
      if (i + pk.length <= tokens.length) {
        let ok = true;
        for (let j = 0; j < pk.length; j++) {
          if (tokens[i + j] !== pk[j]) { ok = false; break; }
        }
        if (ok) {
          groups[p.cat].push(p.val);
          i += pk.length;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      // 未知词：数字或英文原样保留
      groups.move.push(tokens[i]);
      i++;
    }
  }
  const order = [...groups.mod, ...groups.equip, ...groups.body, ...groups.move];
  return order.join('');
}

function dedupe(s) {
  // 简单去重相邻重复（如 哑铃哑铃）
  return s.replace(/(.+)\1+/g, '$1');
}

// ---------- 重新生成 exercises.js ----------
let total = 0, withVideo = 0, withName = 0;
const newLib = {};
for (const cat of Object.keys(lib)) {
  newLib[cat] = lib[cat].map(it => {
    total++;
    const video = videoMap[String(it.id)] || '';
    const nameZh = translateName(it.name || '');
    if (video) withVideo++;
    if (nameZh) withName++;
    return Object.assign({}, it, { nameZh, video });
  });
}

const out = 'const RAW_LIB = ' + JSON.stringify(newLib, null, 0) + ';\n\nmodule.exports = { library: RAW_LIB };\n';
fs.writeFileSync(path.join(__dirname, 'utils', 'exercises.js'), out, 'utf8');

console.log('total:', total, '| withVideo:', withVideo, '| withName:', withName);

// 抽样输出供人工校验
const samples = [];
for (const cat of Object.keys(newLib)) {
  newLib[cat].slice(0, 8).forEach(it => samples.push({ cat, en: it.name, zh: it.nameZh, video: it.video ? 'Y' : '-' }));
}
console.log('\n=== SAMPLE (first 8 per category) ===');
samples.forEach(s => console.log(`[${s.cat}] ${s.en}  =>  ${s.zh}  (video:${s.video})`));
