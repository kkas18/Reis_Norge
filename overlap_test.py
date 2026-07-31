"""Sjekker at ingen kartpaneler overlapper hverandre."""
import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8180),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()

BOXES = """() => {
  const g = s => { const e=document.querySelector(s);
    if(!e||e.hidden||getComputedStyle(e).display==='none') return null;
    const r=e.getBoundingClientRect(); if(!r.height) return null;
    return {top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right)}; };
  return {kort:g('#mapCard'), lagvelger:g('#layerSheet'), knapper:g('.fabs'), meny:g('#bottomNav')};
}"""

def overlap(a,b):
    if not a or not b: return 0
    dx=min(a["right"],b["right"])-max(a["left"],b["left"])
    dy=min(a["bottom"],b["bottom"])-max(a["top"],b["top"])
    return max(0,dx)*max(0,dy)

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,
            ignore_https_errors=True,permissions=["geolocation"],
            geolocation={"latitude":59.9119,"longitude":10.7504})
        pg=await ctx.new_page(); errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8180/index.html",wait_until="load")
        await pg.wait_for_timeout(3000)
        out={}

        await pg.evaluate("()=>switchTab('depart')")
        try: await pg.wait_for_function("()=>state.departStop&&state.departStop.id",timeout=20000)
        except Exception: pass
        await pg.evaluate("()=>switchTab('map')"); await pg.wait_for_timeout(2500)
        try: await pg.wait_for_function("()=>{const c=document.getElementById('mapCard');return c&&!c.hidden}",timeout=15000)
        except Exception: pass

        def report(name,boxes):
            pairs={"kort/lagvelger":overlap(boxes["kort"],boxes["lagvelger"]),
                   "knapper/kort":overlap(boxes["knapper"],boxes["kort"]),
                   "knapper/lagvelger":overlap(boxes["knapper"],boxes["lagvelger"]),
                   "kort/meny":overlap(boxes["kort"],boxes["meny"])}
            out[name]={"bokser":boxes,"overlapp":pairs,"alt klart":all(v==0 for v in pairs.values())}

        report("bare kortet", await pg.evaluate(BOXES))
        await pg.click("#fabLayers"); await pg.wait_for_timeout(900)
        report("lagvelger åpen", await pg.evaluate(BOXES))
        out["kortet ble lagt ned automatisk"]=await pg.evaluate(
            "()=>document.getElementById('mapCard').classList.contains('collapsed')")
        # velg satellitt mens begge er oppe
        await pg.click("#baseSeg button[data-base='satellitt']"); await pg.wait_for_timeout(1200)
        out["kunne velge satellitt"]=await pg.evaluate("()=>state.basemap")
        await pg.click("#fabLayers"); await pg.wait_for_timeout(900)
        report("lagvelger lukket igjen", await pg.evaluate(BOXES))
        out["kortet spratt opp igjen"]= not await pg.evaluate(
            "()=>document.getElementById('mapCard').classList.contains('collapsed')")
        out["feil"]=sorted(set(errs))
        print(json.dumps(out,indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
