# REIS Norge – hva som ble fikset

Alt under er verifisert mot Entur live 31. juli 2026, ikke gjettet.
`node test-live.js` kjører appens egne spørringer mot API-et (15 tester),
`node test-dom.js` tester grensesnitt og logikk i jsdom (150 tester),
`python3 shot.py`, `measure.py`, `swipe_test.py`, `fill_test.py`, `qt_test.py`,
`sec_test.py`, `overlap_test.py`, `perf_test.py`, `font_test.py`, `a11y.py` og
`polish_test.py`, `plan_test.py`, `soak.py`, `regress_map.py` og `update_test.py`
måler layout,
farger, kontrast, sveip og zoom-sperre med ekte touch-hendelser i Chromium på
Galaxy S24-bredde. Alle grønne.

---

## De to feilene som lammet appen

### 1. Reisesøket feilet alltid — `TripPattern.startTime` finnes ikke
Den gamle spørringen ba om `startTime` og `endTime` på `TripPattern`. Disse feltene
ble fjernet i JourneyPlanner v3. Hele `trip`-spørringen feilet derfor på validering,
og Plan-fanen kunne aldri returnere en reise.

```diff
- tripPatterns{ duration distance startTime endTime legs{…} }
+ tripPatterns{ duration distance walkDistance expectedStartTime expectedEndTime legs{…} }
```
Alle avlesninger (`p.startTime` → `p.expectedStartTime`) er rettet, også i
resultatkortene, kartkortet, detaljvisningen og fanetittelen.

### 2. Avgangsfanen feilet — `STOP_PLACE` er ikke en gyldig enum-verdi
Dette var feilen på skjermbildet ditt. Entur bruker lowerCamelCase:

```
FilterPlaceType : quay | stopPlace | bicycleRent | bikePark | carPark
```

```diff
- filterByPlaceTypes:[STOP_PLACE]
+ filterByPlaceTypes:[stopPlace], filterByInUse:true, multiModalMode:parent
```
`filterByInUse` fjerner nedlagte holdeplasser, og `multiModalMode:parent` gjør at
Jernbanetorget kommer som **ett** stopp i stedet for ett per transportmiddel.
Testen sjekker eksplisitt at det ikke kommer dubletter.

---

## Adresser og «din posisjon»

`Location.place` godtar **kun** ruteplanleggerens egne id-er. Geocoderen gir helt
andre id-er for alt som ikke er en holdeplass:

| Treff | id fra geocoder | duger som `place`? |
|---|---|---|
| Jernbanetorget | `NSR:StopPlace:58366` | ja |
| Storgata 10, Fredrikstad | `17873150` | nei |
| Fredrikstad tannklinikk | `OSM:TopographicPlace:6126674571` | nei |
| Din posisjon (GPS) | – | nei |

Den gamle koden sendte alt inn som `place`. Nå går alt gjennom `toLocation()`,
som velger `place` for NSR-id-er og `coordinates` for resten.

I tillegg:
- Geocoderen kalles nå med `lang=no` (sto `lang=en`, derfor engelske stedsnavn).
- `focus.point` sendes med din posisjon, så «Storgata» nær deg havner øverst.
- `reverseGeocode` leste `j.properties` — men Entur svarer med en FeatureCollection.
  Den fant derfor aldri navnet og svarte alltid «Valgt punkt». Leser nå `j.features[0]`.
- `getPos()` skiller mellom avslått tillatelse, manglende HTTPS, tidsavbrudd og
  manglende GPS, og sier hva du skal gjøre i stedet for «Fant ikke posisjonen din».

---

## Via-stopp

`via` er ikke lenger en liste med `Location`, men `[TripViaLocationInput!]`:

```graphql
input TripVisitViaLocationInput {
  label: String
  minimumWaitTime: Duration   # "PT5M"
  stopLocationIds: [String!]
  coordinate: InputCoordinates
}
```

Gammel kode sendte `{name, place, coordinates}` og ble stille avvist. Ny `toVia()`
pakker holdeplasser som `{visit:{stopLocationIds:[…]}}` og adresser som
`{visit:{coordinate:{…}}}`. Tom via-liste sendes som `null`, siden en tom liste
også gir feil.

Live-testen bekrefter at ruten **faktisk** går via punktet, ikke bare at kallet
går gjennom.

I grensesnittet er via-radene også testet: knappen setter inn raden mellom A og B,
bare via-rader får slett-knapp, knappen skjules ved fire rader, og sletting fjerner
riktig rad.

