"""Verifiserer: pausing i bakgrunn, friske data ved retur, og bufret avgangsliste."""
import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8200),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,
            ignore_https_errors=True,permissions=["geolocation"],
            geolocation={"latitude":59.9119,"longitude":10.7504})
        pg=await ctx.new_page(); errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e)))
        calls=[]
        pg.on("request",lambda r: calls.append(r.url) if 'entur.io' in r.url else None)
        await pg.goto("http://127.0.0.1:8200/index.html",wait_until="load")
        await pg.wait_for_timeout(3000)
        out={}

        # --- 1) pausing i bakgrunn ---
        await pg.evaluate("()=>switchTab('depart')")
        try: await pg.wait_for_function("()=>state.departStop&&state.departStop.id",timeout=20000)
        except Exception: pass
        await pg.wait_for_timeout(1500)

        n0=len(calls)
        # simuler at appen går i bakgrunnen
        cdp=await ctx.new_cdp_session(pg)
        await cdp.send("Emulation.setPageVisibilityOverride",{"visibility":"hidden"}) if False else None
        await pg.evaluate("""()=>{Object.defineProperty(document,'visibilityState',{get:()=>'hidden',configurable:true});
                               document.dispatchEvent(new Event('visibilitychange'))}""")
        await pg.wait_for_timeout(26000)   # lenger enn 20 s avgangs-poll
        n1=len(calls)
        out["Entur-kall mens skjult (26 s)"]=n1-n0
        out["står stille i bakgrunnen"]= (n1-n0)==0

        # --- 2) friske data ved retur ---
        await pg.evaluate("""()=>{Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});
                               document.dispatchEvent(new Event('visibilitychange'))}""")
        await pg.wait_for_timeout(3000)
        n2=len(calls)
        out["Entur-kall rett etter retur"]=n2-n1
        out["henter friskt ved retur"]= (n2-n1)>0

        # --- 3) bufret avgangsliste ---
        out["buffer lagret"]=await pg.evaluate("()=>!!localStorage.getItem('reis.depCache')")
        await pg.route("**/journey-planner/**", lambda route: asyncio.ensure_future(route.abort()))
        await pg.reload(wait_until="load")
        # mål hvor raskt det står rader på skjermen uten nett
        try:
            await pg.wait_for_function("()=>document.querySelectorAll('#depList .dep-row').length>0",timeout=8000)
            shown=True
        except Exception: shown=False
        await pg.wait_for_timeout(1200)
        out["viser rader uten nett"]=shown
        out["antall rader"]=await pg.eval_on_selector_all("#depList .dep-row","e=>e.length")
        out["merket som lagret"]=await pg.evaluate("()=>{const e=document.getElementById('depStale');return e&&!e.hidden?e.textContent:null}")
        out["lista er dempet"]=await pg.evaluate("()=>document.getElementById('depList').classList.contains('stale')")
        out["feil"]=sorted(set(errs))
        print(json.dumps(out,indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
