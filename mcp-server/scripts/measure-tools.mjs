import { allTools, TOOLSETS } from '../dist/tools/index.js';
import { metaTools } from '../dist/meta-tools.js';

// The seven tools the server answers itself (status, guides, find_tools, the
// toolset controls) are not Godot tools and are not in TOOLSETS, but they ride
// in every tools/list — so a number that leaves them out is not the number a
// request pays. This script used to report 8,764 for a surface that costs
// 10,090.
const META = metaTools();

function wire(t) {
  const o = { name: t.name, description: t.description, inputSchema: t.inputSchema };
  if (t.annotations) o.annotations = t.annotations;
  return o;
}
const m = (ts) => {
  const j = JSON.stringify(ts.map(wire));
  return { count: ts.length, chars: j.length };
};
const pad = (s, n) => String(s).padEnd(n);
const num = (n) => n.toLocaleString('en-US').padStart(9);

const rows = [
  ['ALL (every toolset on)', m([...META, ...allTools])],
  ['core (default) — what a client sees', m([...META, ...TOOLSETS.core])],
  ['  of which: the 7 server-side tools', m(META)],
];
for (const [k, v] of Object.entries(TOOLSETS)) if (k !== 'core') rows.push(['  +' + k, m(v)]);

console.log(pad('set', 40), 'tools'.padStart(6), 'chars'.padStart(10), 'est.tok'.padStart(9));
console.log('-'.repeat(68));
for (const [l, x] of rows) console.log(pad(l, 40), String(x.count).padStart(6), num(x.chars), num(Math.round(x.chars / 4)));

const a = m([...META, ...allTools]), c = m([...META, ...TOOLSETS.core]);
console.log('-'.repeat(68));
console.log(`core = ${(100 * c.chars / a.chars).toFixed(1)}% of full by SIZE, ${(100 * c.count / a.count).toFixed(1)}% by COUNT`);
console.log(`loading everything costs ~${Math.round((a.chars - c.chars) / 4).toLocaleString()} extra tokens per request`);

const s = allTools.map((t) => ({ n: t.name, c: JSON.stringify(wire(t)).length })).sort((x, y) => y.c - x.c);
console.log('\ntop 10 most expensive definitions:');
s.slice(0, 10).forEach((t) => console.log('  ' + pad(t.n, 34) + num(t.c)));
console.log('\nmedian: ' + s[Math.floor(s.length / 2)].c + ' chars');

const cs = [...META, ...TOOLSETS.core].map((t) => ({ n: t.name, c: JSON.stringify(wire(t)).length })).sort((x, y) => y.c - x.c);
console.log('\ntop 8 inside core (paid every request):');
cs.slice(0, 8).forEach((t) => console.log('  ' + pad(t.n, 34) + num(t.c)));
