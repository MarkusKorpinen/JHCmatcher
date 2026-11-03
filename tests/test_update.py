"""Tester för hämtning, jämförelse och felhantering.

Kör:  python -m unittest discover -s tests -v
Testerna använder sparade kopior av riktiga sidor från stats.swehockey.se
(tests/fixtures, hämtade 2026-11-03) och ändrar dem för att simulera
schemaändringar och fel. Inga nätverksanrop görs.
"""
import copy
import json
import os
import re
import shutil
import sys
import tempfile
import unittest

from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import swehockey  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
U9G1 = "ScheduleAndResults_Schedule_22070.html"


def load_cfg():
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        return json.load(f)


class Env:
    """Tillfällig projektkatalog + kopia av testsidorna."""

    def __init__(self):
        self.root = tempfile.mkdtemp(prefix="jhc-root-")
        self.fix = tempfile.mkdtemp(prefix="jhc-fix-")
        for fn in os.listdir(FIX):
            shutil.copy(os.path.join(FIX, fn), self.fix)
        os.environ["JHC_ROOT"] = self.root
        os.environ["SWEHOCKEY_FIXTURES"] = self.fix

    def run(self, now, cfg=None):
        os.environ["JHC_NOW"] = now
        import importlib
        import update
        importlib.reload(update)
        code = update.run(cfg or load_cfg(), log=lambda *a: None)
        with open(os.path.join(self.root, "docs", "data", "schedule.json"), encoding="utf-8") as f:
            site = json.load(f)
        with open(os.path.join(self.root, "data", "state.json"), encoding="utf-8") as f:
            state = json.load(f)
        return code, site, state

    def soup(self, fn):
        with open(os.path.join(self.fix, fn), encoding="utf-8") as f:
            return BeautifulSoup(f.read(), "html.parser")

    def save(self, fn, soup):
        with open(os.path.join(self.fix, fn), "w", encoding="utf-8") as f:
            f.write(str(soup))

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.fix, ignore_errors=True)


def jhc_rows(soup, pred=None):
    tbl = soup.find("table", class_="tblContent")
    out = []
    for tr in tbl.find_all("tr"):
        txt = re.sub(r"\s+", " ", tr.get_text(" "))
        game = tr.find("span", class_="lnkTooltip")
        if game and "Järfälla HC" in game.get_text() and (pred is None or pred(tr, txt)):
            out.append(tr)
    return out


def future(tr, txt):
    m = re.search(r"(20\d\d-\d\d-\d\d)", txt)
    return m and m.group(1) >= "2026-11-14"


def time_td(tr):
    for td in tr.find_all("td"):
        if re.fullmatch(r"\s*\d\d:\d\d\s*", td.get_text()):
            return td
    return None


