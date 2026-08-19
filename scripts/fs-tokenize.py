#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
衡砺健身记录 · 字体比例 token 化
把散落的 `font-size: <n>rpx` 就近归并到语义 Type Scale token（--fs-*）。

用法：
  python fs-tokenize.py --dry      # 仅统计，不写文件
  python fs-tokenize.py --apply    # 写入替换（原值按映射就近归并）

规则：
  - 仅处理 *.wxss（排除 .workbuddy / backup）
  - 仅替换字面量 `font-size: <n>rpx`，不动 calc()/var()/em 等
  - 映射表内的值替换为对应 var(--fs-*)
  - 未映射的极端值（如 14/16/17）保持原样，避免意外
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 值 -> token 名（就近归并，幅度 ±2~4rpx）
MAP = {
    18: 'caption', 20: 'caption', 22: 'caption',
    23: 'label',   24: 'label',   25: 'label',
    26: 'body',    28: 'body',
    30: 'head',    32: 'head',
    34: 'title',   36: 'title',   38: 'title',
    40: 'section', 42: 'section',
    44: 'page',    46: 'page',    48: 'page',
    52: 'display',
    72: 'hero',    76: 'hero',
    80: 'hero-lg', 88: 'hero-lg', 90: 'hero-lg',
    120: 'mega',
    180: 'giant',
}
TOKEN = lambda v: '--fs-' + MAP[v]

# 匹配独立字面量：font-size: 28rpx（后接 ; 或 } 或空白换行；前面是 : 或 ;
PAT = re.compile(r'(font-size:\s*)(\d+(?:\.\d+)?)(rpx)\b')

def process(text):
    stats = {}
    def repl(m):
        pre, num, unit = m.group(1), m.group(2), m.group(3)
        v = float(num)
        if v != int(v):
            return m.group(0)
        iv = int(v)
        if iv not in MAP:
            stats.setdefault('unmapped', {}).setdefault(iv, 0)
            stats['unmapped'][iv] += 1
            return m.group(0)
        tok = TOKEN(iv)
        stats.setdefault('mapped', {}).setdefault(tok, 0)
        stats['mapped'][tok] += 1
        return f'{pre}var({tok})'
    new = PAT.sub(repl, text)
    return new, stats

def walk_wxss():
    for dp, dns, fns in os.walk(ROOT):
        if '.workbuddy' in dp or 'backup' in dp:
            continue
        for fn in fns:
            if fn.endswith('.wxss'):
                yield os.path.join(dp, fn)

def main():
    dry = '--dry' in sys.argv
    apply = '--apply' in sys.argv
    if not (dry or apply):
        print('usage: fs-tokenize.py --dry | --apply')
        return
    total_mapped = 0
    total_unmapped = {}
    files_changed = 0
    for path in walk_wxss():
        with open(path, 'r', encoding='utf-8') as f:
            text = f.read()
        new, st = process(text)
        if st:
            files_changed += 1
        m = st.get('mapped', {})
        u = st.get('unmapped', {})
        for k, v in m.items():
            total_mapped += v
        for k, v in u.items():
            total_unmapped[k] = total_unmapped.get(k, 0) + v
        if (m or u):
            rel = os.path.relpath(path, ROOT)
            print(f'[{rel}] mapped={sum(m.values())} unmapped={sum(u.values())}')
            for tok, c in sorted(m.items()):
                print(f'    {tok}: {c}')
            for val, c in sorted(u.items()):
                print(f'    (keep) {val}rpx: {c}')
        if apply and new != text:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new)
    print('=' * 50)
    print(f'files touched : {files_changed}')
    print(f'total mapped  : {total_mapped}')
    print(f'unmapped vals : {dict(sorted(total_unmapped.items()))}')

if __name__ == '__main__':
    main()
