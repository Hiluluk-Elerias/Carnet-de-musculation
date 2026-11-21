# Étape 1 : télécharge l'atlas Z-Anatomy (CC BY-SA 4.0) et fait l'inventaire de son contenu.
# À lancer depuis la console Python de Blender.
import os, zipfile, urllib.request, time, traceback
from pathlib import Path

BASE = Path.home() / "Documents" / "planches-blender"
ZA = BASE / "z-anatomy"
ZA.mkdir(parents=True, exist_ok=True)
log = []
def p(*a):
    s = " ".join(str(x) for x in a); log.append(s); print(s)

try:
    z = ZA / "Z-Anatomy.zip"
    if not z.exists() or z.stat().st_size < 1_000_000:
        url = "https://github.com/Z-Anatomy/Models-of-human-anatomy/raw/master/Z-Anatomy.zip"
        t = time.time()
        urllib.request.urlretrieve(url, z)
        p("téléchargé", z.stat().st_size, "octets en", round(time.time() - t), "s")
    p("zip", z.stat().st_size)
    with zipfile.ZipFile(z) as f:
        for i in f.infolist():
            p("  ", i.filename, i.file_size)
        f.extractall(ZA / "extrait")
    blends = sorted((ZA / "extrait").rglob("*.blend"))
    for b in blends:
        p("blend", b, b.stat().st_size)
    import bpy
    if blends:
        with bpy.data.libraries.load(str(blends[0])) as (src, dst):
            p("objets", len(src.objects), "collections", len(src.collections), "armatures", len(src.armatures))
            p("collections :", " | ".join(src.collections[:400]))
            p("objets (extrait) :", " | ".join(src.objects[:1500]))
except Exception:
    p(traceback.format_exc())

(BASE / "rapport-setup.txt").write_text("\n".join(log), encoding="utf-8")
print("RAPPORT ÉCRIT")
