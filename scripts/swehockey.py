"""Hämtning och tolkning av offentliga schemasidor på stats.swehockey.se.

Två sidformat stöds:
  * Seriesidor för poolspel/sammandrag (U9P, U10P, F10): kolumnerna
    Date / Starttime / Game / Venue / Host. Varje sammandrag inleds med en rad
    med klassen "paddingTop" och matcherna har en tooltip "Pool:x,Game:y".
  * Cupsidor ("Schedule and Results"): kolumnerna Round / Date / Game / ...
    / Venue / Group. Datum och tid står i samma cell och tooltipen innehåller
    ett matchnummer.

Ingenting gissas: saknas klockslag i källan sparas tiden som None.
"""
from __future__ import annotations

import html
import os
import re
import time
from dataclasses import dataclass, field

from bs4 import BeautifulSoup

BASE = "https://stats.swehockey.se"
FETCH_BASE = os.environ.get("SWEHOCKEY_BASE", BASE)  # kan pekas om i tester
USER_AGENT = (
    "JarfallaHC-U9U10-matchoversikt/1.0 (ideell foraldra-/ledarsida; "
    "en hamtning per dygn; github.com)"
)

DATE_RE = re.compile(r"(20\d\d-\d\d-\d\d)")
TIME_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")
POOL_RE = re.compile(r"Pool:\s*(\d+)\s*,\s*Game:\s*(\d+)", re.I)
GAME_LINK_RE = re.compile(r"/Game/[A-Za-z]+/(\d+)")
CANCEL_RE = re.compile(r"\b(inst[äa]lld|cancel+ed|struken|avbl[åa]st)\b", re.I)
POSTPONE_RE = re.compile(r"\b(uppskjuten|postponed|flyttad)\b", re.I)
SCORE_RE = re.compile(r"^\d+\s*-\s*\d+")


class FetchError(Exception):
    pass


class Fetcher:
    """Skonsam hämtare: en förfrågan i taget, paus mellan anrop, få omförsök.

    Med miljövariabeln SWEHOCKEY_FIXTURES kan sidor i stället läsas från en
    katalog (används i tester och vid första körningen härifrån).
    """

    def __init__(self, delay: float = 2.0, timeout: float = 30.0, retries: int = 2):
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.fixtures = os.environ.get("SWEHOCKEY_FIXTURES")
        self._last = 0.0
        self._session = None
        self.requests_made = 0

    @staticmethod
    def fixture_name(path: str) -> str:
        return path.strip("/").replace("/", "_").replace("?", "_") + ".html"

    def get(self, path: str) -> str:
        if self.fixtures:
            fn = os.path.join(self.fixtures, self.fixture_name(path))
            if not os.path.exists(fn):
                raise FetchError(f"Ingen testfil för {path}")
            with open(fn, encoding="utf-8") as f:
                return f.read()
        import requests  # importeras bara vid riktig hämtning

        if self._session is None:
            self._session = requests.Session()
            self._session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "sv,en;q=0.5"})
        url = path if path.startswith("http") else FETCH_BASE + path
        last_err = None
        for attempt in range(self.retries + 1):
            wait = self.delay - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            try:
                self._last = time.monotonic()
                self.requests_made += 1
                r = self._session.get(url, timeout=self.timeout)
                if r.status_code == 200 and r.content:
                    ctype = r.headers.get("Content-Type", "")
                    enc = r.encoding if "charset=" in ctype.lower() else "utf-8"
                    return r.content.decode(enc or "utf-8", errors="replace")
                last_err = f"HTTP {r.status_code}"
                if r.status_code in (403, 404, 410):
                    break  # inte meningsfullt att försöka igen
            except Exception as e:  # nätverksfel
                last_err = str(e)
            time.sleep(5 * (attempt + 1))
        raise FetchError(f"{url}: {last_err}")


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


@dataclass
class PageInfo:
    title: str = ""
    heading: str = ""
    last_update: str | None = None
    group_options: list = field(default_factory=list)  # [(id, namn)]
    has_table: bool = False


def page_info(soup: BeautifulSoup) -> PageInfo:
    info = PageInfo()
    info.title = norm(soup.title.get_text()) if soup.title else ""
    h1 = soup.find("h1")
    info.heading = norm(h1.get_text()) if h1 else ""
    m = re.search(r"Last update:\s*([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2})", soup.get_text(" "))
    info.last_update = m.group(1) if m else None
    info.has_table = soup.find("table", class_="tblContent") is not None
    # Tredje rullistan på sidan listar seriens grupper.
    for sel in soup.find_all("select"):
        opts = []
        for o in sel.find_all("option"):
            v = o.get("value") or ""
            m = re.match(r"^/ScheduleAndResults/(?:Schedule|Overview)/(\d+)$", v)
            if m:
                opts.append((int(m.group(1)), norm(o.get_text())))
        if opts and any("grupp" in n.lower() or "group" in n.lower() for _, n in opts):
            info.group_options = opts
            break
    return info


def _game_cell(tds):
    """Hitta cellen med 'Lag A - Lag B' (inte resultatcellen '3 - 0')."""
    for td in tds:
        span = td.find("span", class_="lnkTooltip")
        txt = norm(span.get_text()) if span and POOL_RE.search(span.get("title", "")) else norm(td.get_text())
        if DATE_RE.search(txt) or SCORE_RE.match(txt):
            continue
        parts = re.split(r"\s+-\s+", txt, maxsplit=1)
        if len(parts) == 2 and re.search(r"[A-Za-zÅÄÖåäö]", parts[0]) and re.search(r"[A-Za-zÅÄÖåäö]", parts[1]):
            return td, parts[0].strip(), parts[1].strip()
    return None, None, None


