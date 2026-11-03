/* Järfälla HC U9/U10 – matchöversikt. Ingen extern kod, inga cookies. */
(function () {
  'use strict';
  var TZ = 'Europe/Stockholm';
  var C = window.JHCConflicts;
  var D = null;            // data från schedule.json
  var S = {};              // inställningar (antaganden)
  var F = {};              // filter
  var ANALYSIS = { conflicts: [], engagements: [] };
  var CONF_BY_MATCH = {};  // match-id -> [konflikter]
  var TEAMS = {};
  var weekOffset = 0;

  // ------------------------------------------------------------ hjälp
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  // Dagens datum och klockslag i Stockholm (sommar-/vintertid via Intl).
  function nowSthlm() {
    var p = {};
    new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, min: parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10) };
  }
  function dateObj(d) { var a = d.split('-'); return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2], 12)); }
  function addDays(d, n) { var o = dateObj(d); o.setUTCDate(o.getUTCDate() + n); return o.toISOString().slice(0, 10); }
  function fmtDay(d) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(dateObj(d)).replace(/^./, function (c) { return c.toUpperCase(); }); }
  function fmtDayShort(d) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(dateObj(d)); }
  function fmtStamp(iso) { if (!iso) return '–'; return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
  function relDay(d) {
    var t = nowSthlm().date, diff = Math.round((dateObj(d) - dateObj(t)) / 864e5);
    if (diff === 0) return 'idag'; if (diff === 1) return 'imorgon'; if (diff === -1) return 'igår';
    if (diff > 1 && diff < 7) return 'om ' + diff + ' dagar';
    if (diff < 0) return 'spelad';
    return '';
  }
  function mondayOf(d) { var o = dateObj(d), wd = (o.getUTCDay() + 6) % 7; return addDays(d, -wd); }
  function isoWeek(d) { var o = dateObj(d); o.setUTCDate(o.getUTCDate() + 3 - ((o.getUTCDay() + 6) % 7)); var y = new Date(Date.UTC(o.getUTCFullYear(), 0, 4)); return 1 + Math.round(((o - y) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7); }

  var COLORS = { 'röd': '#d62828', 'blå': '#1f5fbf', 'vit': '#ffffff', 'svart': '#111111', 'gul': '#f2c200', 'grön': '#2a9d3a', 'orange': '#f08a00', 'lila': '#7b3fb0' };
  function teamDot(t) { var w = (t.name.split(' ').pop() || '').toLowerCase(); return COLORS[w] ? '<span class="dot" style="background:' + COLORS[w] + '" aria-hidden="true"></span>' : ''; }
  function teamTag(id) { var t = TEAMS[id] || { label: id, age: '?', name: id }; return '<span class="tag ' + esc(t.age) + '">' + esc(t.age) + '</span> <span class="team">' + teamDot(t) + esc(t.label.replace(/^U\d+\s*/, '')) + '</span>'; }

  function isPlayed(m) {
    var n = nowSthlm();
    if (m.date < n.date) return true;
    if (m.date > n.date) return false;
    var t = C.toMin(m.start) || (m.block_times && m.block_times.length ? C.toMin(m.block_times[m.block_times.length - 1]) : null);
    return t != null && t + Number(S.match_minutes) < n.min;
  }
  function recentChanges() {
    var limit = Date.now() - (D.settings.change_marker_days || 14) * 864e5;
    return D.changes.filter(function (c) { return new Date(c.detected_at).getTime() >= limit; });
  }
  function changesFor(mid) { return recentChanges().filter(function (c) { return c.match_id === mid; }); }

  // ------------------------------------------------------------ filter
  function readFilters() {
    F.U9 = $('f-U9').checked; F.U10 = $('f-U10').checked;
    F.from = $('f-from').value; F.to = $('f-to').value;
    F.onlyConf = $('f-conf').checked; F.played = $('f-played').checked;
    $('q-conf').checked = F.onlyConf;
    F.teams = {};
    document.querySelectorAll('#team-filter input').forEach(function (i) { F.teams[i.value] = i.checked; });
    var off = Object.keys(F.teams).filter(function (k) { return !F.teams[k]; }).length;
    var parts = [];
    if (!F.U9 || !F.U10) parts.push(F.U9 ? 'bara U9' : F.U10 ? 'bara U10' : 'ingen ålder vald');
    if (off) parts.push(off + ' lag dolda');
    if (F.from || F.to) parts.push('datum ' + (F.from || '…') + ' – ' + (F.to || '…'));
    if (F.played) parts.push('inkl. spelade');
    if (F.onlyConf) parts.push('endast krockar');
    $('f-summary').textContent = parts.length ? '(' + parts.join(', ') + ')' : '(alla lag, kommande matcher)';
  }
  function passes(m) {
    if (!F[m.age]) return false;
    if (!m.teams.some(function (t) { return F.teams[t] !== false; })) return false;
    if (!F.played && isPlayed(m)) return false;
    if (F.from && m.date < F.from) return false;
    if (F.to && m.date > F.to) return false;
    if (F.onlyConf && !CONF_BY_MATCH[m.id]) return false;
    return true;
  }

  // ------------------------------------------------------------ analys
  function analyze() {
    ANALYSIS = C.analyze(D.matches, S);
    CONF_BY_MATCH = {};
    ANALYSIS.conflicts.forEach(function (c) {
      c.matchIds.forEach(function (id) { (CONF_BY_MATCH[id] = CONF_BY_MATCH[id] || []).push(c); });
    });
    var n = nowSthlm().date;
    var upcoming = ANALYSIS.days.filter(function (d) { return d.date >= n; }).length;
    $('conf-count').textContent = upcoming ? String(upcoming) : '';
  }

  // ------------------------------------------------------------ rendering
  function badgesFor(m) {
    var h = '';
    changesFor(m.id).forEach(function (c) { h += '<span class="b chg" title="Upptäckt ' + esc(fmtStamp(c.detected_at)) + '">' + esc(c.label) + '</span>'; });
    if (m.missing_since) h += '<span class="b miss" title="Matchen fanns i en tidigare hämtning men inte i den senaste. Den är inte nödvändigtvis inställd.">SAKNAS I KÄLLAN</span>';
    if (m.status === 'inställd') h += '<span class="b conf">INSTÄLLD</span>';
    if (m.status === 'uppskjuten') h += '<span class="b poss">UPPSKJUTEN</span>';
    if (m.stale) h += '<span class="b stale" title="Källan kunde inte läsas vid senaste kontrollen. Visar senast kända uppgifter.">EJ KONTROLLERAD NU</span>';
    return h;
  }
  function worst(cs) {
    if (!cs || !cs.length) return null;
    return cs.slice().sort(function (a, b) { return b.severity - a.severity; })[0];
  }
  var SHORT = { samtidigt: '⚠ KROCK: SAMMA DAG + SAMTIDIGT', sammadag: '⚠ KROCK: SAMMA DAG' };
  function confBadge(c, n) {
    return '<span class="b conf" title="' + esc(c.label + ': ' + c.reason) + '">' + SHORT[c.type] + '</span>';
  }
  function oldNew(m) {
    return changesFor(m.id).filter(function (c) { return c.old != null || c.new != null; }).map(function (c) {
      return '<div class="oldnew">' + esc(c.label) + ': <span class="strike">' + esc(c.old || 'ej angiven') + '</span> → <strong>' + esc(c.new || 'ej angiven') + '</strong> <span class="small">(upptäckt ' + esc(fmtStamp(c.detected_at)) + ')</span></div>';
    }).join('');
  }
  function timeCell(m) {
    if (!m.start) return '<span class="t none">Tid ej fastställd</span>';
    return '<span class="t"' + (m.time_from_row_above ? ' title="Matchen saknar egen tid i källan. Tiden gäller från raden ovanför i samma poolspel och ishall."' : '') + '>' + esc(m.start) + (m.time_from_row_above ? '<sup aria-label="tid från raden ovanför">*</sup>' : '') + '</span>';
  }
  function gameLine(m) {
    return '<li>' + timeCell(m) + '<span>' + esc(m.home) + ' – ' + esc(m.away) + '</span>' +
      '<span class="badges">' + badgesFor(m) + '</span>' + oldNew(m) + '</li>';
  }

  function groupBlocks(ms) {
    var days = {}, order = [];
    ms.forEach(function (m) {
      if (!days[m.date]) { days[m.date] = {}; order.push(m.date); }
      var key = m.block + '|' + m.teams.join(',');
      (days[m.date][key] = days[m.date][key] || []).push(m);
    });
    return order.sort().map(function (d) {
      var blocks = Object.keys(days[d]).map(function (k) { return days[d][k]; });
      blocks.sort(function (a, b) { return firstTime(a) - firstTime(b); });
      return { date: d, blocks: blocks };
    });
  }
  function firstTime(ms) {
    var t = ms.map(function (m) { return C.toMin(m.start); }).filter(function (x) { return x != null; });
    if (!t.length) t = (ms[0].block_times || []).map(C.toMin);
    return t.length ? Math.min.apply(null, t) : 9999;
  }

  function blockCard(ms) {
    var m0 = ms[0];
    var known = ms.filter(function (m) { return m.start; }).length;
    var kind = m0.block_kind === 'cup' ? 'Cup' : 'Poolspel';
    var allc = []; ms.forEach(function (m) { allc = allc.concat(CONF_BY_MATCH[m.id] || []); });
    var wc = worst(allc);
    var others = {};
    allc.forEach(function (c) { [c.a, c.b].forEach(function (e) { if (e.block !== m0.block || m0.teams.indexOf(e.team) < 0) others[e.team] = 1; }); });
    var bt = m0.block_times || [];
    var span = bt.length ? 'Poolspelets angivna starttider: ' + esc(bt[0]) + (bt.length > 1 ? '–' + esc(bt[bt.length - 1]) : '') : 'Inga starttider angivna i källan ännu';
    var h = '<article class="block age-' + esc(m0.age) + (ms.every(isPlayed) ? ' played' : '') + '">';
    h += '<div class="bhead">' + m0.teams.map(teamTag).join(' + ') + '<span class="where">📍 ' + esc(m0.venue || 'Ishall ej angiven') + '</span></div>';
    if (wc) h += '<div class="badges" style="margin:4px 0">' + confBadge(wc) + '<span class="small">även: ' + Object.keys(others).map(function (t) { return esc((TEAMS[t] || {}).label || t); }).join(', ') + '</span></div>';
    h += '<div class="small">' + kind + ' · ' + esc(m0.series) + (m0.group && m0.group !== m0.series ? ' · ' + esc(m0.group) : '') +
      (m0.host ? ' · Värd: ' + esc(m0.host) : '') + '</div>';
    if (m0.block_kind !== 'cup') h += '<div class="small">' + span + (known < ms.length ? ' · ' + (ms.length - known) + ' av lagets ' + ms.length + ' matcher saknar tid' : '') + '</div>';
    h += '<ul class="games">' + ms.map(gameLine).join('') + '</ul>';
    if (ms.some(function (m) { return m.time_from_row_above; })) h += '<div class="small">* Ingen egen tid i källan – tiden på raden ovanför i samma poolspel och ishall gäller (matcherna spelas parallellt).</div>';
    h += '<div class="small"><a href="' + esc(m0.source_url) + '" target="_blank" rel="noopener">Källa på stats.swehockey.se</a></div>';
    return h + '</article>';
  }

  function renderList() {
    var ms = D.matches.filter(passes);
    var el = $('view-list');
    if (!ms.length) { el.innerHTML = '<p class="empty">Inga matcher matchar filtret.</p>'; return; }
    el.innerHTML = groupBlocks(ms).map(function (g) {
      var r = relDay(g.date);
      return '<div class="day"><h3>' + esc(fmtDay(g.date)) + (r ? ' <span class="rel">· ' + r + '</span>' : '') + '</h3>' + g.blocks.map(blockCard).join('') + '</div>';
    }).join('');
  }

  function renderNext() {
    var n = nowSthlm();
    var up = D.matches.filter(function (m) { return !isPlayed(m) && !m.missing_since && m.status === 'planerad'; });
    var days = groupBlocks(up).slice(0, 1);
    var h = days.map(function (g) {
      return '<p><strong>' + esc(fmtDay(g.date)) + '</strong> <span class="small">' + esc(relDay(g.date)) + '</span></p><ul class="mini">' + g.blocks.map(function (ms) {
        var t = ms.map(function (m) { return m.start; }).filter(Boolean);
        var all = []; ms.forEach(function (m) { all = all.concat(CONF_BY_MATCH[m.id] || []); });
        var w = worst(all);
        return '<li>' + ms[0].teams.map(teamTag).join(' + ') + ' · ' + (t.length ? esc(t[0]) + (t.length > 1 ? '–' + esc(t[t.length - 1]) : '') : '<span class="t none">Tid ej fastställd</span>') +
          ' · ' + esc(ms[0].venue || '') + (w ? ' ' + confBadge(w, 0) : '') + '</li>';
      }).join('') + '</ul>';
    }).join('');
    $('next').innerHTML = (h || '<p class="empty">Inga kommande matcher publicerade.</p>') + (days.length ? '<p class="more small">Hela listan finns nedan. Tider är starttider enligt källan.</p>' : '');
  }

  function changeRow(c) {
    var m = c.match || {};
    var who = (m.teams || []).map(teamTag).join(' + ');
    var detail = (c.old != null || c.new != null) ? ': <span class="strike">' + esc(c.old || 'ej angiven') + '</span> → <strong>' + esc(c.new || 'ej angiven') + '</strong>' : '';
    return '<li><span class="b ' + (c.type === 'missing' ? 'miss' : 'chg') + '">' + esc(c.label) + '</span>' + esc(detail ? '' : '') + detail + '<br>' + who + ' · ' + esc(m.home) + ' – ' + esc(m.away) +
      ' · ' + esc(m.date ? fmtDayShort(m.date) : '') + ' ' + esc(m.start || '') + ' · ' + esc(m.venue || '') +
      '<br><span class="small">Upptäckt ' + esc(fmtStamp(c.detected_at)) + ' (när vår kontroll såg ändringen – inte när arrangören gjorde den) · <a href="' + esc(m.source_url) + '" target="_blank" rel="noopener">källa</a></span></li>';
  }
  function renderRecent() {
    $('chg-days').textContent = '(senaste ' + (D.settings.change_marker_days || 14) + ' dagarna)';
    var rc = recentChanges().filter(function (c) { return !c.match || F[c.match.age] !== false; }).slice().reverse();
    var h;
    if (!rc.length) {
      h = '<p class="empty">Inga ändringar upptäckta' + (D.baseline_created && new Date(D.baseline_created) > Date.now() - 15 * 864e5 ? ' sedan bevakningen startade ' + esc(fmtStamp(D.baseline_created)) + ' (första hämtningen är en baslinje).' : '.') + '</p>';
    } else {
      h = '<ul class="mini">' + rc.slice(0, 6).map(changeRow).join('') + '</ul>' + (rc.length > 6 ? '<p class="more"><button class="linkbtn" data-goto="history">Visa alla ' + rc.length + ' ändringar</button></p>' : '');
    }
    $('recent-changes').innerHTML = h;
  }
  function renderHistory() {
    var all = D.changes.slice().reverse();
    $('view-history').innerHTML = '<h2>Ändringshistorik</h2><p class="small">Alla ändringar som kontrollen har upptäckt. Markeringar i listan visas i ' + (D.settings.change_marker_days || 14) +
      ' dagar. ”Saknas i källan” betyder att matchen inte fanns med i senaste hämtningen – den behöver inte vara inställd.</p>' +
      (all.length ? '<ul class="mini panel">' + all.map(changeRow).join('') + '</ul>' : '<p class="empty">Inga ändringar ännu. Baslinje skapad ' + esc(fmtStamp(D.baseline_created)) + '.</p>');
  }

  function engLine(e) {
    var ms = D.matches.filter(function (m) { return e.matches.indexOf(m.id) >= 0; });
    var times = e.ownTimes.map(C.fmt).join(', ');
    return '<div class="side">' + teamTag(e.team) + '<br>📍 ' + esc(e.venues.join(', ') || 'Ishall ej angiven') +
      '<br>Poolspelets starttider: <strong>' + (e.winFirst != null ? C.fmt(e.winFirst) + (e.winLast !== e.winFirst ? '–' + C.fmt(e.winLast) : '') : 'inga angivna') + '</strong>' +
      '<br><span class="small">' + ms.map(function (m) { return esc((m.start || '??:??') + ' ' + m.home + ' – ' + m.away); }).join('<br>') + '</span>' +
      (ms[0] ? '<br><a class="small" href="' + esc(ms[0].source_url) + '" target="_blank" rel="noopener">Källa</a>' : '') + '</div>';
  }
  function renderConflicts() {
    var n = nowSthlm().date;
    var days = ANALYSIS.days.filter(function (d) {
      if (!F.played && d.date < n) return false;
      if (F.from && d.date < F.from) return false;
      if (F.to && d.date > F.to) return false;
      return d.engagements.some(function (e) { var t = TEAMS[e.team] || {}; return F[t.age] && F.teams[e.team] !== false; });
    });
    var h = '<h2>Krockar – flera poolspel samma dag</h2><p class="small">Spelarna orkar i regel inte mer än ett poolspel per dag. Därför markeras varje dag då två eller fler Järfälla-lag (inom U9, inom U10 eller mellan U9 och U10) spelar <strong>olika</strong> poolspel eller cuper. ' +
      'Lag som spelar i samma poolspel räknas inte som krock. ⚠⚠ betyder att poolspelen dessutom pågår samtidigt i olika hallar.</p>';
    if (!days.length) h += '<p class="empty">Inga krockar med nuvarande filter.</p>';
    h += days.map(function (d) {
      var sim = d.pairs.filter(function (p) { return p.type === 'samtidigt'; });
      var rows = d.engagements.map(function (e) {
        var ms = D.matches.filter(function (m) { return e.matches.indexOf(m.id) >= 0; });
        var t = e.winFirst != null ? C.fmt(e.winFirst) + (e.winLast !== e.winFirst ? '–' + C.fmt(e.winLast) : '') : '<span class="t none">Tid ej fastställd</span>';
        return '<tr><td>' + teamTag(e.team) + '</td><td class="t">' + t + '</td><td>' + esc(e.venues.join(', ') || '–') + '</td><td class="small">' +
          (ms[0] ? esc(ms[0].block_kind === 'cup' ? ms[0].series : 'Poolspel ' + ms[0].series) + ' · <a href="' + esc(ms[0].source_url) + '" target="_blank" rel="noopener">källa</a>' : '') + '</td></tr>';
      }).join('');
      return '<article class="conf sev-' + d.severity + '"><h4>' + (sim.length ? '⚠⚠ ' : '⚠ ') + esc(fmtDay(d.date)) + ' – ' + d.engagements.length + ' poolspel/cuper samma dag</h4>' +
        '<div style="overflow-x:auto"><table class="src"><thead><tr><th>Lag</th><th>Tider</th><th>Ishall</th><th>Poolspel</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        (sim.length ? '<div class="why"><strong>Samtidigt i olika hallar:</strong><br>' + sim.map(function (p) {
          return teamTag(p.a.team) + ' (' + esc(p.a.venues.join(', ')) + ') och ' + teamTag(p.b.team) + ' (' + esc(p.b.venues.join(', ')) + ')' + (p.overlap === 'trolig' ? ' <span class="small">– med antagen matchlängd ' + S.match_minutes + ' min</span>' : '');
        }).join('<br>') + '</div>' : '') +
        (d.pairs.some(function (p) { return p.sameTeam; }) ? '<div class="ctx">Obs: samma lag har två olika poolspel/cuper denna dag.</div>' : '') +
        '</article>';
    }).join('');
    $('view-conflicts').innerHTML = h;
  }

  function renderWeek() {
    var today = nowSthlm().date;
    var base = F.from && F.from > today ? F.from : today;
    var mon = addDays(mondayOf(base), weekOffset * 7), sun = addDays(mon, 6);
    var ms = D.matches.filter(function (m) { return m.date >= mon && m.date <= sun && F[m.age] && m.teams.some(function (t) { return F.teams[t] !== false; }) && (!F.onlyConf || CONF_BY_MATCH[m.id]); });
    var es = ANALYSIS.engagements.filter(function (e) { return ms.some(function (m) { return e.matches.indexOf(m.id) >= 0; }); });
    var h = '<div class="weeknav no-print"><button class="btn" id="wk-prev" aria-label="Föregående vecka">←</button><strong>Vecka ' + isoWeek(mon) + ': ' + esc(fmtDayShort(mon)) + ' – ' + esc(fmtDayShort(sun)) + '</strong><button class="btn" id="wk-next" aria-label="Nästa vecka">→</button><button class="linkbtn" id="wk-today">Denna vecka</button></div>';
    h += '<p class="small">Varje lag har ett eget spår. Stapeln = poolspelet, från första till sista starttid plus antagen längd på sista matchen (' + S.match_minutes + ' min). Svarta streck = angivna starttider. Röd ram = krock (fler än ett poolspel för Järfälla samma dag).</p>';
    var days = {};
    es.forEach(function (e) { (days[e.date] = days[e.date] || []).push(e); });
    var dates = Object.keys(days).sort();
    if (!dates.length) h += '<p class="empty">Inga matcher denna vecka med nuvarande filter.</p>';
    dates.forEach(function (d) {
      var list = days[d];
      var mins = [], maxs = [];
      list.forEach(function (e) { if (e.winFirst != null) { mins.push(e.winFirst); maxs.push(e.winLast + Number(S.match_minutes)); } });
      var lo = mins.length ? Math.floor((Math.min.apply(null, mins) - 30) / 60) * 60 : 8 * 60;
      var hi = maxs.length ? Math.ceil((Math.max.apply(null, maxs) + 30) / 60) * 60 : 18 * 60;
      if (hi - lo < 180) hi = lo + 180;
      function pct(x) { return ((x - lo) / (hi - lo) * 100).toFixed(2) + '%'; }
      var lanes = {};
      list.forEach(function (e) { (lanes[e.team] = lanes[e.team] || []).push(e); });
      var teamOrder = Object.keys(lanes).sort(function (a, b) { var A = TEAMS[a] || {}, B = TEAMS[b] || {}; return (A.age || '').length - (B.age || '').length || (A.label || a).localeCompare(B.label || b, 'sv'); });
      var axis = '', grid = '';
      for (var x = lo; x <= hi; x += 60) { axis += '<span style="left:' + pct(x) + '">' + C.fmt(x).slice(0, 2) + '</span>'; grid += '<span class="gridline" style="left:' + pct(x) + '"></span>'; }
      h += '<div class="tl"><h3>' + esc(fmtDay(d)) + '</h3><div class="tl-scroll"><div class="tl-grid"><div class="tl-axis">' + axis + '</div>';
      teamOrder.forEach(function (tid) {
        var t = TEAMS[tid] || { label: tid, age: '' };
        h += '<div class="lane"><div class="lane-label"><span class="tag ' + esc(t.age) + '">' + esc(t.age) + '</span><br>' + teamDot(t) + esc(t.label.replace(/^U\d+\s*/, '')) + '</div><div class="lane-track">' + grid;
        lanes[tid].forEach(function (e) {
          var conflict = ANALYSIS.conflicts.some(function (c) { return c.a === e || c.b === e; });
          var tight = false;
          var venue = esc(e.venues.join(', '));
          if (e.winFirst == null) { h += '<span class="bar notime" title="Starttid saknas i källan">Tid saknas · ' + venue + '</span>'; return; }
          var L = Number(S.match_minutes);
          var est = false;
          h += '<span class="bar ' + esc(t.age) + (est ? ' est' : '') + (conflict ? ' conflict' : '') + (tight ? ' tight' : '') + '" style="left:' + pct(e.winFirst) + ';width:calc(' + pct(e.winLast + L) + ' - ' + pct(e.winFirst) + ')" title="' + esc(t.label + ' · ' + e.venues.join(', ') + ' · ' + C.fmt(e.winFirst) + '–' + C.fmt(e.winLast + L) + (est ? ' (delvis uppskattat)' : '')) + '">' +
            C.fmt(e.winFirst) + ' ' + venue + '</span>';
          e.times.forEach(function (tm) { h += '<span class="tick" style="left:' + pct(tm) + '" title="Angiven start ' + C.fmt(tm) + '"></span>'; });
        });
        h += '</div></div>';
      });
      h += '</div></div></div>';
    });
    $('view-week').innerHTML = h;
    $('wk-prev').onclick = function () { weekOffset--; renderWeek(); };
    $('wk-next').onclick = function () { weekOffset++; renderWeek(); };
    $('wk-today').onclick = function () { weekOffset = 0; renderWeek(); };
  }

  function renderAbout() {
    var lg = [
      ['NY TID / NYTT DATUM / NY ISHALL', 'Uppgiften har ändrats sedan föregående kontroll. Gammalt och nytt värde visas, samt när vår kontroll upptäckte ändringen (inte när arrangören gjorde den).'],
      ['NY MATCH', 'Matchen fanns inte i föregående hämtning.'],
      ['SAKNAS I KÄLLAN', 'Matchen fanns tidigare men inte i senaste hämtningen. Den är inte automatiskt inställd – kontrollera med arrangören.'],
      ['INSTÄLLD', 'Visas bara om källan uttryckligen anger att matchen är inställd.'],
      ['Tid med *', 'Matchen saknar egen tid i källan. I poolspel spelas två matcher parallellt och bara den första raden har tid, så tiden på raden ovanför (samma poolspel och samma ishall) gäller.'],
      ['Tid ej fastställd', 'Källan har ingen tid för matchen (eller anger 00:00, som betyder att tiden inte är satt) och ingen tid på raden ovanför i samma poolspel. Vi gissar aldrig tider.'],
      ['⚠ KROCK: SAMMA DAG', 'Två eller fler Järfälla-lag (U9 och/eller U10) spelar olika poolspel eller cuper samma dag. Spelarna orkar i regel bara ett poolspel per dag.'],
      ['⚠ KROCK: SAMMA DAG + SAMTIDIGT', 'Som ovan, och poolspelen pågår dessutom samtidigt i olika hallar (enligt källans tider, eller med antagen matchlängd).'],
      ['Ingen krock', 'Ett lags tre matcher i samma poolspel, och Järfälla-lag som spelar i samma poolspel, räknas inte som krock.']
    ];
    $('legend').innerHTML = lg.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('');
    var rows = D.sources.map(function (s) {
      return '<tr><td><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.series) + (s.group && s.group !== s.series ? ' – ' + esc(s.group) : '') + '</a></td><td>' + (s.ok ? '✔ läst' : '✖ ' + esc(s.error || 'fel')) +
        '</td><td>' + s.matches + '</td><td>' + (s.teams || []).map(function (t) { return esc((TEAMS[t] || {}).label || t); }).join(', ') + '</td><td>' + esc(s.source_last_update || '–') + '</td></tr>';
    }).join('');
    var other = (D.other_sources || []).map(function (o) { return esc(o.name) + ' <span class="small">(' + esc(o.reason) + ')</span>'; }).join('<br>');
    $('sources').innerHTML = '<p class="small">Säsong ' + esc(D.season) + '. Källorna hittas automatiskt via föreningens sida på stats.swehockey.se. Senast lyckade kontroll: <strong>' + esc(fmtStamp(D.last_success)) + '</strong>. Senaste försök: ' + esc(fmtStamp(D.last_attempt)) + '.</p>' +
      '<div style="overflow-x:auto"><table class="src"><thead><tr><th>Serie / grupp</th><th>Status</th><th>JHC-matcher</th><th>Lag</th><th>Källans ”Last update”</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (other ? '<h3>Övriga serier/cuper på föreningens sida (ej medtagna)</h3><p class="small">' + other + '</p>' : '') +
      '<h3>Kända luckor</h3><ul class="small"><li>Cuper och matcher som inte är publicerade på stats.swehockey.se (t.ex. i andra system eller bara via mejl) syns inte här.</li><li>Cuper vars namn inte anger U9/U10 tas inte med automatiskt (se listan ovan) – de kan läggas till i config.json.</li><li>Källan anger inga sluttider och för U9/U10 inga resultat. Spelad/kommande avgörs av datum och tid.</li></ul>';
  }

  function renderAlerts() {
    var h = '';
    var ageDays = D.last_success ? (Date.now() - new Date(D.last_success).getTime()) / 864e5 : Infinity;
    if (D.fetch_failed_completely || D.last_attempt_ok === false) {
      h += '<div class="alert err"><strong>Senaste kontrollen misslyckades helt eller delvis (' + esc(fmtStamp(D.last_attempt)) + ').</strong>Senast fungerande schema visas. ' + (D.warnings || []).map(esc).join(' ') + '</div>';
    } else if (D.warnings && D.warnings.length) {
      h += '<div class="alert warn"><strong>Observera</strong>' + D.warnings.map(esc).join('<br>') + '</div>';
    }
    if (ageDays > (D.settings.stale_warning_days || 7)) {
      h += '<div class="alert err"><strong>Schemat kan vara inaktuellt.</strong>Senaste lyckade kontroll var ' + esc(fmtStamp(D.last_success)) + ' (mer än ' + (D.settings.stale_warning_days || 7) + ' dagar sedan). Kontrollera källan direkt.</div>';
    }
    $('alerts').innerHTML = h;
    $('meta').innerHTML = 'Säsong ' + esc(D.season) + ' · Senast kontrollerad ' + esc(fmtStamp(D.last_success)) + ' · Källa: <a href="https://stats.swehockey.se/">stats.swehockey.se</a>';
  }

  function renderTeamFilter() {
    var saved = store('jhc-teams') || {};
    var h = '<span class="flabel">Lag</span>' + D.teams.map(function (t) {
      return '<label class="chip age-' + esc(t.age) + '"><input type="checkbox" value="' + esc(t.id) + '"' + (saved[t.id] === false ? '' : ' checked') + '> ' + esc(t.age) + ' ' + teamDot(t) + esc(t.label.replace(/^U\d+\s*/, '')) + '</label>';
    }).join('');
    $('team-filter').innerHTML = h;
  }

  function renderAll() {
    readFilters();
    store('jhc-teams', F.teams);
    renderAlerts(); renderNext(); renderRecent(); renderList(); renderConflicts(); renderWeek(); renderHistory(); renderAbout();
  }

  // ------------------------------------------------------------ init
  function setTab(name) {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
    $('filters').hidden = name === 'about' || name === 'history';
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* ok */ }
  }

  function loadSettings() {
    var d = D.settings, s = store('jhc-settings') || {};
    S = { match_minutes: s.match_minutes != null ? s.match_minutes : d.match_minutes };
    $('s-len').value = S.match_minutes;
  }

  function init(data) {
    D = data;
    D.teams.forEach(function (t) { TEAMS[t.id] = t; });
    loadSettings();
    renderTeamFilter();
    $('f-from').value = ''; $('f-to').value = '';
    analyze();
    renderAll();
    document.querySelector('.tabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
    document.body.addEventListener('click', function (e) { var b = e.target.closest('[data-goto]'); if (b) { setTab(b.dataset.goto); window.scrollTo(0, $('view-' + b.dataset.goto).offsetTop - 10); } });
    $('filters').addEventListener('change', function (e) {
      if (e.target.id === 'q-conf') $('f-conf').checked = e.target.checked;
      renderAll();
    });
    if (window.matchMedia && window.matchMedia('(min-width: 760px)').matches) $('filterbox').open = true;
    $('f-reset').onclick = function () {
      $('f-U9').checked = $('f-U10').checked = true; $('f-conf').checked = $('f-played').checked = false; $('f-from').value = $('f-to').value = '';
      document.querySelectorAll('#team-filter input').forEach(function (i) { i.checked = true; });
      weekOffset = 0; renderAll();
    };
    $('settings').addEventListener('input', function () {
      S = { match_minutes: +$('s-len').value || 0 };
      store('jhc-settings', S); analyze(); renderAll();
    });
    $('s-reset').onclick = function () { try { localStorage.removeItem('jhc-settings'); } catch (e) { /* ok */ } loadSettings(); analyze(); renderAll(); };
    $('print').onclick = function () { setTab('list'); setTimeout(function () { window.print(); }, 50); };
    var h = (location.hash || '').slice(1);
    setTab(['list', 'week', 'conflicts', 'history', 'about'].indexOf(h) >= 0 ? h : 'list');
  }

  if (window.JHC_DATA) { init(window.JHC_DATA); return; }
  fetch('data/schedule.json', { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(init).catch(function (e) {
    $('meta').textContent = 'Kunde inte läsa schemat.';
    $('alerts').innerHTML = '<div class="alert err"><strong>Schemadata kunde inte laddas.</strong>' + esc(e.message) + '. Försök ladda om sidan.</div>';
  });
})();
