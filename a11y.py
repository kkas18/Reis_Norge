import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8210),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,ignore_https_errors=True)
        pg=await ctx.new_page()
        await pg.goto("http://127.0.0.1:8210/index.html",wait_until="load"); await pg.wait_for_timeout(2500)
        print(json.dumps(await pg.evaluate("""()=>{
          // Måler FAKTISK treffområde: treffer et punkt 21 px fra midten knappen?
          const hits=(b)=>{
            const r=b.getBoundingClientRect();
            const cx=r.left+r.width/2, cy=r.top+r.height/2;
            const pts=[[cx-21,cy],[cx+21,cy],[cx,cy-21],[cx,cy+21]];
            // Utenfor synlig område kan ikke elementFromPoint brukes – hopp over
            if(r.top<0||r.bottom>innerHeight) return null;
            return pts.every(([x,y])=>{
              if(x<0||y<0||x>innerWidth||y>innerHeight) return true;
              const e=document.elementFromPoint(x,y);
              return e && (e===b || b.contains(e) || e.closest('button')===b);
            });
          };
          const vis=e=>e.offsetParent!==null;
          const btns=[...document.querySelectorAll('button')].filter(vis);
          const små=btns.filter(b=>hits(b)===false);
          const utenforSkjerm=btns.filter(b=>hits(b)===null).length;
          const uten=btns.filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label'));
          const bilder=[...document.querySelectorAll('img')].filter(i=>!i.hasAttribute('alt'));
          return {synligeKnapper:btns.length,
                  utenNok44pxTreff:små.length,
                  forSmåTreffområder:små.slice(0,6).map(b=>{const r=b.getBoundingClientRect();
                     return (b.id||b.className.split(' ')[0])+' '+Math.round(r.width)+'x'+Math.round(r.height)}),
                  utenTilgjengeligNavn:uten.length, utenforSynligOmråde:utenforSkjerm,
                  bilderUtenAlt:bilder.length};
        }"""),indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
