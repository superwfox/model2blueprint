"""Subset the user-provided fonts offline. Requires fonttools[woff], never a web dependency."""
import argparse
import json
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('chinese', type=Path)
parser.add_argument('english', type=Path)
parser.add_argument('--ui', type=Path, help='Jiangxizhuokai source font for fixed UI copy')
args = parser.parse_args()
text = ''.join(chr(i) for i in range(32, 256))
text += ''.join(p.read_text('utf-8') for p in (root / 'src').rglob('*.ts'))
text += ''.join(p.read_text('utf-8') for p in (root / 'src').rglob('*.vue'))
text += ''.join(p.read_text('utf-8') for p in (root / 'src').rglob('*.css'))
text += (root / 'index.html').read_text('utf-8')
catalog = json.loads((root / 'src/data/block-catalog.json').read_text('utf-8'))
text += ''.join(item['label'] + item['group'] for kind in ['full', 'slab', 'stairs', 'shelf'] for item in catalog[kind])
target = root / 'public/fonts'
target.mkdir(exist_ok=True)
notices = []
fonts = [(args.chinese, 'jinbuti-content.woff2', None), (args.english, 'minecrafter.woff2', ''.join(chr(i) for i in range(32, 256)))]
if args.ui:
    fonts.append((args.ui, 'jiangxizhuokai.woff2', text))
for source, output, content in fonts:
    font = TTFont(source)
    notices.append(source.name + '\n' + '\n'.join(dict.fromkeys(record.toUnicode() for record in font['name'].names if record.nameID in [0, 7, 8, 9, 13, 14])))
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.notdef_glyph = True
    if content is not None:
        worker = subset.Subsetter(options=options)
        worker.populate(text=content)
        worker.subset(font)
    font.flavor = 'woff2'
    font.save(target / output)
    print(output, (target / output).stat().st_size, 'bytes')
(target / 'NOTICES.txt').write_text('\n\n'.join(notices).rstrip() + '\n', encoding='utf-8')
