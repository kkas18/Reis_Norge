"""Ende-til-ende: lag en hurtigreise «Hjem → et sted», og sjekk at den virker."""
import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8160),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,
            ignore_https_errors=True,permissions=["geolocation"],
            geolocation={"latitude":59.9119,"longitude":10.7504})
        pg=await ctx.new_page(); errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8160/index.html",wait_until="load")
        await pg.wait_for_timeout(3000)
        out={}

        # Sett opp Hjem
        await pg.click(".comm-btn[data-k='home']"); await pg.wait_for_timeout(400)
        await pg.fill("#commInput","Jernbanetorget"); await pg.wait_for_timeout(1800)
        await pg.click("#ac .ac-item:first-child"); await pg.wait_for_timeout(900)
        out["hjem satt"]=await pg.eval_on_selector(".comm-btn[data-k='home'] .cb-name","e=>e.textContent")

        # Ny hurtigreise: Hjem -> søkt sted
        await pg.click("#qtAdd"); await pg.wait_for_timeout(500)
        out["fra forhåndsvalgt"]=await pg.eval_on_selector("#modalCard [data-row='from'] .qte-pick b","e=>e.textContent")
        # velg Til via søk
        await pg.click("#modalCard [data-row='to'] .qte-chip[data-k='search']")
        await pg.wait_for_timeout(400)
        await pg.fill("#qtInput","Vigelandsparken"); await pg.wait_for_timeout(1900)
        await pg.click("#ac .ac-item:first-child"); await pg.wait_for_timeout(700)
        picks=await pg.eval_on_selector_all("#modalCard .qte-pick b","e=>e.map(x=>x.textContent)")
        out["valgt fra/til"]=picks
        await pg.click("#qtSave"); await pg.wait_for_timeout(1200)

        out["lagret i localStorage"]=await pg.evaluate("()=>localStorage.getItem('reis.favJourneys')")
        out["antall hurtigreiser"]=await pg.eval_on_selector_all("#quickTrips .qt-card","e=>e.length")
        if not out["antall hurtigreiser"]:
            print(json.dumps(out,indent=2,ensure_ascii=False)); await b.close(); return
        out["rutetekst"]=await pg.eval_on_selector("#quickTrips .qt-card .qt-route","e=>e.textContent.replace(/\\s+/g,' ').trim()")
        try:
            await pg.wait_for_function(
                "()=>{const e=document.querySelector('#quickTrips .qt-live');return e&&!/—/.test(e.textContent)}",timeout=20000)
        except Exception: pass
        out["sanntidslinje"]=await pg.eval_on_selector("#quickTrips .qt-live","e=>e.textContent.replace(/\\s+/g,' ').trim()")
        out["antall trip-kall"]=await pg.evaluate("()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('journey-planner')).length")

        # Ett trykk skal søke reisen
        await pg.click("#quickTrips .qt-card"); await pg.wait_for_timeout(3500)
        out["viser resultater"]=await pg.evaluate("()=>document.getElementById('plan-results').classList.contains('active')")
        out["antall reisekort"]=await pg.eval_on_selector_all("#resList .trip-card","e=>e.length")
        out["stopp satt"]=await pg.evaluate("()=>state.stops.map(s=>s.name)")

        # dukker også opp i Mer-arket
        await pg.evaluate("()=>openMore()"); await pg.wait_for_timeout(500)
        out["i mer-arket"]=await pg.eval_on_selector_all("#favJourneys .fav-card","e=>e.length")
        out["feil"]=sorted(set(errs))
        print(json.dumps(out,indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
