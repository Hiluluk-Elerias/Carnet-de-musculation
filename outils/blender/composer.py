# Assemble les rendus Blender (une ou deux positions) en une image par exercice pour l'appli.
# python3 composer.py <dossier des PNG> <dossier de sortie>
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageChops
SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
LEG = {
    "gainage-planche": ["Position à tenir"],
    "poutre-repeaters": ["1 · Suspension 7 s", "2 · Pause 3 s"],
    "rdl": ["1 · Départ", "2 · Position basse"],
    "leg-curl-nordique": ["1 · Départ", "2 · Descente freinée"],
    "y-sol": ["1 · Bras au sol", "2 · Bras décollés"],
    "split-squat": ["1 · Haut", "2 · Bas"],
    "tractions": ["1 · Bras tendus", "2 · Menton haut"],
    "front-lever-groupe": ["1 · Suspension", "2 · Position groupée"],
    "pompes-lestees": ["1 · Haut", "2 · Bas"],
    "dips": ["1 · Haut", "2 · Bas"],
}
F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
def rogner(im):
    bg = Image.new("RGB", im.size, (255, 255, 255))
    b = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 12 else 0).getbbox()
    m = 24
    return im.crop((max(b[0] - m, 0), max(b[1] - m, 0), min(b[2] + m, im.size[0]), min(b[3] + m, im.size[1])))
ids = sorted({f.rsplit("-", 1)[0] for f in os.listdir(SRC) if f.endswith(".png")})
for e in ids:
    ims = [rogner(Image.open(os.path.join(SRC, f"{e}-{i}.png")).convert("RGB")) for i in (1, 2) if os.path.exists(os.path.join(SRC, f"{e}-{i}.png"))]
    leg = LEG.get(e, ["1 · Départ", "2 · Arrivée"])[:len(ims)]
    def elargir(im, t):  # chaque vignette est au moins aussi large que sa légende
        tw = int(F.getlength(t)) + 30
        if im.size[0] >= tw: return im
        n = Image.new("RGB", (tw, im.size[1]), "white"); n.paste(im, ((tw - im.size[0]) // 2, 0)); return n
    ims = [elargir(im, t) for im, t in zip(ims, leg)]
    cap = 56
    W = sum(i.size[0] for i in ims) + 30 * (len(ims) - 1); H = max(i.size[1] for i in ims)
    vertical = len(ims) > 1 and W > 1.7 * H
    if vertical:
        W = max(i.size[0] for i in ims); H2 = sum(i.size[1] + cap for i in ims) + 20 * (len(ims) - 1)
        o = Image.new("RGB", (W, H2), "white"); d = ImageDraw.Draw(o); y = 0
        for im, t in zip(ims, leg):
            d.text((W // 2, y + cap // 2), t, fill=(60, 50, 45), font=F, anchor="mm")
            o.paste(im, ((W - im.size[0]) // 2, y + cap)); y += im.size[1] + cap + 20
    else:
        o = Image.new("RGB", (W, H + cap), "white"); d = ImageDraw.Draw(o); x = 0
        for im, t in zip(ims, leg):
            d.text((x + im.size[0] // 2, cap // 2), t, fill=(60, 50, 45), font=F, anchor="mm")
            o.paste(im, (x, cap + H - im.size[1])); x += im.size[0] + 30
    mx = 1100
    if max(o.size) > mx:
        k = mx / max(o.size); o = o.resize((int(o.size[0] * k), int(o.size[1] * k)), Image.LANCZOS)
    o.save(os.path.join(OUT, f"{e}.webp"), "WEBP", quality=80, method=6)
    print(e, o.size, os.path.getsize(os.path.join(OUT, f"{e}.webp")) // 1024, "Ko")
