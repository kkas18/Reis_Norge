"""Tar skjermbildene som Android viser i installasjonsdialogen."""
import asyncio, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8220),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,
            ignore_https_errors=True,permissions=["geolocation"],
            geolocation={"latitude":59.9119,"longitude":10.7504})
        pg=await ctx.new_page()
        await pg.goto("http://127.0.0.1:8220/index.html",wait_until="load")
        await pg.wait_for_timeout(4000)
        await pg.evaluate("""()=>{localStorage.setItem('reis.favJourneys',JSON.stringify([
          {from:{n:'Jernbanetorget',lat:59.911898,lon:10.75038,id:'NSR:StopPlace:58366'},
           to:{n:'Majorstuen',lat:59.929,lon:10.714,id:'NSR:StopPlace:58381'},vias:[]}]));
          localStorage.setItem('reis.home',JSON.stringify({name:'Jernbanetorget',lat:59.911898,lon:10.75038,id:'NSR:StopPlace:58366'}));
          renderCommuter();renderQuickTrips();}""")
        await pg.wait_for_timeout(3500)
        await pg.screenshot(path="icons/shot-plan.png")

        await pg.evaluate("()=>switchTab('depart')")
        try: await pg.wait_for_function("()=>document.querySelectorAll('#depList .dep-row').length>2",timeout=20000)
        except Exception: pass
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path="icons/shot-depart.png")

        await pg.evaluate("()=>switchTab('map')"); await pg.wait_for_timeout(2500)
        await pg.evaluate("()=>setBasemap('satellitt')")
        try:
            await pg.wait_for_function("()=>[...document.querySelectorAll('.leaflet-tile')].filter(i=>i.complete&&i.naturalWidth>0).length>=6",timeout=15000)
        except Exception: pass
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path="icons/shot-map.png")
        print("skjermbilder lagret")
        await b.close()
asyncio.run(main()); srv.shutdown()