---

## Utgangsguiden var også ødelagt

`Quay.compassBearing` finnes ikke i v3 — spørringen feilet på validering hver gang.
Guiden bruker nå felt som faktisk finnes:

- `latitude`/`longitude` per plattform, og kompassretningen regnes ut selv fra
  stoppestedets midtpunkt (`bearingTo()`, testet mot N/Ø/S/V).
- `wheelchairAccessible` (`possible` / `notPossible` / `noInformation`) gir et
  ærlig «Trinnfri»-merke i stedet for tekstgjetting.
- `lines{publicCode}` viser hvilke linjer som går fra hver plattform.

Teksten er også gjort ærligere: den sier nå at retningene er utregnet, og lover
ikke heisplassering Entur ikke har data om.

---

## Levende kjøretøy

Endepunktet `api.entur.io/vehicle/v1/graphql` finnes ikke lenger og svarte tomt.
Riktig er `realtime/v2/vehicles`, med tre forskjeller den gamle koden ikke tok høyde for:

- posisjon ligger i `location{latitude longitude}`, ikke på rotnivå
- `mode` er STORE BOKSTAVER (`BUS`, `TRAM`, `METRO`, `RAIL`, `FERRY`)
- filtrering skjer med `boundingBox`, som også sparer båndbredde

Testen henter 35+ kjøretøy i Oslo-boksen.

---

## Bysykkel

`gbfs.json` fra Oslo bysykkel har feeds bak en språknøkkel — `data.nb.feeds`, ikke
`data.feeds`. Gammel kode fant derfor aldri stasjonene. `gbfsFeeds()` håndterer
begge formene. Testen henter 268 stasjoner.

---

## Severdigheter kastet en ReferenceError

I `spotHTML` sto det `href="${a?.url||s.url}"`. Variabelen `a` finnes ikke i den
funksjonen, så hvert kall kastet `ReferenceError` og listen ble aldri tegnet.
Rettet til `s.url`, og URL-en escapes nå. Wikipedia-oppslagene er samtidig byttet
fra `en.wikipedia.org` til `no.wikipedia.org`.

---

## «L is not defined» — kartbiblioteket kunne velte hele appen

Leaflet lå som en vanlig `<script src="https://unpkg.com/…">` rett før appens eget
skript. Feilet den forespørselen — dårlig dekning, blokkert CDN, annonseblokker,
unpkg nede — ble `L` aldri definert, og appen døde på `const map=L.map('map',…)`
før noe som helst rakk å kjøre. Ikke bare kartet: hele appen, inkludert Plan og
Avganger, som ikke trenger kart i det hele tatt.

Nå:

- Leaflet lastes **først når kartfanen faktisk åpnes**, ikke ved oppstart.
- Tre CDN-er prøves etter tur: unpkg → jsDelivr → cdnjs. CSS og JS hentes fra samme.
- `map`, `tiles` og alle lagene starter som `null`. Hver funksjon som rører kartet
  (`setUser`, `drawPattern`, `drawStreetRoute`, `nodeMarker`, `fitRoute`,
  `centerOnStop`, `applyMapContext`, `fetchVehicles`, bysykkel- og
  severdighetslagene) sjekker først at kartet finnes.
- Avgangsfanen brukte `map.getCenter()` som reservepunkt. Den bruker nå `mapCenter()`,
  som faller tilbake til Oslo sentrum hvis kartet ikke er lastet.
- Klarer ikke kartet å laste, vises et panel i kartfanen med årsak og en
  «Prøv å laste kartet igjen»-knapp. Resten av appen går som normalt.

Testen booter appen i jsdom **uten** Leaflet i det hele tatt og bekrefter at den
starter, at Plan-fanen tegnes, og at alle kartfunksjonene har vakt.

---

## «Må lukke og åpne appen før ting virker»

Symptomet ble sporet med en slitasjetest (`soak.py`) som bruker appen som en
person over fem runder og måler tilstand underveis. Den avdekket to ting.

### Hovedårsaken: appen oppdaget aldri nye versjoner
Det var ingen håndtering av oppdateringer i det hele tatt – null forekomster av
`updatefound` eller `controllerchange`. Når en ny versjon ble lastet opp, hentet
nettleseren riktignok ny `sw.js`, men **siden som allerede kjørte beholdt gammel
HTML og JavaScript**. Først når appen ble lukket og åpnet lastet den nye koden.

Det er ikke tilfeldig – det skjer hver gang det kommer en ny build.

Rettet i begge ender:

