// check-missing-gifs.cjs
// 核对 exercises.js 里引用的演示 GIF，哪些在云存储里缺失。
//
// 用法：
//   1) 在已登录 cloudbase 的本地终端，把云存储 videos/ 清单导出：
//        npx -y -p @cloudbase/cli tcb storage list videos/ -e cloud1-d0g5ihto42b4ed256 > videos_list.txt
//      （首次需先 `npx -y -p @cloudbase/cli tcb login` 扫码授权）
//   2) 把 videos_list.txt 放到项目根目录，运行：
//        node check-missing-gifs.cjs
//
// 未生成清单时，脚本只输出 exercises.js 引用的 GIF 总数，便于确认自身解析正常。

const fs = require('fs');
const path = require('path');

const { library } = require('./utils/exercises.js');
const all = Object.values(library).flat();

// 收集 exercises 引用的所有演示 GIF（video 字段，去重）
const referenced = [];
const seen = new Set();
for (const a of all) {
  if (a.video && /^\/videos\//.test(a.video) && !seen.has(a.video)) {
    seen.add(a.video);
    referenced.push({ id: a.id, name: a.nameZh || a.name, video: a.video });
  }
}

// 读取云端清单（若存在）
let cloudSet = null;
const listPath = path.join(__dirname, 'videos_list.txt');
if (fs.existsSync(listPath)) {
  const txt = fs.readFileSync(listPath, 'utf8');
  cloudSet = new Set();
  // 提取形如 <id>-<hash>.gif 的文件名（容错：tcb 输出可能带其他列）
  const re = /([0-9]{4}-[A-Za-z0-9]{6,}\.gif)/g;
  let m;
  while ((m = re.exec(txt))) cloudSet.add('/videos/' + m[1]);
}

if (!cloudSet) {
  console.log(`exercises.js 共引用 ${referenced.length} 个演示 GIF（video 字段）。`);
  console.log('如需核对云存储缺失项，请先生成云端清单：');
  console.log('  npx -y -p @cloudbase/cli tcb storage list videos/ -e cloud1-d0g5ihto42b4ed256 > videos_list.txt');
  console.log('然后重新运行本脚本。');
} else {
  const missing = referenced.filter((r) => !cloudSet.has(r.video));
  console.log(`云端清单含 ${cloudSet.size} 个 GIF；exercises 引用 ${referenced.length} 个。`);
  if (!missing.length) {
    console.log('✓ 所有引用的 GIF 在云存储均存在。');
  } else {
    console.log(`✗ 缺失 ${missing.length} 个 GIF（需补传，文件名须精确等于 video 字段）：`);
    missing.forEach((r) => console.log(`  id=${r.id}  ${r.name}  ->  ${r.video}`));
  }
}
