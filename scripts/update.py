#!/usr/bin/env python3
"""Hämtar Järfälla HC:s U9/U10-matcher, jämför med förra lyckade hämtningen
och skriver data till hemsidan.

Körs av GitHub Actions (se .github/workflows/update.yml), men går också att
köra lokalt:  python scripts/update.py

Filer:
  data/state.json          beständigt läge (senaste lyckade schema + historik)
  docs/data/schedule.json  det hemsidan läser

Avslutningskod 0 = allt hämtat, 2 = minst en källa misslyckades (hemsidan
uppdateras ändå med varning och senast fungerande schema behålls).
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swehockey import (  # noqa: E402
    BASE, FetchError, Fetcher, club_series_options, district_club_link, parse_schedule,
)
from bs4 import BeautifulSoup  # noqa: E402
from swehockey import page_info  # noqa: E402

ROOT = os.environ.get("JHC_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_PATH = os.path.join(ROOT, "data", "state.json")
SITE_PATH = os.path.join(ROOT, "docs", "data", "schedule.json")
STATE_VERSION = 1

LABELS = {
    "new": "NY MATCH",
    "date": "NYTT DATUM",
    "time": "NY TID",
    "venue": "NY ISHALL",
    "cancelled": "INSTÄLLD",
    "postponed": "UPPSKJUTEN",
    "missing": "SAKNAS I KÄLLAN",
    "returned": "TILLBAKA I KÄLLAN",
}


def now_utc() -> datetime:
    override = os.environ.get("JHC_NOW")  # för tester
    if override:
        return datetime.fromisoformat(override).astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=False)
        f.write("\n")
    os.replace(tmp, path)


def slug(s: str) -> str:
    s = s.lower()
    for a, b in (("å", "a"), ("ä", "a"), ("ö", "o"), ("é", "e")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def age_of(name: str, cfg) -> str | None:
    for age, pat in cfg["age_groups"].items():
        if re.search(pat, name, re.I):
            return age
    return None


def is_girls(name: str) -> bool:
    return bool(re.search(r"\bF\d+\b|\bU\d+F\b|flick|dam", name, re.I))


# ---------------------------------------------------------------- källor

def discover_sources(fetcher: Fetcher, cfg, log) -> tuple[list[dict], list[dict], str | None]:
    """Returnerar (valda källor, övriga källor från klubbsidan, fel)."""
    club = cfg["club"]
    try:
        district = fetcher.get(cfg["district_page"])
        club_link = district_club_link(district, club)
        if not club_link:
            raise FetchError(f"Hittade inte {club} på distriktssidan")
        club_html = fetcher.get(club_link)
        opts = club_series_options(club_html, club_link)
        if not opts:
            raise FetchError("Klubbsidan saknar lista över serier")
    except FetchError as e:
        return [], [], str(e)
    chosen, other = [], []
    seen = set()
    for sid, name, kind in opts:
        if sid in seen:
            continue
        seen.add(sid)
        rec = {"id": sid, "name": name, "kind": kind, "found_via": BASE + club_link}
        if sid in cfg.get("exclude_source_ids", []):
            other.append({**rec, "reason": "undantagen i config.json"})
        elif age_of(name, cfg):
            chosen.append(rec)
        else:
            other.append({**rec, "reason": "åldersgrupp U9/U10 framgår inte av namnet"})
    log(f"Klubbsidan listar {len(opts)} serier/cuper, {len(chosen)} gäller U9/U10")
    return chosen, other, None


def fetch_source_groups(fetcher: Fetcher, cfg, src: dict, log):
    """Hämtar en serie/cup och alla dess grupper. Returnerar lista av
    gruppresultat: {group_id, ok, error, info, games}."""
    results = []
    first_path = f"/ScheduleAndResults/Schedule/{src['id']}"
    try:
        first_html = fetcher.get(first_path)
    except FetchError as e:
        return [{"group_id": src["id"], "ok": False, "error": str(e), "games": [], "info": None}]
    soup = BeautifulSoup(first_html, "html.parser")
    info = page_info(soup)
    groups = [(gid, n) for gid, n in info.group_options]
    if not any(gid == src["id"] for gid, _ in groups):
        title = re.sub(r"\s*\|\s*stats\.swehockey\.se\s*$", "", info.title or "")
        groups = [(src["id"], title or info.heading or src["name"])]
    for gid, gname in groups:
        try:
            html_text = first_html if gid == src["id"] else fetcher.get(f"/ScheduleAndResults/Schedule/{gid}")
            ginfo, games = parse_schedule(html_text, gid)
            if not ginfo.has_table:
                raise FetchError("sidan saknar schematabell (ändrat sidformat?)")
            results.append({"group_id": gid, "group_name": gname, "ok": True, "error": None,
                            "info": ginfo, "games": games})
        except FetchError as e:
            results.append({"group_id": gid, "group_name": gname, "ok": False, "error": str(e),
                            "info": None, "games": []})
    return results


# ---------------------------------------------------------------- matcher

def team_record(name: str, age: str, girls: bool, series: str, club: str, cup: bool) -> dict:
    suffix = name[len(club):].strip() if name.startswith(club) else name
    agepart = f"{age}{' flickor' if girls else ''}"
    if cup:
        label = f"{agepart} {name} ({series})"
    elif suffix and re.fullmatch(r"[a-zåäöA-ZÅÄÖ]+", suffix):
        label = f"{agepart} {suffix}"
    else:
        label = f"{agepart} {name}"
    tid = f"{age}{'F' if girls else ''}:{name}" + (f"@{series}" if cup else "")
    return {"id": tid, "name": name, "age": age, "girls": girls, "label": label,
            "series": series, "cup": cup}


def build_matches(cfg, src: dict, group: dict, fetched_at: str):
    club = cfg["club"]
    age = age_of(src["name"], cfg) or age_of(group.get("group_name") or "", cfg)
    girls = is_girls(src["name"]) or is_girls(group.get("group_name") or "")
    gid = group["group_id"]
    url = f"{BASE}/ScheduleAndResults/Schedule/{gid}"
    games = [dict(g) for g in group["games"]]

    # Poolspel: saknar en rad egen tid gäller tiden på raden ovanför, om den
    # ligger i samma poolspel och samma ishall (två matcher spelas parallellt).
    prev = None
    for g in games:
        g["time_from_row_above"] = False
        if (g["start"] is None and prev is not None and g["format"] == "sammandrag"
                and prev["block"] == g["block"] and prev["start"] and not prev["time_from_row_above"]
                and (prev["venue"] or "") == (g["venue"] or "")):
            g["start"] = prev["start"]
            g["time_from_row_above"] = True
        prev = g

    # Kända starttider per sammandrag (från ALLA rader i källan, inte bara våra).
    block_times: dict[str, set] = {}
    block_host: dict[str, str] = {}
    for g in games:
        if g["start"]:
            block_times.setdefault(g["block"], set()).add(g["start"])
        if g.get("host"):
            block_host.setdefault(g["block"], g["host"])

    out, teams = [], {}
    occ: dict[str, int] = {}
    for g in games:
        ours = [t for t in (g["home"], g["away"]) if t.startswith(club)]
        if not ours:
            continue
        team_ids = []
        for t in ours:
            tr = team_record(t, age, girls, src["name"], club, src.get("kind") == "cup")
            teams[tr["id"]] = tr
            team_ids.append(tr["id"])
        if g["game_link_id"]:
            mid = f"g{g['game_link_id']}"
        elif g["game_no"]:
            mid = f"c{g['game_no']}"
        elif g["pool"] is not None:
            mid = f"s{gid}-p{g['pool']}-g{g['pool_game']}-" + "-".join(sorted(slug(x) for x in (g["home"], g["away"])))
        else:
            mid = f"x{gid}-{g['date']}-" + "-".join(sorted(slug(x) for x in (g["home"], g["away"])))
        occ[mid] = occ.get(mid, 0) + 1
        if occ[mid] > 1:
            mid = f"{mid}#{occ[mid]}"
        out.append({
            "id": mid,
            "age": age,
            "girls": girls,
            "teams": team_ids,
            "home": g["home"],
            "away": g["away"],
            "date": g["date"],
            "start": g["start"],
            "time_from_row_above": g["time_from_row_above"],
            "time_placeholder": g.get("time_placeholder", False),
            "venue": g["venue"],
            "host": block_host.get(g["block"]) if g["format"] == "sammandrag" else None,
            "block": g["block"],
            "block_kind": "cup" if src.get("kind") == "cup" or g["format"] == "cup" else "sammandrag",
            "block_times": sorted(block_times.get(g["block"], [])),
            "series": src["name"],
            "group": group.get("group_name") or "",
            "group_id": gid,
            "source_url": url,
            "status": g["status"],
            "row_seq": g["row_seq"],
        })
    return out, teams


def in_season(m, cfg) -> bool:
    return bool(m["date"]) and cfg["season_start"] <= m["date"] <= cfg["season_end"]


# ---------------------------------------------------------------- jämförelse

def summarize(m) -> dict:
    return {k: m.get(k) for k in ("date", "start", "venue", "home", "away", "age", "teams",
                                   "series", "group", "source_url", "block")}


def diff(prev: dict, cur: dict, ok_groups: set, missing_prev: dict, now: str):
    """prev/cur: {id: match}. Returnerar (ändringar, nytt missing-register)."""
    changes = []

    def add(kind, m, old=None, new=None):
        changes.append({"match_id": m["id"], "type": kind, "label": LABELS[kind],
                        "old": old, "new": new, "detected_at": now, "match": summarize(m)})

    for mid, m in cur.items():
        p = prev.get(mid)
        if p is None and mid in missing_prev:
            p = missing_prev[mid]["match"]
            add("returned", m)
        if p is None:
            add("new", m)
            continue
        if p.get("date") != m.get("date"):
            add("date", m, p.get("date"), m.get("date"))
        if p.get("start") != m.get("start"):
            add("time", m, p.get("start"), m.get("start"))
        if (p.get("venue") or "") != (m.get("venue") or ""):
            add("venue", m, p.get("venue"), m.get("venue"))
        if p.get("status") != m.get("status") and m.get("status") in ("inställd", "uppskjuten"):
            add("cancelled" if m["status"] == "inställd" else "postponed", m, p.get("status"), m.get("status"))

    missing = {k: v for k, v in missing_prev.items() if k not in cur}
    for mid, p in prev.items():
        if mid in cur or mid in missing:
            continue
        if p.get("group_id") in ok_groups:
            missing[mid] = {"since": now, "match": p}
            add("missing", p)
    return changes, missing


# ---------------------------------------------------------------- huvudflöde

def run(cfg, log=print) -> int:
    now_dt = now_utc()
    now = iso(now_dt)
    state = load_json(STATE_PATH, None)
    baseline_exists = bool(state and state.get("last_success"))
    if not state:
        state = {"version": STATE_VERSION, "matches": {}, "teams": {}, "changes": [],
                 "missing": {}, "sources": [], "other_sources": [], "runs": []}
    fetcher = Fetcher(delay=cfg.get("request_delay_seconds", 2.0))
    warnings = []

    # 1. Vilka källor?
    sources, other, disc_err = ([], [], None)
    if cfg.get("auto_discover", True):
        sources, other, disc_err = discover_sources(fetcher, cfg, log)
    if disc_err or not sources:
        if disc_err:
            warnings.append(f"Kunde inte läsa klubbsidan ({disc_err}). Senast kända källor används.")
        prev_src = [s for s in state.get("sources", []) if s.get("kind")]
        sources = [{"id": s["id"], "name": s["series"], "kind": s["kind"], "found_via": s.get("found_via")}
                   for s in prev_src] or [dict(s) for s in cfg.get("fallback_sources", [])]
        # en källa per serie-id
        uniq = {}
        for s in sources:
            uniq.setdefault(s["id"], s)
        sources = list(uniq.values())
        other = state.get("other_sources", [])
    for extra in cfg.get("extra_sources", []):
        if all(s["id"] != extra["id"] for s in sources):
            sources.append({**extra, "found_via": "config.json"})

    # 2. Hämta
    new_matches: dict[str, dict] = {}
    teams: dict[str, dict] = {}
    source_report, ok_groups, failed_groups = [], set(), set()
    seen_groups = set()
    for src in sources:
        log(f"Hämtar {src['name']} ({src['id']})")
        for grp in fetch_source_groups(fetcher, cfg, src, log):
            gid = grp["group_id"]
            if gid in seen_groups:
                continue
            seen_groups.add(gid)
            rep = {"id": gid, "series": src["name"], "group": grp.get("group_name"),
                   "kind": src.get("kind", "serie"), "url": f"{BASE}/ScheduleAndResults/Schedule/{gid}",
                   "found_via": src.get("found_via"), "ok": grp["ok"], "error": grp["error"],
                   "source_last_update": grp["info"].last_update if grp["info"] else None,
                   "matches": 0, "teams": [], "checked_at": now}
            if grp["ok"]:
                ms, ts = build_matches(cfg, src, grp, now)
                prev_count = sum(1 for m in state["matches"].values() if m.get("group_id") == gid)
                if not ms and prev_count > 0:
                    rep["ok"] = False
                    rep["error"] = (f"Inga {cfg['club']}-matcher i svaret, men {prev_count} fanns förra gången. "
                                    "Behandlas som hämtningsfel tills det bekräftas.")
                else:
                    outside = [m for m in ms if not in_season(m, cfg)]
                    if outside:
                        warnings.append(f"{len(outside)} matcher i {src['name']} ligger utanför säsongen "
                                        f"{cfg['season']} och visas inte.")
                    ms = [m for m in ms if in_season(m, cfg)]
                    for m in ms:
                        if m["id"] in new_matches:  # dubblett från annan vy
                            continue
                        new_matches[m["id"]] = m
                    teams.update(ts)
                    rep["matches"] = len(ms)
                    rep["teams"] = sorted({t for m in ms for t in m["teams"]})
            if rep["ok"]:
                ok_groups.add(gid)
            else:
                failed_groups.add(gid)
                warnings.append(f"Hämtningsfel för {src['name']} {grp.get('group_name') or ''}: {rep['error']}")
            source_report.append(rep)

    # 3. Behåll senast fungerande uppgifter för grupper som misslyckades
    for mid, m in state["matches"].items():
        if m.get("group_id") in failed_groups and mid not in new_matches:
            new_matches[mid] = {**m, "stale": True}
            for t in m["teams"]:
                if t in state["teams"]:
                    teams.setdefault(t, state["teams"][t])
    # grupper som inte längre finns med i någon källa men har gamla matcher
    for mid, m in state["matches"].items():
        if m.get("group_id") not in seen_groups and mid not in new_matches:
            if disc_err:
                new_matches[mid] = {**m, "stale": True}

    any_ok = bool(ok_groups)
    total_fail = not any_ok and bool(failed_groups or disc_err)

    # 4. Jämför (bara om det finns en baslinje och något hämtades)
    run_changes = []
    if baseline_exists and any_ok:
        prev = {k: v for k, v in state["matches"].items()}
        cur = {k: v for k, v in new_matches.items() if not v.get("stale")}
        # Matcher räknas som "saknade" bara om deras källa lästes utan fel
        # (eller om källan inte längre listas alls på en klubbsida som lästes).
        checkable = set(ok_groups)
        if not disc_err:
            checkable |= {m.get("group_id") for m in prev.values()} - seen_groups
        prev_cmp = {k: v for k, v in prev.items() if k in cur or v.get("group_id") in checkable}
        run_changes, state["missing"] = diff(prev_cmp, cur, checkable, state.get("missing", {}), now)
    elif any_ok:
        log("Ingen tidigare hämtning: baslinje skapas, inga ändringar markeras.")

    # first_seen
    for mid, m in new_matches.items():
        old = state["matches"].get(mid)
        m["first_seen"] = (old or {}).get("first_seen") or now

    if any_ok or not state["matches"]:
        state["matches"] = new_matches if any_ok else state["matches"]
        state["teams"] = {**state.get("teams", {}), **teams}
    state["changes"] = state.get("changes", []) + run_changes
    if any_ok:
        state["last_success"] = now
        if not baseline_exists:
            state["baseline_created"] = now
        # spara källförteckningen, men ersätt bara grupper som hämtats
        state["sources"] = source_report
        state["other_sources"] = other
    state["last_attempt"] = now
    state["last_attempt_ok"] = not failed_groups and not disc_err
    state.setdefault("runs", []).append({"at": now, "ok": state["last_attempt_ok"],
                                         "changes": len(run_changes), "requests": fetcher.requests_made,
                                         "warnings": warnings[:5]})
    state["runs"] = state["runs"][-60:]
    state["version"] = STATE_VERSION
    save_json(STATE_PATH, state)

    # 5. Data till hemsidan
    site = build_site_data(cfg, state, warnings, total_fail)
    save_json(SITE_PATH, site)
    log(f"Klart: {len(state['matches'])} matcher, {len(run_changes)} nya ändringar, "
        f"{len(failed_groups)} misslyckade grupper, {fetcher.requests_made} förfrågningar.")
    return 0 if state["last_attempt_ok"] else 2


def build_site_data(cfg, state, warnings, total_fail):
    matches = list(state["matches"].values())
    for mid, rec in state.get("missing", {}).items():
        m = {**rec["match"], "missing_since": rec["since"]}
        matches.append(m)
    matches.sort(key=lambda m: (m["date"] or "9999", m["start"] or "99:99", m["block"], m["row_seq"]))
    used_teams = {t for m in matches for t in m["teams"]}
    teams = [t for tid, t in state.get("teams", {}).items() if tid in used_teams]
    teams.sort(key=lambda t: (int(re.sub(r"\D", "", t["age"]) or 0), t["girls"], t["name"]))
    return {
        "generated_at": state["last_attempt"],
        "season": cfg["season"],
        "club": cfg["club"],
        "last_success": state.get("last_success"),
        "baseline_created": state.get("baseline_created"),
        "last_attempt": state.get("last_attempt"),
        "last_attempt_ok": state.get("last_attempt_ok"),
        "fetch_failed_completely": total_fail,
        "warnings": warnings,
        "settings": {**cfg["defaults"], "change_marker_days": cfg["change_marker_days"],
                     "stale_warning_days": cfg["stale_warning_days"]},
        "teams": teams,
        "sources": state.get("sources", []),
        "other_sources": state.get("other_sources", []),
        "matches": matches,
        "changes": state.get("changes", []),
    }


def main():
    cfg = load_json(os.path.join(ROOT, "config.json"), None)
    if cfg is None:
        print("config.json saknas", file=sys.stderr)
        return 1
    return run(cfg)


if __name__ == "__main__":
    sys.exit(main())
