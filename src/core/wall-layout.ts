import { MAX_BRUSH_CELLS } from './brush-types.ts';
import type { WallStructure } from './brush-types.ts';

interface Run { start: number; end: number; wall: number; station?: WallStructure }
/** Common complete repeat of all enabled wall faces; station lengths are inserted afterwards. */
export function wallRepeat(structures: WallStructure[]): number {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  return structures.filter(value => value.kind === 'wall').reduce((length, value) => Math.min(MAX_BRUSH_CELLS + 1, length / gcd(length, value.pattern.width) * value.pattern.width), 1);
}
export function wallColumns(structures: WallStructure[]): (column: number) => { column: number; station?: WallStructure } {
  const repeat = wallRepeat(structures), stations = structures.filter(value => value.kind === 'station');
  function* runs(): Generator<Run> {
    let start = 0, wall = 0, cycle = 0;
    while (true) {
      yield { start, end: start + repeat, wall }; start += repeat; wall += repeat; cycle++;
      for (const station of stations) if (cycle - station.offset >= station.every && (cycle - station.offset) % station.every === 0) {
        yield { start, end: start + station.pattern.width, wall: 0, station }; start += station.pattern.width;
      }
    }
  }
  const iterator = runs(); let run = iterator.next().value!;
  return column => {
    while (column >= run.end) run = iterator.next().value!;
    return { column: run.wall + column - run.start, station: run.station };
  };
}
export function supportColumn(column: number, structure: WallStructure): number {
  const value = column - structure.offset + Math.floor((structure.pattern.width - 1) / 2);
  return ((value % structure.every) + structure.every) % structure.every;
}