class ParserTests(unittest.TestCase):
    def test_series_page(self):
        with open(os.path.join(FIX, U9G1), encoding="utf-8") as f:
            info, games = swehockey.parse_schedule(f.read(), 22070)
        self.assertTrue(info.has_table)
        self.assertEqual(info.last_update, "2026-11-03 11:08")
        self.assertEqual(sorted(g for g, _ in info.group_options), [22070, 22071, 22072, 22073, 22074])
        self.assertGreater(len(games), 250)
        # Varje sammandrag har 6 matcher och tre angivna tider
        blocks = {}
        for g in games:
            blocks.setdefault(g["block"], []).append(g)
        full = [b for b in blocks.values() if len(b) == 6]
        self.assertTrue(len(full) > 40)
        # Saknade tider blir None – aldrig gissade
        self.assertTrue(any(g["start"] is None for g in games))
        for g in games:
            if g["start"]:
                self.assertRegex(g["start"], r"^\d\d:\d\d$")

    def test_cup_page(self):
        with open(os.path.join(FIX, "ScheduleAndResults_Schedule_22042.html"), encoding="utf-8") as f:
            info, games = swehockey.parse_schedule(f.read(), 22042)
        self.assertEqual(len(games), 20)
        g = games[0]
        self.assertEqual((g["date"], g["start"], g["home"], g["away"], g["venue"], g["game_no"]),
                         ("2026-09-26", "08:00", "Bålsta HC", "Järfälla HC", "Bålsta Ishall", "1001018001"))

    def test_club_options(self):
        with open(os.path.join(FIX, "District_Stockholm_JarfallaHC_ScheduleAndResults_Schedule_21041.html"), encoding="utf-8") as f:
            opts = swehockey.club_series_options(f.read(), "/District/Stockholm/JarfallaHC/ScheduleAndResults/Schedule/21041")
        names = {n for _, n, _ in opts}
        self.assertIn("U9P", names)
        self.assertIn("U10P", names)
        self.assertIn("Bålsta Cupen U10", names)
        self.assertNotIn("AIK", names)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.cleanup()
        for k in ("JHC_ROOT", "SWEHOCKEY_FIXTURES", "JHC_NOW"):
            os.environ.pop(k, None)

    def test_baseline_has_no_changes(self):
        code, site, state = self.env.run("2026-11-03T12:00:00+00:00")
        self.assertEqual(code, 0)
        self.assertEqual(site["changes"], [])
        self.assertTrue(site["baseline_created"])
        self.assertGreater(len(site["matches"]), 300)
        ids = [m["id"] for m in site["matches"]]
        self.assertEqual(len(ids), len(set(ids)), "dubbletter i matchlistan")
        labels = {t["label"] for t in site["teams"]}
        for c in ("röd", "blå", "vit", "gul", "svart"):
            self.assertIn(f"U9 {c}", labels)
            self.assertIn(f"U10 {c}", labels)

    def test_second_identical_run_has_no_changes(self):
        self.env.run("2026-11-03T12:00:00+00:00")
        code, site, _ = self.env.run("2026-11-04T05:00:00+00:00")
        self.assertEqual(code, 0)
        self.assertEqual(site["changes"], [])

    def test_changed_time_date_venue_cancel_missing(self):
        self.env.run("2026-11-03T12:00:00+00:00")
        soup = self.env.soup(U9G1)
        rows = [tr for tr in jhc_rows(soup, future) if time_td(tr)]
        # 1. ny tid
        t_row = rows[0]
        old_time = time_td(t_row).get_text().strip()
        time_td(t_row).string = "07:07"
        # 2. nytt datum för en annan rad
        d_row = rows[3]
        old_date = re.search(r"20\d\d-\d\d-\d\d", d_row.get_text()).group(0)
        for td in d_row.find_all("td"):
            if old_date in td.get_text():
                td.string = "2027-01-02"
        # 3. ny ishall
        v_row = rows[6]
        old_venue = v_row.find_all("td")[-1].get_text().strip()
        v_row.find_all("td")[-1].string = "Testhallen"
        # 4. uttryckligen inställd
        c_row = rows[9]
        extra = soup.new_tag("td")
        extra.string = "Inställd"
        time_td(c_row).insert_after(extra)
        # 5. försvinner från källan
        m_row = rows[12]
        m_text = re.sub(r"\s+", " ", m_row.get_text(" "))
        m_row.decompose()
        # 6. dubblettrad (samma match två gånger i källan) -> ingen dubblett ut, men ny unik id
        self.env.save(U9G1, soup)

        code, site, _ = self.env.run("2026-11-04T05:00:00+00:00")
        self.assertEqual(code, 0)
        by_type = {}
        for c in site["changes"]:
            by_type.setdefault(c["type"], []).append(c)
        self.assertIn("time", by_type)
        self.assertTrue(any(c["old"] == old_time and c["new"] == "07:07" for c in by_type["time"]))
        self.assertTrue(any(c["old"] == old_date and c["new"] == "2027-01-02" for c in by_type["date"]))
        self.assertTrue(any(c["new"] == "Testhallen" and c["label"] == "NY ISHALL" for c in by_type["venue"]))
        self.assertEqual(by_type["cancelled"][0]["label"], "INSTÄLLD")
        self.assertEqual(len(by_type["missing"]), 1)
        self.assertEqual(by_type["missing"][0]["label"], "SAKNAS I KÄLLAN")
        # den försvunna matchen räknas inte som inställd
        missing_id = by_type["missing"][0]["match_id"]
        mm = [m for m in site["matches"] if m["id"] == missing_id][0]
        self.assertEqual(mm["status"], "planerad")
        self.assertTrue(mm["missing_since"])
        for c in site["changes"]:
            self.assertEqual(c["detected_at"], "2026-11-04T05:00:00Z")
        self.assertNotIn("new", by_type)

    def test_time_from_row_above_in_same_pool(self):
        _, site, _ = self.env.run("2026-11-03T12:00:00+00:00")
        # U10P Grupp 2, 2026-10-10 Vilundaparken: "Järfälla HC gul - AIK blå" saknar
        # egen tid men står direkt under 08:00-matchen i samma poolspel och hall.
        m = [x for x in site["matches"] if x["home"] == "Järfälla HC gul" and x["away"] == "AIK blå"
             and x["date"] == "2026-10-10"]
        self.assertEqual(len(m), 1)
        self.assertEqual(m[0]["start"], "08:00")
        self.assertTrue(m[0]["time_from_row_above"])
        # Rader med egen tid märks inte
        own = [x for x in site["matches"] if x["home"] == "Väsby IK HK gul" and x["away"] == "Järfälla HC gul"]
        self.assertEqual(own[0]["start"], "08:30")
        self.assertFalse(own[0]["time_from_row_above"])

    def test_no_time_when_pool_has_no_times(self):
        _, site, _ = self.env.run("2026-11-03T12:00:00+00:00")
        untimed = [m for m in site["matches"] if not m["start"]]
        self.assertTrue(untimed, "poolspel utan publicerade tider ska ge 'Tid ej angiven'")
        for m in untimed:
            self.assertFalse(m["time_from_row_above"])
        # 00:00 i källan är en platshållare och blir "tid ej fastställd"
        self.assertFalse(any(m["start"] == "00:00" for m in site["matches"]))
        self.assertTrue(any(m["time_placeholder"] for m in site["matches"]))

    def test_no_time_from_row_above_in_other_rink(self):
        self.env.run("2026-11-03T12:00:00+00:00")
        soup = self.env.soup("ScheduleAndResults_Schedule_22029.html")
        # Byt hall på raden "Järfälla HC gul - AIK blå" så att den inte längre
        # är samma hall som raden ovanför -> ingen tid ska ärvas.
        for tr in jhc_rows(soup):
            if "AIK blå" in tr.get_text() and "Järfälla HC gul" in tr.find("span", class_="lnkTooltip").get_text() \
                    and tr.get_text().count("2026-10-10"):
                tr.find_all("td")[-1].string = "Annan hall"
        self.env.save("ScheduleAndResults_Schedule_22029.html", soup)
        _, site, _ = self.env.run("2026-11-04T05:00:00+00:00")
        m = [x for x in site["matches"] if x["home"] == "Järfälla HC gul" and x["away"] == "AIK blå" and x["date"] == "2026-10-10"][0]
        self.assertIsNone(m["start"])

    def test_fetch_error_keeps_last_schedule(self):
        _, site1, _ = self.env.run("2026-11-03T12:00:00+00:00")
        n_before = len([m for m in site1["matches"] if m["group_id"] == 22071])
        os.remove(os.path.join(self.env.fix, "ScheduleAndResults_Schedule_22071.html"))
        code, site, _ = self.env.run("2026-11-04T05:00:00+00:00")
        self.assertEqual(code, 2)
        kept = [m for m in site["matches"] if m["group_id"] == 22071]
        self.assertEqual(len(kept), n_before)
        self.assertTrue(all(m.get("stale") for m in kept))
        self.assertEqual([c for c in site["changes"] if c["type"] == "missing"], [])
        self.assertFalse(site["last_attempt_ok"])
        self.assertEqual(site["last_success"], "2026-11-04T05:00:00Z")  # övriga källor lästes
        self.assertTrue(any("22071" in w or "Grupp 2" in w for w in site["warnings"]))

    def test_total_failure_keeps_everything(self):
        _, site1, _ = self.env.run("2026-11-03T12:00:00+00:00")
        for fn in os.listdir(self.env.fix):
            os.remove(os.path.join(self.env.fix, fn))
        code, site, _ = self.env.run("2026-11-04T05:00:00+00:00")
        self.assertEqual(code, 2)
        self.assertTrue(site["fetch_failed_completely"])
        self.assertEqual(len(site["matches"]), len(site1["matches"]))
        self.assertEqual(site["last_success"], "2026-11-03T12:00:00Z")
        self.assertEqual(site["changes"], [])

    def test_suspicious_empty_answer_is_error(self):
        self.env.run("2026-11-03T12:00:00+00:00")
        soup = self.env.soup(U9G1)
        for tr in jhc_rows(soup):
            tr.decompose()
        self.env.save(U9G1, soup)
        code, site, _ = self.env.run("2026-11-04T05:00:00+00:00")
        self.assertEqual(code, 2)
        self.assertEqual([c for c in site["changes"] if c["type"] == "missing"], [])

    def test_missing_then_returned(self):
        self.env.run("2026-11-03T12:00:00+00:00")
        orig = self.env.soup(U9G1)
        soup = copy.copy(orig)
        row = [tr for tr in jhc_rows(soup, future) if time_td(tr)][0]
        row.decompose()
        self.env.save(U9G1, soup)
        _, s2, _ = self.env.run("2026-11-04T05:00:00+00:00")
        t2 = [c["type"] for c in s2["changes"]]
        self.assertEqual(t2.count("missing"), 1)
        self.assertNotIn("cancelled", t2)
        self.env.save(U9G1, orig)
        _, s3, _ = self.env.run("2026-11-05T05:00:00+00:00")
        t3 = [c["type"] for c in s3["changes"]]
        self.assertEqual(t3.count("returned"), 1)
        self.assertFalse(any(m.get("missing_since") for m in s3["matches"]))

    def test_discovery_failure_uses_known_sources(self):
        self.env.run("2026-11-03T12:00:00+00:00")
        os.remove(os.path.join(self.env.fix, "District_Stockholm.html"))
        code, site, _ = self.env.run("2026-11-04T05:00:00+00:00")
        self.assertEqual(code, 2)
        self.assertGreater(len(site["matches"]), 300)
        self.assertEqual([c for c in site["changes"] if c["type"] == "missing"], [])

    def test_duplicate_views_are_merged(self):
        cfg = load_cfg()
        # Cupens Overview-vy (22043) innehåller samma matcher som Schedule-vyn (22042)
        shutil.copy(os.path.join(self.env.fix, "ScheduleAndResults_Schedule_22042.html"),
                    os.path.join(self.env.fix, "ScheduleAndResults_Schedule_22043.html"))
        cfg["extra_sources"] = [{"id": 22043, "name": "Bålsta Cupen U10", "kind": "cup"}]
        _, site, _ = self.env.run("2026-11-03T12:00:00+00:00", cfg)
        cup = [m for m in site["matches"] if m["series"] == "Bålsta Cupen U10"]
        self.assertEqual(len(cup), 9)
        self.assertEqual(len({m["id"] for m in cup}), 9)


if __name__ == "__main__":
    unittest.main()