def parse_schedule(html_text: str, group_id: int) -> tuple[PageInfo, list[dict]]:
    """Returnerar (sidinfo, matcher). Varje match är en dict med råvärden."""
    soup = BeautifulSoup(html_text, "html.parser")
    info = page_info(soup)
    table = soup.find("table", class_="tblContent")
    if table is None:
        return info, []
    headers = [norm(th.get_text()) for th in table.find_all("th", class_="tdHeader")]
    is_cup = "Round" in headers or "Group" in headers
    has_group_col = headers[-1:] == ["Group"]

    games = []
    block = None
    block_host = None
    current_date = None
    seq = 0
    for tr in table.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if not tds:
            continue
        gtd, home, away = _game_cell(tds)
        if not gtd:
            continue
        seq += 1
        row_text = norm(tr.get_text(" "))
        classes = " ".join(tds[0].get("class", []))
        starts_block = "paddingTop" in classes.split()

        # Datum: första datum i raden (finns alltid i mobilcellen).
        m = DATE_RE.search(row_text)
        if m:
            current_date = m.group(1)
        # Klockslag: en egen cell med bara HH:MM, eller "YYYY-MM-DD HH:MM".
        start = None
        placeholder = False
        for td in tds:
            if td is gtd:
                continue
            t = norm(td.get_text())
            mt = re.fullmatch(r"(?:20\d\d-\d\d-\d\d\s+)?(\d{1,2}):(\d\d)", t)
            if mt:
                start = f"{int(mt.group(1)):02d}:{mt.group(2)}"
                if start == "00:00":
                    # 00:00 används i källan som platshållare när tiden inte är satt
                    start = None
                    placeholder = True
                break

        venue_td = tds[-2] if (is_cup and has_group_col and len(tds) >= 2) else tds[-1]
        venue_raw = norm(venue_td.get_text())
        venue, host = venue_raw, None
        if " / " in venue_raw:
            venue, host = [x.strip() for x in venue_raw.split(" / ", 1)]
        group_name = norm(tds[-1].get_text()) if (is_cup and has_group_col) else None

        tip = gtd.find("span", class_="lnkTooltip")
        pool = POOL_RE.search(tip.get("title", "")) if tip else None
        game_no = None
        for span in tr.find_all("span", class_="lnkTooltip"):
            t = norm(span.get("title", ""))
            if re.fullmatch(r"\d{5,}", t):
                game_no = t
        link = GAME_LINK_RE.search(str(tr))

        if not is_cup and pool:
            if starts_block or block is None or not block.endswith(f"-p{pool.group(1)}-g{pool.group(2)}"):
                block = f"{group_id}-p{pool.group(1)}-g{pool.group(2)}"
                block_host = host
            elif host and not block_host:
                block_host = host
        else:
            block = f"{group_id}-{current_date}"
            block_host = host

        status = "planerad"
        if CANCEL_RE.search(row_text):
            status = "inställd"
        elif POSTPONE_RE.search(row_text):
            status = "uppskjuten"

        games.append({
            "group_id": group_id,
            "date": current_date,
            "start": start,
            "home": home,
            "away": away,
            "venue": venue or None,
            "host": host or (block_host if not is_cup else None),
            "block": block,
            "pool": int(pool.group(1)) if pool else None,
            "pool_game": int(pool.group(2)) if pool else None,
            "game_no": game_no,
            "game_link_id": link.group(1) if link else None,
            "cup_group": group_name,
            "status": status,
            "time_placeholder": placeholder,
            "row_seq": seq,
            "format": "cup" if is_cup else "sammandrag",
        })
    return info, games


def club_series_options(html_text: str, club_link: str = "") -> list[tuple[int, str, str]]:
    """Läs klubbsidans rullista med föreningens serier och cuper.

    Rullistan med distriktets alla klubbar har också länkar av formen
    /District/<distrikt>/<Klubb>/..., så bara alternativ som pekar på den
    egna klubbens sökväg (eller saknar /District/) räknas.
    Returnerar [(id, namn, 'serie'|'cup')]."""
    m0 = re.match(r"^(/District/[^/]+/[^/]+)/", club_link or "")
    prefix = m0.group(1) + "/" if m0 else None
    soup = BeautifulSoup(html_text, "html.parser")
    best = []
    for sel in soup.find_all("select"):
        out, kind, foreign = [], "serie", 0
        for o in sel.find_all("option"):
            v = o.get("value") or ""
            name = norm(o.get_text())
            if v == "-1" and name.lower().startswith("cup"):
                kind = "cup"
                continue
            m = re.search(r"/ScheduleAndResults/(?:Schedule|Overview|Live)/(\d+)$", v)
            if not m:
                continue
            if "/District/" in v and not (prefix and v.startswith(prefix)):
                foreign += 1
                continue
            out.append((int(m.group(1)), name, kind))
        if foreign == 0 and len(out) > len(best):
            best = out
    return best


def district_club_link(html_text: str, club: str) -> str | None:
    soup = BeautifulSoup(html_text, "html.parser")
    for o in soup.find_all(["option", "a"]):
        if norm(o.get_text()) == club:
            v = o.get("value") or o.get("href")
            if v and v.startswith("/District/"):
                return v
    return None
