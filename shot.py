#!/usr/bin/env python3
"""Tar skjermbilder på Galaxy S24-bredde og måler at radene faktisk er symmetriske."""
import asyncio, json, sys, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright

socketserver.TCPServer.allow_reuse_address = True
_srv = socketserver.TCPServer(("127.0.0.1", 8111),
        functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/claude/build"))
threading.Thread(target=_srv.serve_forever, daemon=True).start()

URL = "http://127.0.0.1:8111/index.html"

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=["--force-color-profile=srgb","--ignore-certificate-errors"])
        ctx = await b.new_context(viewport={"width": 384, "height": 854},
                                  device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True)
        pg = await ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(2500)

        async def widths(sel):
            return await pg.eval_on_selector_all(sel,
                "els => els.map(e => Math.round(e.getBoundingClientRect().width))")

        async def rows(sel):
            return await pg.eval_on_selector_all(sel,
                "els => [...new Set(els.map(e => Math.round(e.getBoundingClientRect().top)))].length")

        report = {}
        report["planTools"] = await widths(".plan-tools .chip-btn")
        report["planToolsRows"] = await rows(".plan-tools .chip-btn")
        report["planModes"] = await widths("#planModes .mode-chip")
        report["planModesRows"] = await rows("#planModes .mode-chip")
        report["timeSeg"] = await widths("#timeSeg button")
        report["commuter"] = await widths(".comm-btn")

        await pg.screenshot(path="/tmp/s_plan.png", full_page=False)

        # Hurtigreise-oppsett
        await pg.click(".comm-btn[data-k='home']")
        await pg.wait_for_timeout(400)
        report["csActs"] = await widths(".cs-acts .chip-btn")
        report["commSetupVisible"] = await pg.is_visible("#commSetup")
        await pg.screenshot(path="/tmp/s_comm.png")

        # Skriv i søkefeltet og velg første treff -> her krasjet den før
        await pg.fill("#commInput", "Storgata 10")
        await pg.wait_for_timeout(1600)
        acOpen = await pg.is_visible("#ac")
        report["autocompleteOpen"] = acOpen
        if acOpen:
            await pg.screenshot(path="/tmp/s_ac.png")
            await pg.click("#ac .ac-item:first-child")
            await pg.wait_for_timeout(900)
        report["homeSaved"] = await pg.evaluate("() => localStorage.getItem('reis.home')")
        report["homeLabel"] = await pg.eval_on_selector(".comm-btn[data-k='home'] .cb-name", "e => e.textContent")
        await pg.screenshot(path="/tmp/s_comm_done.png")

        # Fanefarger
        colors = {}
        for tab in ["plan", "depart", "map", "saved"]:
            await pg.click(f".nav-btn[data-tab='{tab}']")
            await pg.wait_for_timeout(900)
            colors[tab] = await pg.evaluate(
                "() => getComputedStyle(document.getElementById('navInd')).backgroundColor")
            await pg.screenshot(path=f"/tmp/t_{tab}.png")
        report["navIndPerTab"] = colors
        report["uniqueTabColors"] = len(set(colors.values()))

        await pg.click(".nav-btn[data-tab='depart']")
        await pg.wait_for_timeout(1500)
        report["depFilter"] = await widths("#depModeFilter .mf-chip")
        report["depFilterRows"] = await rows("#depModeFilter .mf-chip")
        report["ctaTop"] = await pg.evaluate(
            "() => { const b=document.querySelector('#viewPlan .cta'); return b?Math.round(b.getBoundingClientRect().bottom):null }")
        await pg.screenshot(path="/tmp/s_depart.png")

        # Via-stopp
        await pg.click(".nav-btn[data-tab='plan']")
        await pg.wait_for_timeout(500)
        await pg.click("#btnAddStop")
        await pg.wait_for_timeout(300)
        report["stopRows"] = await pg.eval_on_selector_all("#stops .stop-row", "e => e.length")
        await pg.screenshot(path="/tmp/s_via.png")

        report["pageErrors"] = sorted(set(errors))
        report["pageErrorCount"] = len(errors)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        await b.close()

asyncio.run(main())
_srv.shutdown()
