import asyncio, json, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",8190),functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/build'))
threading.Thread(target=srv.serve_forever,daemon=True).start()
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=["--ignore-certificate-errors"])
        ctx=await b.new_context(viewport={"width":384,"height":854},is_mobile=True,has_touch=True,ignore_https_errors=True)
        pg=await ctx.new_page()
        ext=[]
        pg.on("request",lambda r: ext.append(r.url) if ('fonts.g' in r.url) else None)
        await pg.goto("http://127.0.0.1:8190/index.html",wait_until="load"); await pg.wait_for_timeout(2500)
        out={"eksterne fontkall":ext}
        out["lastede skrifter"]=await pg.evaluate("""async()=>{await document.fonts.ready;
          return [...document.fonts].map(f=>f.family+' '+f.weight+' '+f.status)}""")
        # sjekk at overskrifter faktisk bruker Space Grotesk
        out["vekter i bruk"]=await pg.evaluate("""()=>{
          const w=new Set();
          document.querySelectorAll('*').forEach(e=>{const s=getComputedStyle(e);
            if(e.offsetParent) w.add(s.fontFamily.split(',')[0].replace(/["']/g,'')+' '+s.fontWeight)});
          return [...w].sort()}""")
        out["norske tegn tegnes"]=await pg.evaluate("""()=>{
          const c=document.createElement('canvas').getContext('2d');
          c.font="600 20px 'IBM Plex Sans'";
          return {'æøå':Math.round(c.measureText('æøå').width), 'abc':Math.round(c.measureText('abc').width)}}""")
        print(json.dumps(out,indent=2,ensure_ascii=False))
        await b.close()
asyncio.run(main()); srv.shutdown()
