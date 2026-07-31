"""Måler utfylling av Plan-fanen og at knipe-zoom er sperret utenom kartet."""
import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8150),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,
                                ignore_https_errors=True,permissions=["geolocation"],
                                geolocation={"latitude":59.9119,"longitude":10.7504})
        pg=await ctx.new_page(); errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8150/index.html",wait_until="load")
        await pg.wait_for_timeout(3000)
        out={}

        # vent til «I nærheten» har kort
        try:
            await pg.wait_for_function("() => document.querySelectorAll('#nearby .near-card').length>0",timeout=15000)
        except Exception: pass
        out["antall nærhetskort"]=await pg.eval_on_selector_all("#nearby .near-card","e=>e.length")
        out["kort med avganger"]=await pg.eval_on_selector_all(
            "#nearby .near-card","e=>e.filter(c=>c.querySelectorAll('.nc-line').length>0).length")
        out["første kort"]=await pg.evaluate("""()=>{const c=document.querySelector('#nearby .near-card');
          return c?{stopp:c.querySelector('.nc-top b').textContent,
                    avstand:c.querySelector('.nc-top span').textContent,
                    linjer:[...c.querySelectorAll('.nc-line')].map(l=>l.textContent.replace(/\\s+/g,' ').trim())}:null}""")

        m=await pg.evaluate("""()=>{
          const els=[...document.querySelectorAll('#plan-form > *')].filter(e=>e.offsetParent);
          const bottom=Math.round(Math.max(...els.map(e=>e.getBoundingClientRect().bottom)));
          const pad=document.querySelector('#viewPlan .scrollpad');
          return {innholdBunn:bottom, synligHoyde:Math.round(pad.getBoundingClientRect().height),
                  rullehoyde:pad.scrollHeight};
        }""")
        out["utfylling"]=m
        out["tomrom under innhold"]=max(0,m["synligHoyde"]-m["innholdBunn"]+  # bottom er viewport-relativ
                                        0) if m["innholdBunn"]<m["synligHoyde"] else 0

        # zoom-sperre
        out["viewport"]=await pg.evaluate("()=>document.querySelector('meta[name=viewport]').content")
        out["touchAction body"]=await pg.evaluate("()=>getComputedStyle(document.body).touchAction")
        out["touchAction kart"]=await pg.evaluate("()=>{const m=document.getElementById('map');return m?getComputedStyle(m).touchAction:null}")

        # knip utenfor kart -> skal ikke endre skala
        cdp=await ctx.new_cdp_session(pg)
        async def pinch(x,y,spread=60):
            await cdp.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[
                {"x":x-10,"y":y,"id":1},{"x":x+10,"y":y,"id":2}]})
            for i in range(1,6):
                d=10+spread*i/5
                await cdp.send("Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[
                    {"x":x-d,"y":y,"id":1},{"x":x+d,"y":y,"id":2}]})
                await pg.wait_for_timeout(30)
            await cdp.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]})
            await pg.wait_for_timeout(400)
        before=await pg.evaluate("()=>visualViewport.scale")
        await pinch(190,600)
        out["skala i appen (før/etter)"]=[before,await pg.evaluate("()=>visualViewport.scale")]

        await pg.evaluate("()=>switchTab('map')"); await pg.wait_for_timeout(1500)
        z0=await pg.evaluate("()=>map&&map.getZoom()")
        await pinch(190,420)
        z1=await pg.evaluate("()=>map&&map.getZoom()")
        out["kartzoom (før/etter knip)"]=[z0,z1]
        out["kartet lar seg fortsatt zoome"]= (z1 is not None and z0 is not None and z1!=z0)
        out["feil"]=sorted(set(errs))
        print(json.dumps(out,indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
