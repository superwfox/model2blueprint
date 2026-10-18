"""Extract the 26.3 material catalog from a local vanilla client JAR; never run Minecraft.

Requires Python + Pillow for this optional maintainer script. The web app uses the checked-in
JSON only, and does not require Java, Python, the JAR, textures, or a conversion server.
"""
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
import argparse
import hashlib
import json
from PIL import Image
from java_class import JavaClass

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'scripts' / 'data'
COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
          'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']
TABS = {'itemGroup.buildingBlocks': '建筑方块', 'itemGroup.coloredBlocks': '彩色方块',
        'itemGroup.natural': '天然方块', 'itemGroup.functional': '功能方块', 'itemGroup.redstone': '红石方块'}
FUNCTIONAL = {'crafting_table', 'chiseled_bookshelf', 'redstone_block', 'target', 'note_block', 'jukebox',
              'beehive', 'bee_nest', 'creaking_heart', 'budding_amethyst', 'sculk_catalyst', 'respawn_anchor',
              'lodestone', 'enchanting_table', 'spawner', 'trial_spawner', 'vault', 'tnt', 'slime_block',
              'honey_block', 'dispenser', 'dropper', 'observer', 'piston', 'sticky_piston', 'crafter',
              'furnace', 'blast_furnace', 'smoker', 'barrel', 'chest', 'trapped_chest', 'ender_chest',
              'cartography_table', 'fletching_table', 'smithing_table', 'loom', 'composter', 'redstone_lamp',
              'shulker_box', 'copper_chest', 'copper_bulb'}


def is_functional(name):
    return name in FUNCTIONAL or name.endswith(('_shulker_box', '_copper_chest', '_copper_bulb'))


def resource_path(value, category):
    namespace, name = value.split(':', 1) if ':' in value else ('minecraft', value)
    return f'assets/{namespace}/{category}/{name}.json'


def matches(when, state):
    if 'OR' in when:
        return any(matches(part, state) for part in when['OR'])
    if 'AND' in when:
        return all(matches(part, state) for part in when['AND'])
    return all(str(state.get(key)) in str(value).split('|') for key, value in when.items())


