#!/usr/bin/env python3
"""pack-add-alt.py — add alternative signatures to pack scenarios by id.

    python3 scripts/pack-add-alt.py pro 'id=token:w token:w' ['id=…' …]

Edits sie/scenarios/packs/src/<pack>/*.mjs in place (the sources are the
truth; the JSON is rebuilt by scripts/build-packs.mjs). Refuses to add a
signature the scenario already has.
"""
import re, sys, glob

pack = sys.argv[1]
files = sorted(glob.glob(f'sie/scenarios/packs/src/{pack}/*.mjs'))
texts = {f: open(f, encoding='utf8').read() for f in files}

for arg in sys.argv[2:]:
    sid, sig = arg.split('=', 1)
    sig = ' '.join(sig.split())
    for f, s in texts.items():
        start = s.find(f"S('{sid}',")
        if start < 0:
            continue
        nxt = [i for i in (s.find('\n        S(', start + 1), s.find('\n    ]', start + 1)) if i > 0]
        end = min(nxt)
        block = s[start:end]
        if f"'{sig}'" in block:
            print(f'{sid}: already has {sig}'); break
        if 'alt: [' in block:
            block = block.replace('alt: [', f"alt: ['{sig}', ", 1)
        else:
            m = re.search(r'\{\s*(q|noTicket|knowledgeSource)\s*:', block)
            if m:
                block = block[:m.start()] + '{ alt: [' + f"'{sig}'], " + block[m.start() + 1:].lstrip()
            else:
                close = block.rstrip().rstrip(',')
                assert close.endswith(')'), f'{sid}: cannot find the end of S(...)'
                tail = block[len(close):]
                block = close[:-1] + f",\n            {{ alt: ['{sig}'] }})" + tail
        texts[f] = s[:start] + block + s[end:]
        print(f'{sid}: + {sig}')
        break
    else:
        sys.exit(f'{sid}: not found in {pack}')

for f, s in texts.items():
    open(f, 'w', encoding='utf8').write(s)
