"""Sjekker sammenleggbare seksjoner og at kartkortet kan legges ned."""
import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8170),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,
            ignore_https_errors=True,permissions=["geolocation"],
            geolocation={"latitude":59.9119,"longitude":10.7504})
        pg=await ctx.new_page(); errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8170/index.html",wait_until="load")
        await pg.wait_for_timeout(3200)
        out={}

        out["seksjoner"]=await pg.eval_on_selector_all(".sec[data-sec]","e=>e.map(x=>x.dataset.sec)")

        async def h(sel): return await pg.evaluate(
            f"()=>Math.round(document.querySelector({sel!r}).getBoundingClientRect().height)")

        before=await h('.sec[data-sec="nearby"]')
        await pg.click('.sec[data-sec="nearby"] .sec-label'); await pg.wait_for_timeout(600)
        after=await h('.sec[data-sec="nearby"]')
        out["I nærheten høyde åpen/lukket"]=[before,after]
        out["lukking frigjør plass"]= after < before - 40
        out["aria-expanded"]=await pg.eval_on_selector(
            '.sec[data-sec="nearby"] .sec-label',"e=>e.getAttribute('aria-expanded')")

        # huskes over omlasting
        await pg.reload(wait_until="load"); await pg.wait_for_timeout(2500)
        closedNow = "()=>document.querySelector('.sec[data-sec=' + JSON.stringify('nearby') + ']').classList.contains('closed')"
        out["fortsatt lukket etter omlasting"]=await pg.evaluate(closedNow)
        await pg.click('.sec[data-sec="nearby"] .sec-label'); await pg.wait_for_timeout(500)
        out["kan åpnes igjen"]= not await pg.evaluate(closedNow)

        # teller på hurtigreiser
        await pg.evaluate("""()=>{localStorage.setItem('reis.favJourneys',JSON.stringify([
          {from:{n:'Hjem',lat:59.91,lon:10.75},to:{n:'Treningen',lat:59.92,lon:10.70},vias:[]}]));
          renderQuickTrips();}""")
        await pg.wait_for_timeout(400)
        out["teller på hurtigreiser"]=await pg.eval_on_selector("#quickCount","e=>e.hidden?null:e.textContent")

        # kartkortet – velg først et stoppested, ellers har kartet ikke noe kort
        await pg.evaluate("()=>switchTab('depart')")
        try:
            await pg.wait_for_function("()=>state.departStop&&state.departStop.id",timeout=20000)
        except Exception: pass
        await pg.evaluate("()=>switchTab('map')"); await pg.wait_for_timeout(2500)
        try:
            await pg.wait_for_function("()=>{const c=document.getElementById('mapCard');return c&&!c.hidden}",timeout=15000)
        except Exception: pass
        openH=await h('#mapCard')
        out["kartkort synlig"]= openH>0
        await pg.click("#mapCard .mc-grip"); await pg.wait_for_timeout(600)
        closedH=await h('#mapCard')
        out["kartkort høyde åpen/lagt ned"]=[openH,closedH]
        out["frigjort kartflate (px)"]=openH-closedH
        out["andel av skjermen frigjort"]=round((openH-closedH)/854*100)
        out["knappene flyttet ned"]=await pg.evaluate(
            "()=>document.getElementById('viewMap').classList.contains('card-collapsed')")
        await pg.click("#mapCard .mc-grip"); await pg.wait_for_timeout(600)
        out["kan åpnes igjen (kart)"]= (await h('#mapCard'))>closedH+40
        out["feil"]=sorted(set(errs))
        print(json.dumps(out,indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