- **Service workeren tar ikke lenger over i det skjulte.** `skipWaiting()` kjørte
  automatisk ved installasjon, slik at ny worker serverte nye filer til en side
  som fortsatt kjørte gammel kode. Nå venter den, med mindre ingen side er åpen.
- **Appen sier fra.** Et banner nederst: «Ny versjon av REIS er klar» med
  «Oppdater». Ett trykk ber ny worker ta over, og siden lastes på nytt én gang.
- Det ses etter oppdatering ved oppstart, hver gang appen hentes fram igjen, og
  hver halvtime. **Mer → Versjon** har også en manuell knapp.

Bevist ende-til-ende: en ny versjon legges ut mens appen står åpen, banneret
dukker opp uten omstart, og ett trykk laster den nye koden.

### Bifunn: en unntaksstorm fra kartet
Slitasjetesten viste at feilloggen fyltes til taket (40) allerede etter to søk,
med `Invalid LatLng object: (NaN, NaN)` – **43 unntak** i en kort økt.

Årsaken: Leaflet projiserer mot containerens størrelse. Er kartet lastet, men
skjult, er størrelsen 0×0 og all matematikk gir `NaN`. `clearRoute()` kalte
`applyMapContext()` → `centerOnStop()` → `map.flyTo()` fra Plan-fanen.

- Alle karthandlinger krever nå at containeren faktisk har flate (`mapUsable()`),
  ikke bare at kartet finnes.
- Arbeid som kommer for tidlig legges i kø og kjøres når kartfanen åpnes.
- `clearRoute()` er pakket inn, og oppryddingen i `findJourney()` flyttet **inn**
  i try-blokken – lå den utenfor, kunne en feil avbryte et søk før det startet.

> Ærlig forbehold: jeg klarte å bevise unntaksstormen og at den er borte
> (43 → 0), men **ikke** at den var det som blokkerte reisesøket. `flyTo` kaster
> i en animasjonsramme, ikke i vår egen kallstakk, så den avbrøt ikke søket i
> reproduksjonen min. Hovedforklaringen på symptomet er oppdateringshåndteringen.

---

## Ryddigere Plan-fane

**Transportvelgeren er flyttet til innstillingene.** Seks knapper for trikk,
t-bane, buss, tog og båt tok ~200 px i den viktigste fanen for noe man endrer
sjelden. De ligger nå under **Mer → Transportmidler**, og valget huskes mellom
økter i stedet for å nullstilles hver gang.

Er filteret aktivt, sier appen fra der du faktisk ser det – en diskré linje rett
under søkeknappen: *«● ● Søker kun med buss · endre»*. Trykk på den, så åpnes
innstillingen og ruller til velgeren. Er ingenting valgt, vises den ikke.

Plan-fanen leser nå som en historie ovenfra og ned:

| | |
|---|---|
| Hurtigreise | dine lagrede ruter med neste avgang |
| Planlegg reisen | A → B og verktøy |
| Når | reis nå / avreise / ankomst |
| **Finn reise** | ligger nå 597 px oppe, godt over skjermkanten |
| I nærheten | fyller resten med noe du kan handle på |

«Ny hurtigreise» er dempet til en sekundær handling – den ropte like høyt som
søkeknappen før.

### FIX: «Alle» var nesten usynlig i mørk modus
Den valgte «Alle»-knappen brukte flaggblå som tekstfarge mot et mørkt kort:
**1,09:1 i kontrast**, altså praktisk talt uleselig. Nøytralfargen følger nå
temaet. Målt etter endringen: **11,2:1 i lys modus, 6,6:1 i mørk** – begge godt
over WCAG AA.

---

## Finpuss: tilgjengelighet, nattbuss og snarveier

### Trykkflater
20 av 26 knapper var under 44 px. Verstingene: tøm-krysset 28×28, og
seksjonsoverskriftene bare **20 px høye** – brede, men en tynn stripe å treffe.

Løst på to måter: små ikonknapper fikk en usynlig sone (`::before` med
`max(100%,44px)`) som ikke endrer utseendet, og knappene i rutenett ble hevet til
44 px høyde. Målt med ekte treffpunkt-testing, ikke bare bokshøyde: **0 av 26 for
små** nå. Tettheten er praktisk talt uendret.

