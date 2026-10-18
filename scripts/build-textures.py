"""Build the bundled atlas from the openly licensed pack; the client JAR supplies JSON metadata only."""
import argparse
import hashlib
import json
import math
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
from PIL import Image

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('pack', type=Path)
parser.add_argument('jar', type=Path)
args = parser.parse_args()
catalog = json.loads((root / 'src/data/block-catalog.json').read_text('utf-8'))
registry = json.loads((root / 'scripts/data/minecraft-26.3-blocks.json').read_text('utf-8'))
directions = ['east', 'west', 'up', 'down', 'south', 'north']
tiles = [Image.new('RGBA', (16, 16), 'white')]
tile_sources = [{'source': 'solid-colour fallback', 'tint': None}]
cache, blocks, missing = {}, {}, []

def matches(condition, state):
    if 'OR' in condition: return any(matches(c, state) for c in condition['OR'])
    if 'AND' in condition: return all(matches(c, state) for c in condition['AND'])
    return all(state.get(k) in str(v).split('|') for k, v in condition.items())

with ZipFile(args.pack) as pack, ZipFile(args.jar) as jar:
    assets = {name[name.index('assets/'):]: name for name in pack.namelist() if 'assets/' in name and not name.endswith('/')}
    jar_files = set(jar.namelist())
    def read_json(path):
        if path in assets: return json.loads(pack.read(assets[path]))
        if path in jar_files: return json.loads(jar.read(path))
        return {}

    @lru_cache(None)
    def model(value):
        namespace, name = value.split(':', 1) if ':' in value else ('minecraft', value)
        own = read_json(f'assets/{namespace}/models/{name}.json')
        parent = model(own['parent']) if own.get('parent') and not own['parent'].startswith('builtin/') else {}
        return {**parent, **own, 'textures': {**parent.get('textures', {}), **own.get('textures', {})}}

    def tint(block):
        if 'spruce' in block: return (97, 153, 97)
        if 'birch' in block: return (128, 167, 85)
        if 'mangrove' in block: return (141, 177, 39)
        path = 'assets/minecraft/textures/colormap/' + ('foliage' if 'leaves' in block else 'grass') + '.png'
        if path in assets:
            return Image.open(BytesIO(pack.read(assets[path]))).convert('RGB').getpixel((51, 173))
        return (119, 171, 47)

    def tile(value, colour):
        namespace, name = value.split(':', 1) if ':' in value else ('minecraft', value)
        path = f'assets/{namespace}/textures/{name}.png'
        if path not in assets: return 0
        key = (path, colour)
        if key in cache: return cache[key]
        image = Image.open(BytesIO(pack.read(assets[path]))).convert('RGBA')
        if image.height > image.width: image = image.crop((0, 0, image.width, image.width))
        image = image.resize((16, 16), Image.Resampling.NEAREST)
        if colour:
            image.putdata([tuple(round(p[a] * colour[a] / 255) for a in range(3)) + (p[3],) for p in image.getdata()])
        cache[key] = len(tiles); tiles.append(image); tile_sources.append({'source': path, 'tint': colour})
        return cache[key]

    for kind in ['full', 'slab', 'stairs', 'shelf']:
        for block in catalog[kind]:
            name = block['id']; state = registry[name][1]
            definition = read_json(f'assets/minecraft/blockstates/{name}.json')
            selected = []
            for key, item in definition.get('variants', {}).items():
                condition = dict(pair.split('=') for pair in key.split(',') if pair)
                if matches(condition, state): selected.append(item)
            for part in definition.get('multipart', []):
                if matches(part.get('when', {}), state): selected.append(part['apply'])
            choices = [[] for _ in directions]
            for item in selected:
                item = item[0] if isinstance(item, list) else item
                resolved = model(item['model']); textures = resolved.get('textures', {})
                for element in resolved.get('elements', []):
                    lo, hi = element['from'], element['to']
                    for face, surface in element.get('faces', {}).items():
                        if face not in directions: continue
                        axis = 0 if face in ['east', 'west'] else 1 if face in ['up', 'down'] else 2
                        area = abs((hi[(axis + 1) % 3] - lo[(axis + 1) % 3]) * (hi[(axis + 2) % 3] - lo[(axis + 2) % 3]))
                        value, seen = surface.get('texture', ''), set()
                        while isinstance(value, str) and value.startswith('#') and value not in seen:
                            seen.add(value); value = textures.get(value[1:], '')
                        if isinstance(value, dict): value = value.get('sprite', '')
                        if not value or value.startswith('#'): continue
                        index = directions.index(face)
                        # Blockstate Y rotations are clockwise when viewed from above.
                        for _ in range((item.get('y', 0) // 90) % 4): index = [4, 5, 2, 3, 1, 0][index]
                        choices[index].append((area, value, tint(name) if 'tintindex' in surface else None))
            faces = []
            for choices_for_face in choices:
                found = next((entry for _, texture, colour in sorted(choices_for_face, key=lambda v: -v[0]) if (entry := tile(texture, colour))), 0)
                faces.append(found)
            if not any(faces):
                for candidate in [name, name.replace('_shelf', '_planks'), name.removesuffix('_slab'), name.removesuffix('_stairs')]:
                    fallback = tile('block/' + candidate, None)
                    if fallback: faces = [fallback] * 6; break
            if not all(faces): missing.append(name)
            blocks[name] = faces

    out = root / 'public/textures'; out.mkdir(exist_ok=True)
    columns, rows = 32, math.ceil(len(tiles) / 32)
    atlas = Image.new('RGBA', (columns * 16, rows * 16))
    for i, image in enumerate(tiles): atlas.paste(image, ((i % columns) * 16, (i // columns) * 16))
    atlas.save(out / 'atlas.png', optimize=True)
    for path in pack.namelist():
        if path.lower().endswith('/pack.txt') or path.lower() == 'pack.txt':
            (out / 'original-pack-notice.txt').write_bytes(pack.read(path)); break
    attribution = 'Pixel Perfection Legacy 26.3-97.1\nOriginal art: Hugh "XSSheep" Rutland. Continued by Nova_Wostra and contributors.\nhttps://modrinth.com/resourcepack/pixel-perfection-legacy\nhttps://github.com/NovaWostra/Pixel-Perfection-Chorus-Eddit\nCC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/\nOnly required block textures are included. Atlas modifications: first animation frame, nearest 16px sampling, baked foliage tints, atlas packing. Texture derivatives retain CC BY-SA 4.0.\n'
    (out / 'NOTICE.txt').write_text(attribution, encoding='utf-8')
    metadata = {'tileSize': 16, 'columns': columns, 'rows': rows, 'blocks': blocks, 'missing': missing,
                'source': {'name': 'Pixel Perfection Legacy', 'version': '26.3-97.1', 'sha512': hashlib.sha512(args.pack.read_bytes()).hexdigest()}}
    (root / 'src/data/block-textures.json').write_text(json.dumps(metadata, separators=(',', ':')) + '\n', encoding='utf-8')
    (out / 'sources.json').write_text(json.dumps(tile_sources, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'blocks': len(blocks), 'tiles': len(tiles), 'atlasBytes': (out/'atlas.png').stat().st_size, 'missing': missing}))
