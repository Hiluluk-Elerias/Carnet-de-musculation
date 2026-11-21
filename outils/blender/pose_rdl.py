# Pose du soulevé de terre roumain (position basse) et rendus de profil.
import bpy, math, time, traceback, urllib.request
from pathlib import Path
from mathutils import Vector

def charger(n):
    src = urllib.request.urlopen(urllib.request.Request(
        "https://api.github.com/repos/Hiluluk-Elerias/Carnet-de-musculation/contents/outils/blender/" + n,
        headers={"Accept": "application/vnd.github.raw"})).read()
    g = {"__name__": "module"}; exec(src, g); return g

R = charger("rig.py")
p, ecrire, BASE = R["p"], R["ecrire"], R["BASE"]
try:
    arm = bpy.data.objects.get("Squelette")
    if arm is None or not arm.get("poids_ok"):
        arm = R["construire"](); arm["poids_ok"] = 1
    ecrire()
    sc = bpy.context.scene
    def rendu(nom):
        dg = bpy.context.evaluated_depsgraph_get()
        pts = []
        for o in bpy.data.objects:
            if o.type == 'MESH' and not o.hide_render:
                e = o.evaluated_get(dg)
                pts += [e.matrix_world @ Vector(c) for c in e.bound_box]
        def pct(i, q):
            v = sorted(pt[i] for pt in pts); return v[int(q * (len(v) - 1))]
        y0, y1, z0, z1 = pct(1, 0.005), pct(1, 0.995), min(pt[2] for pt in pts), pct(2, 0.999)
        cam = sc.camera
        w, h = y1 - y0, z1 - z0
        sc.render.resolution_x = int(900 * max(w / h, 0.45)) if w < h else 900
        sc.render.resolution_y = 900 if w < h else int(900 * h / w)
        cam.data.ortho_scale = max(w, h) * 1.1
        cam.location = (2.0, (y0 + y1) / 2, (z0 + z1) / 2); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
        sc.render.filepath = str(BASE / f"{nom}.png")
        t = time.time(); bpy.ops.render.render(write_still=True); p("rendu", nom, round(time.time() - t, 1), "s")
    R["poser"](arm, {})
    rendu("rdl-0-debout")
    # position basse : buste penché, hanches en arrière, genoux légèrement fléchis, bras verticaux
    R["poser"](arm, {"bassin": 62, "cuisse": -22, "jambe": 6, "pied": 0, "clavicule": 0, "bras": 4, "avant_bras": 4, "main": 4,
                     "cou": 0, "tete": 0})
    rendu("rdl-1-bas")
    p("OK")
except Exception:
    p(traceback.format_exc())
ecrire()
print("FINI")