### Skjermleser og tastatur
- Dialogene har `role="dialog"`, `aria-modal` og tittel; vekkealarmen `alertdialog`.
- **Fokusfelle:** Tab går ikke lenger ut av en åpen dialog, og fokus gis tilbake
  til knappen du kom fra. En finurlighet underveis: dialoger som tegnes to ganger
  (skjelett → innhold) lagret fokus fra sin egen forgjenger, så det forsvant.
  Fokus lagres nå bare første gang.
- Avgangstavla er `aria-live="polite"` med `aria-busy` mens den laster, og hver
  rad har en lesbar setning: «Buss 31 mot Fornebu, om 4 minutter, 2 minutter forsinket».
- Bunnmenyen er en `tablist` med `aria-selected`.
- Synlig fokusmarkering i faneidentitetens farge.

### «Siste avgang i kveld»
Ny knapp i avgangsfanen. Henter et døgn med avganger, grupperer per linje og
retning, og viser den siste før kl. 03 – nattbussene hører til kvelden før.
Øverst står svaret på det man faktisk lurer på: *«Aller siste fra Jernbanetorget
går 22:39 med linje 5 mot Stortinget – om 1t 34.»*

### Klokkeavvik
Nedtellingene ble regnet fra telefonens klokke. Går den feil, viser appen feil –
og du tror det er sanntidsdataene. `Date`-headeren fra Entur leses nå av hvert
kall, og alt som teller ned bruker `now()` i stedet for `Date.now()`. Avvik over
30 sekunder vises under **Mer → Systemtid**.

### Nettverksbevissthet
Appen pollet like hardt på 2G som på wifi. Intervallene skaleres nå ×3 på
2G/`saveData` og ×1,8 på 3G, og kjøretøylaget hoppes over med en beskjed.
Sekundtikk og klokke skaleres ikke.

### Dyplenker og snarveier
- `?stop=NSR:StopPlace:58366` åpner rett i tavla for det stoppet.
- `?from=…&to=…&go=1` søker en hurtigreise automatisk.
- Begge har en «Legg på startsiden»-knapp som kopierer lenken og forklarer
  framgangsmåten. Android lager da et eget ikon – i praksis en holdeplass-widget.
- **Share target:** del en adresse fra Kart eller Gmail rett inn i REIS som mål.
  Fire linjer i manifestet, ingen server.
- Manifestet har fått tre skjermbilder, så Androids installasjonsdialog viser
  hva appen er i stedet for bare navnet.

---

## Batteri, oppstart og offline

Tre svakheter funnet ved gjennomgang, ikke ved gjetting.

### 1. Appen jobbet videre i bakgrunnen
Sju `setInterval` gikk uansett om skjermen var på. De sjekket om *fanen* var
aktiv, men ikke om appen var synlig. Det tappet batteri, og ved retur sto
nedtellingen på gamle tall til neste poll.

Alle periodiske jobber går nå gjennom `every()`, som hopper over når
`document.visibilityState` er `hidden`. Ved retur:

- klokke og nedtellinger rettes opp **umiddelbart**
- var du borte i mer enn 10 sekunder, hentes friske data for den fanen du er på

Målt i nettleser: **0 Entur-kall på 26 sekunder** i bakgrunnen (mot minst ett
per 20 sekunder før), og ett kall umiddelbart ved retur.

### 2. Skriftene ble hentet fra Google
Første gang appen ble åpnet uten nett fikk du systemfont, og på treg forbindelse
blokkerte skriftene opptegningen. Nå ligger alle sju snitt i fila som
base64-WOFF2, subsettet til latin + norsk + de symbolene grensesnittet bruker –
**82 kB til sammen**.

Verifisert: null eksterne fontkall, og alle vekter som faktisk brukes er lastet.
Byggeskriptet `build_fonts.py` kan kjøres på nytt og bytter blokken ut i stedet
for å legge en ny oppå.

> Underveis fant testen at `IBM Plex Sans 700` og `IBM Plex Mono 400` var i bruk
> uten å være lastet – nettleseren syntetiserte dem. Begge er nå med.

### 3. Avgangstavla startet tom
Siste stoppested ble husket, men ikke avgangene. Nå bufres de siste 12
avgangene, og tavla viser dem umiddelbart – nedtonet, med «Lagret liste ·
oppdaterer…» over – til friske tall er på plass. Bufferet regnes som ubrukelig
etter en time.

Feiler hentingen mens du har en brukbar liste, beholdes lista med en beskjed i
stedet for at et feilkort tar over. Verifisert med nettverket avslått:
**12 rader på skjermen uten nett.**

