// Kör: node tests/test_conflicts.js
// Regel: krock = två Järfälla-lag i olika poolspel/cuper samma dag.
const assert = require('assert');
const C = require('../docs/conflicts.js');

let n = 0;
function m(id, team, block, date, start, venue, extra) {
  return Object.assign({ id, teams: [team], block, date, start, venue, block_kind: 'sammandrag', block_times: start ? [start] : [], age: team.split(':')[0], status: 'planerad' }, extra || {});
}
const S = { match_minutes: 25 };
function types(ms) { return C.analyze(ms, S).conflicts.map(c => c.type); }
function t(name, fn) { fn(); n++; console.log('ok -', name); }

t('olika lag, olika poolspel samma dag = krock även långt isär', () => {
  assert.deepStrictEqual(types([m('a', 'U9:svart', 'b1', '2026-11-07', '08:00', 'A'), m('b', 'U10:blå', 'b2', '2026-11-07', '17:00', 'B')]), ['sammadag']);
});
t('samtidigt i olika hallar markeras extra', () => {
  const ms = [m('a1', 'U9:gul', 'b1', '2026-11-07', '10:00', 'A', { block_times: ['10:00', '10:25', '10:50'] }),
    m('b1', 'U9:vit', 'b2', '2026-11-07', '10:25', 'B', { block_times: ['10:25', '10:50', '11:15'] })];
  const r = C.analyze(ms, S).conflicts;
  assert.strictEqual(r[0].type, 'samtidigt');
  assert.strictEqual(r[0].overlap, 'ja');
});
t('samtidigt i samma hall är krock samma dag men inte "samtidigt i olika hallar"', () => {
  assert.deepStrictEqual(types([m('a', 'U9:röd', 'b1', '2026-11-07', '18:30', 'Kallhäll'), m('b', 'U9:vit', 'b2', '2026-11-07', '18:30', 'Kallhäll')]), ['sammadag']);
});
t('saknad tid är fortfarande krock (datum räcker)', () => {
  assert.deepStrictEqual(types([m('a', 'U9:röd', 'b1', '2026-11-07', null, 'A'), m('b', 'U10:vit', 'b2', '2026-11-07', '10:00', 'B')]), ['sammadag']);
});
t('lagets tre matcher i samma poolspel ger ingen krock', () => {
  assert.deepStrictEqual(types([m('a', 'U9:röd', 'b1', '2026-11-07', '10:00', 'A'), m('b', 'U9:röd', 'b1', '2026-11-07', '10:25', 'A'), m('c', 'U9:röd', 'b1', '2026-11-07', '10:50', 'A')]), []);
});
t('två Järfälla-lag i samma poolspel ger ingen krock', () => {
  assert.deepStrictEqual(types([m('a', 'U9:röd', 'b1', '2026-11-07', '10:00', 'A'), m('b', 'U9:vit', 'b1', '2026-11-07', '10:25', 'A')]), []);
});
t('olika dagar ger ingen krock', () => {
  assert.deepStrictEqual(types([m('a', 'U9:röd', 'b1', '2026-11-07', '10:00', 'A'), m('b', 'U9:vit', 'b2', '2026-11-08', '10:00', 'B')]), []);
});
t('inställda och saknade matcher ignoreras', () => {
  assert.deepStrictEqual(types([m('a', 'U9:röd', 'b1', '2026-11-07', '10:00', 'A', { status: 'inställd' }), m('b', 'U9:vit', 'b2', '2026-11-07', '10:00', 'B'),
    m('c', 'U10:gul', 'b3', '2026-11-07', '10:00', 'C', { missing_since: '2026-11-04T00:00:00Z' })]), []);
});
t('samma lag i två poolspel samma dag = krock', () => {
  const r = C.analyze([m('a', 'U9:röd', 'b1', '2026-11-07', '09:00', 'A'), m('b', 'U9:röd', 'b2', '2026-11-07', '15:00', 'B')], S).conflicts;
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].sameTeam, true);
});
t('dagsammanställning listar alla inblandade lag', () => {
  const r = C.analyze([m('a', 'U9:röd', 'b1', '2026-11-07', '09:00', 'A'), m('b', 'U9:vit', 'b2', '2026-11-07', '12:00', 'B'), m('c', 'U10:gul', 'b3', '2026-11-07', '15:00', 'C')], S);
  assert.strictEqual(r.days.length, 1); assert.strictEqual(r.days[0].engagements.length, 3); assert.strictEqual(r.days[0].pairs.length, 3);
});
console.log(n + ' tester OK');
