"""Måler tetthet, fanefarger og kontrast i ekte Chromium."""
import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8114),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()

def lum(c):
    def f(v):
        v/=255
        return v/12.92 if v<=.03928 else ((v+.055)/1.055)**2.4
    return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])
def ratio(a,b):
    L1,L2=sorted([lum(a),lum(b)],reverse=True)
    return round((L1+.05)/(L2+.05),2)
def parse(s):
    n=[int(float(x)) for x in s[s.find('(')+1:s.find(')')].split(',')[:3]]
    return tuple(n)

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},device_scale_factor=2,
                                is_mobile=True,has_touch=True,ignore_https_errors=True)
        pg=await ctx.new_page(); errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8114/index.html",wait_until="load")
        await pg.wait_for_timeout(2500)
        out={}

        # Tetthet: hvor langt ned rekker innholdet i Plan-fanen
        out["planContentBottom"]=await pg.evaluate("""()=>{
          const els=[...document.querySelectorAll('#plan-form > *')].filter(e=>e.offsetParent);
          return Math.round(Math.max(...els.map(e=>e.getBoundingClientRect().bottom)));
        }""")
        out["viewportHeight"]=854
        out["topbarHeight"]=await pg.evaluate("()=>Math.round(document.getElementById('topbar').getBoundingClientRect().height)")
        out["navHeight"]=await pg.evaluate("()=>Math.round(document.getElementById('bottomNav').getBoundingClientRect().height)")
        out["ctaBottom"]=await pg.evaluate("()=>Math.round(document.querySelector('#viewPlan .cta').getBoundingClientRect().bottom)")

        # Farger per fane
        tabs={}
        for t in ["plan","depart","map"]:
            await pg.click(f".nav-btn[data-tab='{t}']"); await pg.wait_for_timeout(800)
            tabs[t]={
              "navInd":await pg.evaluate("()=>getComputedStyle(document.getElementById('navInd')).backgroundColor"),
              "activeIcon":await pg.evaluate("()=>getComputedStyle(document.querySelector('.nav-btn.active svg')).color"),
              "tabVar":(await pg.evaluate("()=>getComputedStyle(document.getElementById('app')).getPropertyValue('--tab')")).strip(),
            }
        out["tabs"]=tabs
        out["uniqueAccents"]=len({v["navInd"] for v in tabs.values()})

        await pg.click(".nav-btn[data-tab='plan']"); await pg.wait_for_timeout(700)

        # Kontrast på nøkkeltekst
        pairs={}
        async def col(sel,prop):
            return parse(await pg.evaluate(f"()=>getComputedStyle(document.querySelector({sel!r})).{prop}"))
        pairs["merkenavn på topplinje"]=ratio(await col('.brand-txt h1','color'),(10,42,87))
        pairs["undertittel på topplinje"]=ratio(await col('.brand-txt small','color'),(10,42,87))
        pairs["brødtekst på papir"]=ratio(await col('.hint','color'),parse(await pg.evaluate("()=>getComputedStyle(document.body).backgroundColor")))
        pairs["CTA-tekst"]=ratio((255,255,255),(200,16,46))
        pairs["inaktiv fanetekst"]=ratio(await col('.nav-btn:not(.active)','color'),(10,42,87))
        out["kontrast"]=pairs

        # Overganger finnes
        out["navIndHarFargeovergang"]="background" in (await pg.evaluate(
            "()=>getComputedStyle(document.getElementById('navInd')).transitionProperty"))
        out["viewDir"]=await pg.evaluate("()=>document.getElementById('views').dataset.dir")
        out["reducedMotionRespektert"]="prefers-reduced-motion" in open("/home/claude/build/index.html",encoding="utf-8").read()
        out["pageErrors"]=sorted(set(errs))
        print(json.dumps(out,indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