> Testene mot Entur var samtidig skjøre: to av dem brukte «nå» som tidspunkt og
> feilet om natta, når det ikke går buss fra Fredrikstad. De bruker nå neste
> hverdag kl. 08.

---

## Sammenleggbare seksjoner, og paneler som ikke dekker hverandre

**Seksjoner kan legges ned.** Hurtigreise, Transport, Nylige og I nærheten har
fått en pil du kan trykke på. Valget huskes til neste gang du åpner appen.

- Animasjonen bruker `grid-template-rows: 1fr → 0fr`, som gir myk høyde uten at
  koden må måle innholdet – ingen hopp når listene endrer lengde.
- Lukket seksjon viser en teller («2 reiser», «3 valgt»), så du ser hva som
  ligger der uten å måtte åpne den.
- **Planlegg reisen** og **Når** er bevisst *ikke* sammenleggbare. De er selve
  skjemaet; å kunne skjule dem ville bare gitt en tilstand der appen ser ødelagt ut.

Målt: «I nærheten» går fra 118 px til 34 px.

**Kartkortet kan legges ned.** Det dekket store deler av kartet. Nå har det et
grep øverst – ett trykk gjør det om til bare overskriften, og valget huskes.
Målt: 265 px → 75 px, altså 22 % av skjermen tilbake til kartet.

**Panelene overlappet hverandre.** Kartkortet, lagvelgeren og knappekolonnen lå
alle forankret til bunnen med *faste* pikselverdier (`bottom: 216px`, `224px`,
`104px`). Verdiene stemte bare for én bestemt korthøyde, så i praksis la
lagvelgeren seg oppå stoppestedskortet og skjulte innholdet – akkurat som på
skjermbildet.

Nå stables de:

- `--card-h` og `--layer-h` måles i JS og settes som CSS-variabler.
- Lagvelgeren ligger på `bottom: calc(12px + var(--card-h))`, knappene på
  `calc(18px + var(--card-h) + var(--layer-h))`.
- En `ResizeObserver` måler på nytt når et panel endrer høyde, så det holder
  uansett hvor langt kortet blir.
- Åpner du lagvelgeren mens kortet er oppe, legges kortet ned automatisk – to
  fulle paneler ville dekket nesten hele kartet. Det spretter opp igjen etterpå.

Verifisert med en test som regner ut faktisk overlappende areal mellom alle
panelparene i tre tilstander: **0 px² i samtlige.**

---

## Hurtigreiser fra A til B

Hurtigreise besto av to faste steder – Hjem og Jobb. Nå kan du lagre hele ruter:
**«Hjem → treningen»**, **«Hjem → mormor»**, hva som helst. Kortet viser neste
avgang med linjenummer og nedtelling, og ett trykk søker reisen.

**«Lagrede reiser» og «hurtigreise» var to navn på det samme**, så de er slått
sammen. En lagret reise *er* en hurtigreise. Du lager dem på to måter:

- **«+ Ny hurtigreise»** øverst i Plan. «Fra» er forhåndsvalgt til Hjem, og du
  velger «Til» med Hjem/Jobb/Min posisjon-snarveier eller søk.
- **«Lagre»** på et søkeresultat, som før.

Under panseret:

- Sanntid for alle hurtigreisene hentes i **ett** HTTP-kall. GraphQL-aliaser
  (`q0: trip(…) q1: trip(…)`) gjør at tre reiser koster én forespørsel i stedet
  for tre. Maks tre kort får sanntid, og ikke oftere enn hvert 60. sekund.
- «Min posisjon» løses opp til et stedsnavn først når du lagrer, ikke ved hvert
  oppslag.
- Holdeplasser lagres med NSR-id, adresser med koordinater – samme skille som
  reiseplanleggeren ellers.

**To feil testen fanget underveis:**

1. **Forslagslisten lå bak dialogen.** `#ac` lå inne i `#app`, som har sin egen
   stablingskontekst – da hjelper ingen z-index mot en dialog utenfor. Resultatet
   var at man *ikke kunne velge et sted i det hele tatt* i editoren. Lista er nå
   flyttet ut av `#app`. Dette rammet enhver dialog med søkefelt, ikke bare denne.
2. **Nøstede knapper igjen.** Endre-knappen på hurtigreise-kortet havnet nesten
   inni kortets egen knapp – samme felle som Hjem/Jobb-kortet hadde. Testen leter
   nå etter `button button` begge steder.

---

## Tomrommet under «Finn reise», og lås mot knipe-zoom

