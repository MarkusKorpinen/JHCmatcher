# Järfälla HC U9 & U10 – matchöversikt

En kostnadsfri, mobilvänlig hemsida som visar alla publicerade matcher för Järfälla HC:s U9- och U10-lag. Uppgifterna hämtas automatiskt från [stats.swehockey.se](https://stats.swehockey.se/). Sidan visar krockar och upptäckta schemaändringar.

* **Hemsidan** ligger i `docs/` och publiceras med GitHub Pages.
* **Krockregel:** spelarna orkar i regel bara ett poolspel per dag. Därför är det en krock när två eller fler Järfälla-lag (inom U9, inom U10 eller mellan U9 och U10) spelar **olika poolspel eller cuper samma dag**. Ett lags egna matcher i poolspelet och lag i samma poolspel räknas inte. Om poolspelen dessutom pågår samtidigt i olika hallar markeras det extra.
* **Tider i poolspel:** saknar en match egen tid gäller tiden på raden ovanför, om den ligger i samma poolspel och samma ishall. Matchen märks med \*. Tiden 00:00 i källan betyder att tiden inte är satt och visas som ”Tid ej fastställd”.
* **Automatiken** (`.github/workflows/update.yml`) körs två gånger per dygn på GitHubs servrar, även när din dator är avstängd.
* **Sparad historik** finns i `data/state.json`. Där ligger senaste fungerande schema, alla upptäckta ändringar och en körlogg.

> **Viktigt:** Med gratisupplägget måste repot vara **offentligt**. Både hemsidan och allt innehåll i repot (kod, matchdata, ändringshistorik) kan läsas av vem som helst. Sidan innehåller bara offentliga matchuppgifter från stats.swehockey.se, inga spelare, kontaktuppgifter eller annat personligt. Lägg aldrig in sådant här.

---

## Publicera och starta automatiken (engångsjobb, ca 15 min)

Du behöver ett gratis konto på github.com.

1. **Skapa repot.** Gå till github.com → **New repository**. Ge det ett namn, t.ex. `jhc-matcher`, och välj **Public**. Kryssa inte i något annat. Klicka **Create repository**.
2. **Ladda upp filerna.** Packa upp zip-filen. På den nya repo-sidan klickar du **uploading an existing file** och drar in *allt innehåll* i mappen (inte mappen själv). Klicka sedan **Commit changes**.
   * Mappen `.github` är dold på Mac och Windows. Kontrollera efter uppladdningen att repot innehåller filen `.github/workflows/update.yml`. Saknas den: klicka **Add file → Create new file**, skriv namnet `.github/workflows/update.yml`, klistra in innehållet från filen i zip-paketet och klicka **Commit changes**.
3. **Slå på GitHub Pages.** Gå till **Settings → Pages**. Under *Build and deployment → Source* väljer du **GitHub Actions**.
4. **Kör första gången.** Gå till fliken **Actions**. Klicka **I understand my workflows, go ahead and enable them** om GitHub frågar. Välj sedan **Uppdatera matcher** till vänster och klicka **Run workflow → Run workflow**. Efter 1–3 minuter ska körningen få en grön bock.
5. **Hämta länken.** Under **Settings → Pages** visas adressen, t.ex. `https://DITTNAMN.github.io/jhc-matcher/`. Det är den länken ledarna ska få. Ingen inloggning behövs.

Om körningen blir röd: klicka på den och läs vilket steg som stoppade. Hemsidan visar då en tydlig varning och behåller senast fungerande schema.

## Rutin för att hålla bevakningen igång

GitHub ger inga garantier för exakt när schemalagda körningar sker.

* Körningar kan **försenas**, särskilt kring hela timmar. Ibland **uteblir** en körning helt när belastningen är hög. Därför körs kontrollen två gånger per dygn, på udda minuter.
* I offentliga repon **stänger GitHub av schemalagda körningar** om det inte har hänt något i repot på 60 dagar. Automatiken sparar själv data i repot när något ändras. Under lugna perioder, t.ex. sommaruppehållet, kan det ändå bli tyst länge.
* **Enkel rutin, 1 minut i månaden:** Öppna hemsidan och titta på ”Senast kontrollerad”. Är den äldre än några dagar: gå till **Actions → Uppdatera matcher**. Visas en gul ruta om att workflowen är avstängd, klicka **Enable workflow**. Klicka sedan **Run workflow**.
* Själva hemsidan varnar automatiskt om senaste lyckade kontroll är äldre än 7 dagar.
* GitHub skickar normalt ett mejl till dig när en schemalagd körning misslyckas. Det är en gratis felavisering.

## Byta säsong (görs i augusti/september)

1. Öppna `config.json` i repot och klicka på pennan (**Edit**).
2. Ändra `"season"`, `"season_start"` och `"season_end"`, t.ex. till `"2027-28"`, `"2027-07-01"` och `"2028-06-30"`.
3. Ta bort raderna i `"fallback_sources"` eller uppdatera deras id-nummer. De används bara om klubbsidan inte går att läsa.
4. Spara (**Commit changes**). Automatiken körs direkt. Serierna för den nya säsongen hittas via Järfälla HC:s sida på stats.swehockey.se så fort förbundet har publicerat dem.
5. Vill du börja om med en tom ändringshistorik: ta bort filen `data/state.json`. Nästa körning skapar en ny baslinje.

## Lägga till lag, serier eller cuper

* **Nya Järfälla-lag** i U9/U10 (ny färg, nytt nummer, ny grupp) hittas automatiskt. Det behövs ingen ändring.
* **En cup eller serie** som ligger under Järfälla HC på stats.swehockey.se tas med automatiskt om namnet innehåller U9, U10, F9 eller F10.
* **Andra cuper.** Öppna cupen på stats.swehockey.se och notera numret i slutet av adressen, t.ex. `.../Schedule/22042`. Lägg sedan till den i `config.json`:
  ```json
  "extra_sources": [
    {"id": 22042, "name": "Bålsta Cupen U10", "kind": "cup"}
  ]
  ```
  Namnet måste innehålla U9 eller U10 så att åldersgruppen blir rätt.
* **Andra åldersgrupper.** Lägg till en rad under `"age_groups"`, t.ex. `"U11": "\\b[UF]11[PF]?\\b"`.
* **Ta bort en källa.** Skriv in dess nummer i `"exclude_source_ids"`.

Standardvärdet för antagen matchlängd ligger under `"defaults"`. Det används bara för markeringen ”samtidigt i olika hallar” och för veckovyn. Varje besökare kan också ändra det själv på hemsidan.

## Så fungerar kontrollen

* **Källor.** Klubbsidan → serier/cuper med U9/U10 i namnet → alla grupper i serien. Grupper utan Järfälla-lag hoppas över.
* **Stabila match-id.** I sammandrag används grupp + ”Pool/Game”-numret från källan + de två lagen. I cuper används källans matchnummer. Samma match från två vyer blir därför aldrig en dubblett.
* **Ändringar.** Kontrollen markerar `NY TID`, `NYTT DATUM`, `NY ISHALL`, `NY MATCH`, `INSTÄLLD` (bara om källan uttryckligen skriver det) och `SAKNAS I KÄLLAN`. En försvunnen match räknas aldrig automatiskt som inställd. Tidpunkten som visas är när *vår kontroll* såg ändringen, inte när arrangören gjorde den.
* **Första hämtningen** skapar en baslinje. Den visas inte som ändringar.
* **Hämtningsfel.** Senast fungerande uppgifter behålls och markeras ”EJ KONTROLLERAD NU”. Ett plötsligt tomt svar räknas också som fel och inte som att alla matcher försvunnit.
* **Skonsam hämtning.** Kontrollen gör ca 15 sidvisningar per körning, med 2 sekunders paus mellan varje. Sidan saknar robots.txt-regler (kontrollerat 2026-11-03).
* **Ingen AI och inga betaltjänster** används i den löpande driften.

## Tester

```
pip install -r requirements.txt
python -m unittest discover -s tests -v
node tests/test_conflicts.js
```
Testerna använder sparade kopior av riktiga sidor (`tests/fixtures`, hämtade 2026-11-03). De simulerar ändrad tid, ändrat datum, ändrad hall, inställd match, försvunnen och återkommen match, dubbletter, hämtningsfel och misstänkt tomma svar. Testerna körs också automatiskt före varje hämtning.

## Möjlig avisering, gratis (inte aktiverad)

Det enklaste tillägget är en sak till i workflowen: när nya ändringar upptäcks skapar den ett *Issue* i repot. Den som klickar **Watch** på repot får då ett mejl från GitHub. Det kräver ingen extra tjänst och kostar inget. Säg till om du vill ha det.
