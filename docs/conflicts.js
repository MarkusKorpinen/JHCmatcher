/* Krockanalys. Körs i webbläsaren och i tester (Node).
 *
 * Regel (beslutad av föreningen): spelarna orkar i regel inte mer än ett
 * poolspel per dag. Därför är det en KROCK när två Järfälla-lag (inom U9,
 * inom U10 eller mellan U9 och U10) spelar olika poolspel/cuper SAMMA DAG.
 *
 * Varje lags poolspel (eller cupdag) är ett "åtagande". Ett lags egna matcher
 * i samma poolspel räknas aldrig som krock, och inte heller två Järfälla-lag
 * som spelar i samma poolspel.
 *
 * Som extra information markeras om poolspelen dessutom pågår samtidigt i
 * olika hallar (enligt källans starttider, eller med antagen matchlängd).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JHCConflicts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = {
    samtidigt: { label: 'Krock – samma dag och samtidigt i olika hallar', severity: 3 },
    sammadag: { label: 'Krock – samma dag', severity: 2 }
  };

  function toMin(t) {
    if (!t) return null;
    var p = t.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }
  function fmt(m) {
    if (m == null) return '–';
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function isActive(m) {
    return !m.missing_since && m.status !== 'inställd' && m.status !== 'uppskjuten';
  }
  function uniqSorted(a) {
    return a.filter(function (x, i) { return x != null && a.indexOf(x) === i; }).sort(function (x, y) { return x - y; });
  }

  function engagements(matches) {
    var map = {};
    matches.forEach(function (m) {
      if (!isActive(m) || !m.date) return;
      m.teams.forEach(function (team) {
        var key = team + '|' + m.block + '|' + m.date;
        var e = map[key];
        if (!e) {
          e = map[key] = { key: key, team: team, block: m.block, date: m.date, kind: m.block_kind,
            venues: [], ownTimes: [], untimed: 0, blockTimes: [], matches: [], age: m.age };
        }
        e.matches.push(m.id);
        if (m.venue && e.venues.indexOf(m.venue) < 0) e.venues.push(m.venue);
        var t = toMin(m.start);
        if (t == null) e.untimed++; else e.ownTimes.push(t);
        if (m.block_kind !== 'cup') e.blockTimes = e.blockTimes.concat((m.block_times || []).map(toMin));
      });
    });
    return Object.keys(map).map(function (k) {
      var e = map[k];
      e.ownTimes = uniqSorted(e.ownTimes);
      e.blockTimes = uniqSorted(e.blockTimes);
      var all = uniqSorted(e.ownTimes.concat(e.blockTimes));
      e.times = all;
      e.winFirst = all.length ? all[0] : null;
      e.winLast = all.length ? all[all.length - 1] : null;
      return e;
    });
  }

  function sameVenue(a, b) {
    if (!a.venues.length || !b.venues.length) return null;
    return a.venues.some(function (v) { return b.venues.indexOf(v) >= 0; });
  }

  // Överlappar poolspelen i tid? 'ja' (enligt källans tider), 'trolig'
  // (först med antagen matchlängd), 'nej', eller null (tid saknas).
  function overlap(a, b, L) {
    if (a.winFirst == null || b.winFirst == null) return null;
    if (Math.max(a.winFirst, b.winFirst) <= Math.min(a.winLast, b.winLast)) return 'ja';
    if (a.winFirst < b.winLast + L && b.winFirst < a.winLast + L) return 'trolig';
    return 'nej';
  }

  function analyze(matches, settings) {
    var L = Number(settings.match_minutes) || 0;
    var es = engagements(matches);
    var byDate = {};
    es.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    var out = [], days = [];
    Object.keys(byDate).sort().forEach(function (date) {
      var list = byDate[date];
      var dayPairs = [];
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var r = pair(list[i], list[j], L);
          if (r) { out.push(r); dayPairs.push(r); }
        }
      }
      if (dayPairs.length) {
        var involved = list.filter(function (e) { return dayPairs.some(function (p) { return p.a === e || p.b === e; }); });
        involved.sort(function (x, y) { return (x.winFirst == null ? 9999 : x.winFirst) - (y.winFirst == null ? 9999 : y.winFirst); });
        days.push({ date: date, engagements: involved, pairs: dayPairs,
          severity: Math.max.apply(null, dayPairs.map(function (p) { return p.severity; })) });
      }
    });
    return { conflicts: out, days: days, engagements: es };
  }

  function pair(a, b, L) {
    if (a.block === b.block) return null; // samma poolspel/cupdag
    var sv = sameVenue(a, b);
    var ov = overlap(a, b, L);
    var simultaneousElsewhere = sv === false && (ov === 'ja' || ov === 'trolig');
    var type = simultaneousElsewhere ? 'samtidigt' : 'sammadag';
    var span = function (e) { return e.winFirst == null ? 'tid ej fastställd' : fmt(e.winFirst) + (e.winLast !== e.winFirst ? '–' + fmt(e.winLast) : ''); };
    var reason = (a.team === b.team ? 'Samma lag har två olika poolspel/cuper samma dag' : 'Två Järfälla-lag spelar olika poolspel samma dag') +
      ' (' + span(a) + ' i ' + (a.venues.join(', ') || 'okänd hall') + ' och ' + span(b) + ' i ' + (b.venues.join(', ') || 'okänd hall') + ').';
    if (simultaneousElsewhere) reason += ov === 'ja' ? ' Poolspelen pågår dessutom samtidigt i olika hallar enligt källans tider.' :
      ' Poolspelen överlappar dessutom i olika hallar om sista matchen antas vara ' + L + ' min.';
    else if (ov === 'ja' || ov === 'trolig') reason += ' Samtidigt i samma hall.';
    else if (ov === null) reason += ' Starttid saknas för minst ett av poolspelen.';
    return { id: a.date.replace(/-/g, '') + '-' + [a.key, b.key].sort().join('~'), date: a.date, a: a, b: b,
      type: type, label: TYPES[type].label, severity: TYPES[type].severity, reason: reason,
      sameTeam: a.team === b.team, crossAge: a.age !== b.age, sameVenue: sv, overlap: ov,
      matchIds: a.matches.concat(b.matches) };
  }

  return { analyze: analyze, engagements: engagements, TYPES: TYPES, toMin: toMin, fmt: fmt };
});