**«I nærheten» fyller plassen.** Under knappen lå det rundt 250 px død flate.
Der ligger nå de nærmeste stoppestedene med hva som faktisk går derfra – linje,
retning og nedtelling. Ett trykk åpner tavla for det stoppet.

Det er ikke fyllstoff: det er den vanligste tingen du vil vite når du åpner
appen, og det sparer et fanebytte pluss et søk. Detaljene:

- Stopp og avganger hentes i **ett** kall (`NEARBY_Q`), ikke ett per stopp.
- Oppdateres hvert 45. sekund, og bare mens Plan-fanen faktisk er synlig.
- Har du alt gitt posisjonstilgang, hentes den stille ved oppstart – listen står
  klar før du rekker å trykke. Er tillatelsen **ikke** gitt, vises et kort med en
  knapp i stedet, slik at spørsmålet kommer av en handling og ikke av seg selv.

Målt i Chromium: innholdet i Plan-fanen rekker nå 763 px mot 742 px synlig flate,
altså fylt helt ut, mot 610 px før.

**Knipe-zoom er sperret – unntatt på kartet.** Å knipe grensesnittet større
forskjøv hele oppsettet. Nå:

- `user-scalable=no, maximum-scale=1` i viewport
- `touch-action: pan-y` på `body`, `pan-x` på de sidelengs rullefeltene
- `touch-action: none` på `#map`, så Leaflet håndterer knipingen selv
- iOS bryr seg ikke om viewport-flagget, så `gesturestart`/`gesturechange`
  stoppes i JS, sammen med to-finger-`touchmove` og dobbelttrykk – alt med et
  unntak for alt som skjer inne i `#map`

Verifisert med ekte to-finger-gester i nettleser: appens skala står på 1,0 før og
etter knip, mens kartet zoomet fra nivå 13 til 16 i samme test.

---

## Sveip, tre faner og færre trykk

**Sveip med rundgang.** Sidelengs sveip bytter fane, og du treffer aldri en vegg:
fra siste fane sveiper du videre til den første, og motsatt vei. Detaljer som
gjør at det ikke kommer i veien:

- Sveipet låses til én akse først – loddrett bevegelse ruller som normalt.
- Terskel er 40 px absolutt, deretter 64 px *eller* et raskt kast. Uten
  minsteavstanden kunne et skjelvent trykk bytte fane.
- På Kart starter sveipet bare fra ytterste 32 px, ellers ville du ikke fått
  panorert kartet.
- Sperret mens søkelisten, «Mer»-arket eller en dialog er åpen.
- Kort haptisk klikk når fanen faktisk skifter.

**Tilbakeknappen virker.** Tidligere lukket Androids tilbakeknapp hele appen.
Nå går den ett steg: dialog → «Mer»-ark → underskjerm i Plan → forrige fane →
og først da ut. Implementert med `pushState`/`popstate` og en `applyState()`
som gjenoppretter uten å legge nye steg på historikken.

**Fra fire faner til tre.** «Lagret» var en fast fane for ting man åpner sjelden.
Lagrede reiser, lagrede steder, utseende, feillogg og installasjon ligger nå i et
«Mer»-ark ett trykk unna i topplinjen. Menyen rommer bare det du faktisk veksler
mellom: **Plan · Avganger · Kart**. Sveipesirkelen ble kortere av samme grunn.

**Færre trykk ellers:**

| Før | Nå |
|---|---|
| Appen åpnet alltid på Plan med tomt avgangsbrett | Gjenopptar siste fane og siste stoppested – null trykk for å se hva som går |
| «Hjem» betød *reis fra* hjem | Kortet du trykker er **målet** – «Hjem» betyr reis hjem |
| Bytte fane krevde å strekke seg til bunnmenyen | Sveip hvor som helst på flaten |
| Tilbake førte ut av appen | Tilbake går ett steg innover |

---

## Kartlag som i Ruter-appen

Fem knapper lå strødd langs kartkanten. De er samlet i én lagvelger:

- **Kartvisning:** Standard · Satellitt · Topografi
- **Vis på kartet:** Kjøretøy i sanntid · Bysykkel · Severdigheter

Satellittbildene kommer fra **Esri World Imagery**, topografien fra
**Kartverkets** åpne WMTS. Begge uten API-nøkkel, som resten av appen. Alle tre
er verifisert i nettleser: flisene lastes og attribusjonen bytter med laget.
Service workeren cacher nå også disse flisene, med tak på 600.

Kjøretøyposisjoner fantes fra før, men lå bak et ikon uten forklaring. I
lagvelgeren står det hva de er, og en prikk på lagknappen viser når et lag er på.

