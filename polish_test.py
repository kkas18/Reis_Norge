"""Ende-til-ende for finpussen: siste avgang, dyplenke, share target, fokus."""
import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8230),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()
BASE="http://127.0.0.1:8230/index.html"

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,
            ignore_https_errors=True,permissions=["geolocation","clipboard-read","clipboard-write"],
            geolocation={"latitude":59.9119,"longitude":10.7504})
        pg=await ctx.new_page(); errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e)))
        out={}

        # --- dyplenke rett til stoppested ---
        await pg.goto(BASE+"?stop=NSR:StopPlace:58366",wait_until="load")
        try: await pg.wait_for_function("()=>document.querySelectorAll('#depList .dep-row').length>0",timeout=25000)
        except Exception: pass
        out["dyplenke: fane"]=await pg.evaluate("()=>document.getElementById('app').dataset.tab")
        out["dyplenke: stopp"]=await pg.evaluate("()=>state.departStop&&state.departStop.name")

        # --- siste avgang i kveld ---
        await pg.click("#btnLastDep"); await pg.wait_for_timeout(4000)
        out["siste avgang: rader"]=await pg.eval_on_selector_all("#modalCard .last-row","e=>e.length")
        out["siste avgang: ledetekst"]=await pg.evaluate(
            "()=>{const e=document.querySelector('#modalCard .last-lead');return e?e.textContent.replace(/\\s+/g,' ').trim().slice(0,110):null}")
        # fokus skal ligge i dialogen
        out["fokus i dialog"]=await pg.evaluate("()=>!!document.activeElement.closest('#modalCard')")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(500)
        out["fokus tilbake etter lukking"]=await pg.evaluate("()=>document.activeElement.id||document.activeElement.className")

        # --- share target ---
        await pg.goto(BASE+"?shared=Vigelandsparken",wait_until="load")
        await pg.wait_for_timeout(4000)
        out["share target: mål satt"]=await pg.evaluate("()=>state.stops[state.stops.length-1].name")

        # --- hurtigreise-lenke ---
        await pg.goto(BASE,wait_until="load"); await pg.wait_for_timeout(2500)
        out["tripUrl"]=await pg.evaluate("""()=>tripUrl({from:{n:'A',lat:59.91,lon:10.75},to:{n:'B',lat:59.92,lon:10.70}})""")
        out["stopUrl"]=await pg.evaluate("()=>stopUrl({id:'NSR:StopPlace:58366'})")

        # --- nettverksskalering ---
        out["nettfaktor 4g"]=await pg.evaluate("()=>netFactor()")
        await pg.evaluate("""()=>{Object.defineProperty(navigator,'connection',
          {value:{effectiveType:'2g',saveData:false},configurable:true})}""")
        out["nettfaktor 2g"]=await pg.evaluate("()=>netFactor()")

        out["feil"]=sorted(set(errs))
        print(json.dumps(out,indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
