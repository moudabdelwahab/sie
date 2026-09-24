#!/usr/bin/env python3
"""pack-add-patterns.py — add patterns to a pack token by canonical.

    python3 scripts/pack-add-patterns.py pro 'canonical=p1|p2|p3' …
"""
import sys, glob
pack = sys.argv[1]
files = sorted(glob.glob(f'sie/scenarios/packs/src/{pack}/*.mjs'))
texts = {f: open(f, encoding='utf8').read() for f in files}
for arg in sys.argv[2:]:
    canon, pats = arg.split('=', 1)
    new = [p for p in pats.split('|') if p]
    for f, s in texts.items():
        start = s.find(f"T('{canon}',")
        if start < 0:
            continue
        open_br = s.find('[', start)
        close_br = s.find(']', open_br)
        existing = s[open_br + 1:close_br]
        add = [p for p in new if f"'{p}'" not in existing]
        if add:
            s = s[:close_br] + ''.join(f", '{p}'" for p in add) + s[close_br:]
            texts[f] = s
        print(f'{canon}: + {add}')
        break
    else:
        sys.exit(f'{canon}: not found')
for f, s in texts.items():
    open(f, 'w', encoding='utf8').write(s)