def group_for(name, tab):
    if 'wool' in name: return '羊毛'
    if 'concrete' in name: return '混凝土'
    if 'terracotta' in name: return '陶瓦'
    if 'glass' in name: return '玻璃'
    if 'copper' in name: return '铜材'
    if any(wood in name for wood in ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry',
                                    'bamboo', 'crimson', 'warped', 'poplar']) and 'leaves' not in name: return '木材'
    if 'leaves' in name or 'moss' in name or 'mushroom' in name: return '植被'
    if 'ore' in name or name in {'coal_block', 'iron_block', 'gold_block', 'diamond_block', 'lapis_block',
                               'emerald_block', 'netherite_block', 'raw_iron_block', 'raw_gold_block', 'raw_copper_block'}: return '矿物'
    return '天然材料' if tab == '天然方块' else '石材与建筑'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('jar', type=Path)
    args = parser.parse_args()
    registry = json.loads((DATA / 'minecraft-26.3-blocks.json').read_text('utf-8'))
    lang = json.loads((DATA / 'minecraft-26.3-zh_cn.json').read_text('utf-8'))
    with ZipFile(args.jar) as archive:
        version = json.loads(archive.read('version.json'))
        if version['id'] != '26.3' or version['world_version'] != 5023:
            raise ValueError('This catalog targets Minecraft 26.3 / DataVersion 5023 only.')
        files = set(archive.namelist())
        creative = JavaClass(archive.read('net/minecraft/world/item/CreativeModeTabs.class'))
        methods, current_tab = {}, None
        for op, ref in creative.instructions('bootstrap'):
            if isinstance(ref, str) and ref.startswith('itemGroup.'):
                current_tab = ref
            if op == 0xba and current_tab in TABS:
                for owner, method, descriptor in ref:
                    if 'ItemDisplayParameters' in descriptor:
                        methods[current_tab] = method
        tab_items = {}
        def item_references(method, visited=None):
            visited = set() if visited is None else visited
            if method in visited: return
            visited.add(method)
            for op, ref in creative.instructions(method):
                if op == 0xb2 and isinstance(ref, tuple) and ref[0] in ('net/minecraft/world/item/Items', 'net/minecraft/world/level/block/Blocks'):
                    yield ref
                elif op in (0xb6, 0xb8) and isinstance(ref, tuple) and ref[0] == 'net/minecraft/world/item/CreativeModeTabs' and ref[1] in creative.methods:
                    yield from item_references(ref[1], visited)
                elif op == 0xba:
                    for owner, target, _ in ref:
                        if owner == 'net/minecraft/world/item/CreativeModeTabs' and target in creative.methods:
                            yield from item_references(target, visited)
        for tab, method in methods.items():
            values = []
            for ref in item_references(method):
                name = ref[1].lower()
                if 'ColorCollection' in ref[2]:
                    stem = name.removeprefix('dyed_')
                    values.extend(f'{color}_{stem}' for color in COLORS if f'{color}_{stem}' in registry)
                elif 'WeatheringCopperCollection' in ref[2]:
                    for wax in ['', 'waxed_']:
                        for stage in ['', 'exposed_', 'weathered_', 'oxidized_']:
                            stem = 'copper' if stage and name == 'copper_block' else name
                            variant = f'{wax}{stage}{stem}'
                            if variant in registry: values.append(variant)
                else:
                    name = {'cut_standstone_slab': 'cut_sandstone_slab'}.get(name, name)
                    if name in registry: values.append(name)
            tab_items[TABS[tab]] = list(dict.fromkeys(values))
        source_tabs = {}
        for tab in ['建筑方块', '彩色方块', '天然方块']:
            for name in tab_items[tab]: source_tabs.setdefault(name, tab)

        @lru_cache(maxsize=None)
        def model(value):
            path = resource_path(value, 'models')
            if path not in files: return {'textures': {}, 'elements': []}
            own = json.loads(archive.read(path))
            parent = model(own['parent']) if 'parent' in own and not own['parent'].startswith('builtin/') else {}
            return {**parent, **own, 'textures': {**parent.get('textures', {}), **own.get('textures', {})}}

        def selected_models(name):
            path = f'assets/minecraft/blockstates/{name}.json'
            if path not in files: return []
            definition = json.loads(archive.read(path))
            state = registry[name][1]
            selected = []
            for key, item in definition.get('variants', {}).items():
                if matches(dict(entry.split('=') for entry in key.split(',') if entry), state): selected.append(item)
            for item in definition.get('multipart', []):
                if matches(item.get('when', {}), state): selected.append(item['apply'])
            return [model((item[0] if isinstance(item, list) else item)['model']) for item in selected]

        @lru_cache(maxsize=None)
        def texture(value):
            namespace, name = value.split(':', 1) if ':' in value else ('minecraft', value)
            image = Image.open(BytesIO(archive.read(f'assets/{namespace}/textures/{name}.png'))).convert('RGBA')
            # Animated textures are a vertical strip; use their first square frame.
            if image.height > image.width: image = image.crop((0, 0, image.width, image.width))
            pixels = list(image.get_flattened_data() if hasattr(image, 'get_flattened_data') else image.getdata())
            weight = sum(p[3] / 255 for p in pixels)
            color = [sum(p[axis] * p[3] / 255 for p in pixels) / max(weight, 1e-9) for axis in range(3)]
            return color, weight / len(pixels)

        grass = Image.open(BytesIO(archive.read('assets/minecraft/textures/colormap/grass.png'))).convert('RGB').getpixel((51, 173))
        foliage = Image.open(BytesIO(archive.read('assets/minecraft/textures/colormap/foliage.png'))).convert('RGB').getpixel((51, 173))

        def tint(name):
            if 'spruce' in name: return (97, 153, 97)
            if 'birch' in name: return (128, 167, 85)
            if 'mangrove' in name: return (141, 177, 39)
            return foliage if 'leaves' in name else grass

        def describe(name, models):
            rgb, weight, occupancy, unmapped = [0.0, 0.0, 0.0], 0.0, 0, False
            for item in models:
                textures = item.get('textures', {})
                for element in item.get('elements', []):
                    lo, hi = element['from'], element['to']
                    if not element.get('rotation'):
                        for bit in range(8):
                            p = [4 + (bit & 1) * 8, 4 + (bit >> 2) * 8, 4 + ((bit >> 1) & 1) * 8]
                            if all(lo[a] <= p[a] < hi[a] for a in range(3)): occupancy |= 1 << bit
                    for face, surface in element.get('faces', {}).items():
                        axis = 1 if face in ('up', 'down') else 0 if face in ('east', 'west') else 2
                        area = (hi[(axis + 1) % 3] - lo[(axis + 1) % 3]) * (hi[(axis + 2) % 3] - lo[(axis + 2) % 3])
                        value, visited = surface['texture'], set()
                        while True:
                            if isinstance(value, dict): value = value.get('sprite', '')
                            if not value.startswith('#') or value in visited: break
                            visited.add(value); value = textures.get(value[1:], '')
                        if not value or value.startswith('#'): unmapped = True; continue
                        color, alpha = texture(value)
                        if 'tintindex' in surface: color = [c * t / 255 for c, t in zip(color, tint(name))]
                        weighted = area * alpha
                        for a in range(3): rgb[a] += color[a] * weighted
                        weight += weighted
            if weight <= 0 or unmapped: return None, occupancy
            return [round(c / weight) for c in rgb], occupancy

        catalog, excluded = {'full': [], 'slab': [], 'stairs': []}, []
        for name, (properties, defaults) in registry.items():
            kind = 'slab' if 'slab' in name and 'type' in properties else 'stairs' if name.endswith('_stairs') else 'full'
            if is_functional(name):
                excluded.append({'id': name, 'reason': 'functional'}); continue
            if kind == 'full' and name not in source_tabs:
                excluded.append({'id': name, 'reason': 'outside-building-colored-natural'}); continue
            models = selected_models(name)
            if not models:
                excluded.append({'id': name, 'reason': 'no-static-model'}); continue
            color, occupancy = describe(name, models)
            if kind == 'full' and occupancy != 255:
                excluded.append({'id': name, 'reason': 'other-shape'}); continue
            if color is None: raise ValueError(f'No resolved block texture for {name}')
            state = dict(defaults)
            if 'persistent' in state: state['persistent'] = 'true'
            full_state = name + ('[' + ','.join(f'{key}={value}' for key, value in sorted(state.items())) + ']' if state else '')
            entry = {'id': name, 'label': lang.get('block.minecraft.' + name, name), 'color': color,
                     'group': group_for(name, source_tabs.get(name, '建筑方块'))}
            if kind == 'full':
                entry['state'] = full_state
                # A solid GLB must not unexpectedly become transparent glass or melt in the previewed build.
                entry['auto'] = 'glass' not in name and name not in {'ice', 'farmland', 'dirt_path'} and not (name.endswith('_coral_block') and not name.startswith('dead_'))
            catalog[kind].append(entry)

        # Native companions are discovered only from real IDs in the registry. Never invent a slab or stair ID.
        for entry in catalog['full']:
            name = entry['id']
            stems = [name, name.removesuffix('_planks'), name.removesuffix('_block'),
                     name[:-1] if name.endswith(('bricks', 'tiles')) else name,
                     'brick' if name == 'bricks' else name]
            for kind in ['slab', 'stairs']:
                available = {item['id'] for item in catalog[kind]}
                match = next((f'{stem}_{kind}' for stem in stems if f'{stem}_{kind}' in available), None)
                if match: entry[kind] = match
        catalog['full'].sort(key=lambda item: (item['id'] != 'stone', item['group'], item['id']))
        result = {'version': '26.3', 'dataVersion': 5023, 'sourceJarSha1': hashlib.sha1(args.jar.read_bytes()).hexdigest(),
                  'colorReference': 'vanilla texture area/alpha-weighted RGB, plains grass/foliage tint', **catalog}
        target = ROOT / 'src' / 'data' / 'block-catalog.json'
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        audit = {'version': '26.3', 'creativeTabs': tab_items, 'supported': {kind: [item['id'] for item in items] for kind, items in catalog.items()}, 'excluded': excluded}
        (DATA / 'catalog-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({kind: len(items) for kind, items in catalog.items()}))
        print('Functional tab overlap:', [item['id'] for item in catalog['full'] if item['id'] in tab_items['功能方块']])


if __name__ == '__main__':
    main()
