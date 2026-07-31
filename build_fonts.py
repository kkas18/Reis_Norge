#!/usr/bin/env python3
"""Subsetter skriftene til norsk tegnsett og legger dem inn i index.html som
base64-WOFF2. Da slipper appen Google Fonts: den tegner riktig med én gang,
også offline og på treg forbindelse."""
import base64, io, os, re, sys
from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))

# Tegnsett: latin + norsk + de symbolene grensesnittet faktisk bruker.
CHARS = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "0123456789"
    "ÆØÅæøå"                       # norsk
    "ÄÖÜäöüÉéÈèÀàÂâÔôÛûÇçÑñÍíÓóÚúÝý"  # navn med aksent i NSR-data
    " .,:;!?'\"()[]{}<>/\\|@#%&*+-–—_=~^"
    "·°£$€kr"                       # priser og enheter
    "→←↑↓×✓«»…"                     # piler og typografi
)
CODEPOINTS = sorted({ord(c) for c in CHARS})

# Bare vektene grensesnittet faktisk bruker.
FONTS = [
    ("Space Grotesk", 700, "/tmp/sg/SpaceGrotesk-2.0.0/ttf/static/SpaceGrotesk-Bold.ttf"),
    ("Space Grotesk", 600, "/tmp/sg/SpaceGrotesk-2.0.0/ttf/static/SpaceGrotesk-SemiBold.ttf"),
    ("IBM Plex Sans", 400, "/tmp/ps/ibm-plex-sans/fonts/complete/ttf/IBMPlexSans-Regular.ttf"),
    ("IBM Plex Sans", 600, "/tmp/ps/ibm-plex-sans/fonts/complete/ttf/IBMPlexSans-SemiBold.ttf"),
    ("IBM Plex Sans", 700, "/tmp/ps/ibm-plex-sans/fonts/complete/ttf/IBMPlexSans-Bold.ttf"),
    ("IBM Plex Mono", 400, "/tmp/pm/ibm-plex-mono/fonts/complete/ttf/IBMPlexMono-Regular.ttf"),
    ("IBM Plex Mono", 600, "/tmp/pm/ibm-plex-mono/fonts/complete/ttf/IBMPlexMono-SemiBold.ttf"),
]


def subset_to_woff2(path, codepoints):
    opts = Options()
    opts.layout_features = ["kern", "liga", "calt", "ccmp", "locl"]
    opts.desubroutinize = True
    opts.drop_tables += ["DSIG"]
    opts.notdef_outline = False
    opts.recalc_bounds = True
    opts.name_IDs = ["*"]
    opts.name_legacy = False
    opts.name_languages = ["*"]

    font = TTFont(path)
    sub = Subsetter(options=opts)
    sub.populate(unicodes=codepoints)
    sub.subset(font)
    font.flavor = "woff2"
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def main():
    missing = [p for _, _, p in FONTS if not os.path.exists(p)]
    if missing:
        # SemiBold finnes ikke i alle Space Grotesk-utgivelser – fall tilbake på Medium.
        alt = "/tmp/sg/SpaceGrotesk-2.0.0/ttf/static/SpaceGrotesk-Medium.ttf"
        for i, (fam, w, p) in enumerate(FONTS):
            if not os.path.exists(p) and fam == "Space Grotesk" and os.path.exists(alt):
                FONTS[i] = (fam, w, alt)
        missing = [p for _, _, p in FONTS if not os.path.exists(p)]
        if missing:
            sys.exit("Fant ikke: " + ", ".join(missing))

    faces, total = [], 0
    for fam, weight, path in FONTS:
        data = subset_to_woff2(path, CODEPOINTS)
        total += len(data)
        b64 = base64.b64encode(data).decode("ascii")
        faces.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:%d;font-display:swap;"
            "src:url(data:font/woff2;base64,%s) format('woff2')}" % (fam, weight, b64)
        )
        print(f"  {fam:16} {weight}  {len(data)/1024:6.1f} kB  (base64 {len(b64)/1024:.1f} kB)")

    css = "\n/* Skriftene ligger i fila, ikke hos Google: appen tegner riktig med\n" \
          "   én gang, også offline og uten et eksternt oppslag i kritisk sti. */\n" \
          + "\n".join(faces) + "\n"

    p = os.path.join(HERE, "index.html")
    html = open(p, encoding="utf-8").read()

    # Fjern Google Fonts-lenkene og forhåndskoblingene til dem.
    html = re.sub(r'\s*<link rel="preconnect" href="https://fonts\.g[^"]*"[^>]*>', "", html)
    html = re.sub(r'\s*<link href="https://fonts\.googleapis\.com[^"]*" rel="stylesheet">', "", html)

    # Fjern et tidligere innlagt blokk presist, slik at skriptet kan kjøres på nytt.
    html = re.sub(r"/\* Skriftene ligger i fila[^*]*?\*/\n(?:@font-face\{[^}]*\}\n)+", "", html)

    # Sett inn rett etter <style>, uansett om det står linjeskift der eller ikke.
    m = re.search(r"<style>\s*", html)
    if not m:
        sys.exit("Fant ikke <style> i index.html")
    html = html[:m.end()] + css.lstrip("\n") + html[m.end():]
    open(p, "w", encoding="utf-8").write(html)

    print(f"\nTotalt {total/1024:.1f} kB skrift lagt inn. Google Fonts fjernet.")
    print(f"index.html er nå {os.path.getsize(p)/1024:.0f} kB")


if __name__ == "__main__":
    main()