---

## Norsk flaggpalett, farge per fane, kompaktere flate

**Paletten.** Flaggblå (`#0A2A57`) bærer topplinje, bunnmeny og app-ikon.
Flaggrød (`#C8102E`) er reservert primærhandlingen – «Finn reise», målpunktet B
og innstilte avganger. Ikonet er tegnet på nytt i flaggets tre farger: blå flate,
hvit rute, rød destinasjon med hvit ring rundt. Mørk modus bruker samme to farger,
bare lysnet så kontrasten holder.

**Egen farge per fane.** Hver fane har sin identitet, brukt kun på topplinjens
glød, den stiplede stripa, indikatoren og det aktive ikonet – aldri på innholdet:

| Fane | Farge | |
|---|---|---|
| Plan | `#1B4FA0` | flaggblå |
| Avganger | `#C8102E` | flaggrød |
| Kart | `#0F6F6C` | fjord |
| Lagret | `#8A5A12` | messing |

Fargen ligger i `--tab` på `#app[data-tab]`, og elementene som bruker den har
`transition: background .45s`, så skiftet **glir** over i stedet for å hoppe.

**Bevegelse, uten å overdrive.** Alt er kort og enveis:
- Fanebytte glir sidelengs i den retningen du trykket – rekkefølgen i menyen
  bestemmer om det går framover eller bakover.
- Avgangsrader og reisekort kommer inn forskjøvet, 26 ms per rad med tak på
  260 ms, så en lang liste aldri føles treg.
- Avganger som går straks får et lavmælt lysstrøk over raden.
- Indikatoren i bunnmenyen fjærer på plass, ikoner skalerer lett ved trykk.
- Alt slås av under `prefers-reduced-motion`.

**Kompaktering.** Målt i Chromium på 384 px:

| | Før | Etter |
|---|---|---|
| Topplinje | 64 px | 56 px |
| Bunnmeny | 67 px | 56 px |
| Bunnen av Plan-skjemaet | 688 px | 610 px |

Hele reiseskjemaet – hurtigreise, A/B, verktøy, tidsvalg, transport og
«Finn reise» – får nå plass over skjermkanten med 130 px til overs, mot 54 px før.

Kontrasten er målt etter endringen: laveste forhold er 5,0:1 (brødtekst), altså
over WCAG AA på alt.

**Bonus fra måleoppsettet:** Leaflet kaster hardt på `NaN`-koordinater og river da
med seg hele kartvisningen. Alt som skal på kartet passerer nå en `okLL()`-vakt.

---

## Hjem og Jobb i Hurtigreise virket ikke

To feil samtidig.

**1. Kortet var ugyldig HTML.** Endre-knappen lå som `<button>` *inne i* kortets
egen `<button>`. Nøstede knapper er ikke lov, så HTML-parseren lukker det ytre
kortet i det øyeblikket den møter det indre. Resultatet ble at navnet og
sanntidslinjen havnet **utenfor** knappen — kortet mistet innholdet sitt og
klikkhåndteringen gikk i stykker så snart Hjem eller Jobb var satt opp.
Endre-knappen er nå en søsken-knapp i en egen `.comm-cell`, absolutt plassert
oppe i hjørnet. Testen leter etter `button button` og feiler hvis noen nøster igjen.

**2. `pickAC` kastet TypeError.** Da du trykket på et treff i søkelisten:

```js
if(acFor.id==='commInput'){acClose();acFor.blur();pickCommuter(it)}
```

`acClose()` setter `acFor=null`, og linjen etter kaller `acFor.blur()`. Hver
eneste gang. Det tok også stoppestedssøket i Avgangsfanen. Feltet tas nå vare på
i en lokal variabel før `acClose()`.

I tillegg: oppsettpanelet har fått en tittel som sier hva du holder på med
(«Sett opp Hjem» / «Endre Jobb»), søkefeltet ligger på egen linje i full bredde,
og «Din posisjon» / «Avbryt» er to like brede knapper under. Endre-ikonet er byttet
fra et kryss til en blyant — et kryss så ut som «slett».

---

## Symmetri i menyene

Radene var bygget som `flex-wrap` med knapper av ulik bredde, så høyrekanten ble
ujevn og «Båt» havnet alene på en tredje linje i avgangsfilteret.

