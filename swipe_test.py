"""Sveiper med ekte touch-hendelser i Chromium og sjekker rundgang + tilbakeknapp."""
import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8130),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,ignore_https_errors=True)
        pg=await ctx.new_page(); errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8130/index.html",wait_until="load")
        await pg.wait_for_timeout(2500)
        cdp=await ctx.new_cdp_session(pg)

        async def swipe(dx, start_x=200, y=420, steps=8, ms=18):
            await cdp.send("Input.dispatchTouchEvent",
                {"type":"touchStart","touchPoints":[{"x":start_x,"y":y}]})
            for i in range(1,steps+1):
                await cdp.send("Input.dispatchTouchEvent",
                    {"type":"touchMove","touchPoints":[{"x":start_x+dx*i/steps,"y":y}]})
                await pg.wait_for_timeout(ms)
            await cdp.send("Input.dispatchTouchEvent",
                {"type":"touchEnd","touchPoints":[]})
            await pg.wait_for_timeout(900)

        async def tab():
            return await pg.evaluate("()=>document.getElementById('app').dataset.tab")

        out={}
        async def sw_next(back=False):
            # Kartet krever kantstart, ellers panorerer man i stedet
            edge = 12 if await tab()=="map" else (250 if back else 200)
            await swipe(150 if back else -150, start_x=edge)
            return await tab()

        seq=[await sw_next() for _ in range(4)]
        out["sveip venstre fra Plan"]=seq
        out["rundgang framover"]= seq==["depart","map","plan","depart"]

        await pg.evaluate("()=>switchTab('plan')"); await pg.wait_for_timeout(600)
        back=[await sw_next(True) for _ in range(4)]
        out["sveip høyre fra Plan"]=back
        out["rundgang bakover"]= back==["map","depart","plan","map"]

        # kartet skal fortsatt kunne panoreres midt på skjermen
        await pg.evaluate("()=>switchTab('map')"); await pg.wait_for_timeout(700)
        await swipe(-150, start_x=200)
        out["kart beholder panorering midt på"]= (await tab())=="map"
        await swipe(-150, start_x=12)
        out["kart forlates fra kanten"]= (await tab())=="plan"

        # loddrett sveip skal ikke bytte fane
        await pg.evaluate("()=>switchTab('plan')"); await pg.wait_for_timeout(600)
        await cdp.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[{"x":200,"y":300}]})
        for i in range(1,9):
            await cdp.send("Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[{"x":205,"y":300+i*20}]})
            await pg.wait_for_timeout(16)
        await cdp.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]})
        await pg.wait_for_timeout(500)
        out["loddrett sveip bytter ikke fane"]= (await tab())=="plan"

        # tilbakeknapp
        await swipe(-150); await swipe(-150)
        before=await tab()
        await pg.go_back(); await pg.wait_for_timeout(600)
        out["tilbakeknapp: fra"]=before
        out["tilbakeknapp: til"]=await tab()
        out["tilbakeknapp går ett steg"]= out["tilbakeknapp: til"]!=before

        # Kartlag: satellitt og topografi
        await pg.evaluate("()=>switchTab('map')"); await pg.wait_for_timeout(900)
        await pg.click("#fabLayers"); await pg.wait_for_timeout(500)
        out["lagvelger åpen"]= await pg.is_visible("#layerSheet")
        styles={}
        for base in ["satellitt","topo","standard"]:
            await pg.click(f"#baseSeg button[data-base='{base}']")
            # vent til flisene faktisk er malt, ikke bare på klokka
            try:
                await pg.wait_for_function(
                    "() => [...document.querySelectorAll('.leaflet-tile')]"
                    ".filter(i=>i.complete&&i.naturalWidth>0).length >= 4", timeout=15000)
            except Exception:
                pass
            styles[base]=await pg.evaluate("""()=>{
              const im=[...document.querySelectorAll('.leaflet-tile')].filter(i=>i.complete&&i.naturalWidth>0);
              return {lastedeFliser:im.length, kilde:(im[0]&&im[0].src||'').split('/')[2]||null,
                      attribusjon:document.querySelector('.leaflet-control-attribution').textContent.trim().slice(0,60)};
            }""")
        out["kartstiler"]=styles

        # «Mer»-arket
        await pg.click("#btnMore"); await pg.wait_for_timeout(500)
        out["mer-ark synlig"]= await pg.is_visible("#moreSheet")
        out["mer-ark har lagrede reiser"]= await pg.is_visible("#moreSheet #favJourneys")
        await pg.go_back(); await pg.wait_for_timeout(600)
        out["tilbakeknapp lukker mer-arket"]= not await pg.evaluate("()=>document.getElementById('moreSheet').classList.contains('open')")

        out["feil"]=sorted(set(errs))
        print(json.dumps(out,indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
