const SVG_NS = 'http://www.w3.org/2000/svg';
const sizes = [4, 8, 14, 8, 4];
const positions = [3, 11, 24, 43, 55];

// Ported from ref/lattice.ts; this project uses native DOM rather than Vue.
function corner(inset: boolean, end: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('lattice-corner');
  if (end) svg.classList.add('lattice-end');
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('fill', 'none');
  group.setAttribute('stroke', 'currentColor');
  group.setAttribute('stroke-width', '1');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M1 63V1H63');
  group.append(path);
  const indices = inset ? [1, 2, 3] : [0, 1, 2, 3, 4];
  let step = end ? indices.length * 2 : 0;
  for (const side of [true, false]) {
    for (const index of side ? [...indices].reverse() : indices) {
      const size = sizes[index];
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(side ? (inset ? 1 : 1 - size) : positions[index]));
      rect.setAttribute('y', String(side ? positions[index] : (inset ? 1 : 1 - size)));
      rect.setAttribute('width', String(size));
      rect.setAttribute('height', String(size));
      if (side) rect.classList.add('lattice-side');
      rect.style.setProperty('--step', String(step++));
      group.append(rect);
    }
  }
  svg.append(group);
  return svg;
}

export function decorateLattice(element: HTMLElement, kind: 'frame' | 'button' = 'button'): void {
  element.classList.add(`lattice-${kind}`);
  if (Array.from(element.children).some(child => child.classList.contains('lattice-corner'))) return;
  element.append(corner(kind === 'button', false), corner(kind === 'button', true));
}