| Rad | Før | Nå |
|---|---|---|
| Via-stopp / Bytt / Din posisjon | tre ulike bredder på én flytende rad | `grid` med tre like kolonner — målt 113/113/113 px |
| Transport (Plan) | fem chips, flyt | `grid` 3×2 med «Alle» først — 114 px hver |
| Filter (Avganger) | seks chips, «Båt» alene på rad tre | samme 3×2-rutenett — identisk med Plan |

Begge transportvelgerne bygges nå fra **én** felles liste og deler kode for
opptegning og av/på-logikk, så de kan ikke drive fra hverandre igjen. «Alle» er
lagt til i Plan-fanen også — det gir seks celler som fyller nøyaktig to hele rader,
og en tydelig måte å nullstille valget på.

«+ Legg til via-stopp» ble tidligere skjult ved fire stopp, noe som ville etterlatt
en tom rutenettcelle. Den deaktiveres nå i stedet, så raden holder formen.

Bredene er verifisert i ekte Chromium på 384 px (Galaxy S24), ikke bare i CSS.

---

## Grensesnitt

**`[hidden]` virket ikke.** `.chip-btn` og `.live-pill` setter `display:inline-flex`,
som overstyrer nettleserens `[hidden]{display:none}`. Derfor sto «Vis på kart» og
det grønne LIVE-merket alltid synlig — også på skjermbildet ditt, før du hadde valgt
et stoppested. Én regel fikser alle tre steder:

```css
[hidden]{display:none!important}
```

**Topplinjen.** «NORGE · PENDLER · SANNTID» brøt over to linjer og skjøv logoen ut
av balanse. Undertittelen er kortet til «NORGE · SANNTID» med `white-space:nowrap`
og fast `min-height` på topplinjen.

**Feil kan kopieres.** Du skrev at du ikke fikk kopiert feilmeldingene. Nå:
- feilmeldinger med teknisk detalj får en «KOPIER»-knapp og blir stående i 11 sekunder
- «Prøv igjen» og «Kopier feilen» på feilkort i Plan- og Avgangsfanen
- en feillogg under **Lagret** som holder de 40 siste feilene, med kopierknapp
- `window.onerror` og `unhandledrejection` fanges også opp

**Avvik vises.** `situations` hentes nå i både avgangs- og reisespørringen, vises som
banner i avgangsfanen, som «N avvik»-merke på reisekortene og under hver etappe i
detaljvisningen. Innstilte avganger merkes «INNSTILT» og gjennomstrekes.

---

## Priser

`TripPattern.fareProducts` finnes ikke i v3, så den gamle prisspørringen feilet
alltid og falt stille tilbake til anslaget. Kallet er fjernet, og anslaget er
tydelig merket «(anslag)» også i Lagret-fanens forbehold.

---

## Ikoner og installasjon

Manifestet pekte bare på SVG, og appen tegnet i tillegg et apple-touch-icon på
`<canvas>` ved hver oppstart. Chrome bygger en WebAPK ved installasjon og vil ha
**ekte PNG i 192 og 512 px** — derfor så hjemskjermikonet uskarpt eller beskåret ut.

Nytt sett i `icons/`:

| Fil | Bruk |
|---|---|
| `icon-192.png`, `icon-512.png` | installasjonsikon (`any`) |
| `maskable-192.png`, `maskable-512.png` | Android adaptivt ikon, motivet innenfor 66 % trygg sone |
| `monochrome-512.png` | Samsung One UI temaikon |
| `apple-touch-icon.png` | iOS hjemskjerm, 180 px |
| `favicon.svg`, `favicon-32.png`, `favicon.ico` | fanikon |
| `icon.svg`, `maskable.svg`, `monochrome.svg` | vektorkilder |
| `logo.svg` | merkevare-lockup, ordmerket er ekte vektorbaner |

Canvas-koden er fjernet. Service worker registreres med `{scope:'./'}` og alle
stier i manifestet er relative, så alt virker i en undermappe på GitHub Pages.
`sw.js` har fått navigasjonsfallback, så dyplenker og offline-start fungerer.

---

## Slik legger du det ut

1. Last opp alt til rota av repoet, med `icons/` som en ekte mappe.
2. Pass på at `.nojekyll` blir med.
3. **Settings → Pages** → `Deploy from a branch`, `main`, `/ (root)`.
4. Åpne `https://<bruker>.github.io/<repo>/` i Chrome → menyen → *Legg til på startsiden*.

Oppdaterer ikke ikonet seg? Android cacher WebAPK-ikonet: avinstaller appen, tøm
Chromes bufrede bilder, last siden på nytt og installer igjen.
