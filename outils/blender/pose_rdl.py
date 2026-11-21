# Soulevé de terre roumain : départ (debout) et position basse, avec la barre, vus de profil.
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

def accessoires_barre(arm):
    for n in [o.name for o in bpy.data.objects if o.name.startswith("Acc_")]:
        bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
    pb = arm.pose.bones
    g = [(pb[f"main.{s}"].head * 0.55 + pb[f"main.{s}"].tail * 0.45) for s in "lr"]
    c = (g[0] + g[1]) / 2
    def cyl(nom, r, L, x, col):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=L, location=(x, c.y, c.z), rotation=(0, math.radians(90), 0))
        o = bpy.context.active_object; o.name = "Acc_" + nom; o.color = col
        o.hide_render = False; return o
    cyl("barre", 0.014, 1.9, 0, (0.25, 0.25, 0.27, 1))
    # disque côté opposé à la caméra seulement : il passe derrière le corps sans le masquer
    cyl("disque", 0.2, 0.05, -0.62, (0.55, 0.56, 0.6, 1))
    cyl("butee", 0.03, 0.04, -0.575, (0.25, 0.25, 0.27, 1))
    return c

try:
    arm = R["construire"]()
    ecrire()
    sc = bpy.context.scene
    for o in bpy.data.objects:  # on dégage le grand dorsal pour montrer les érecteurs du rachis
        if o.type == 'MESH' and ("latissimus" in o.name.lower() or "thoracolumbar" in o.name.lower()):
            o.hide_render = True
    sh = sc.display.shading
    sh.cavity_type = 'BOTH'; sh.curvature_ridge_factor = 1.0; sh.curvature_valley_factor = 1.0
    for o in bpy.data.objects:
        if o.type == 'MESH' and tuple(round(x, 2) for x in o.color[:3]) == (0.86, 0.72, 0.62):
            o.color = (0.93, 0.80, 0.70, 1)

    def rendu(nom, cadre):
        y0, y1, z0, z1 = cadre
        cam = sc.camera
        w, h = y1 - y0, z1 - z0
        sc.render.resolution_x, sc.render.resolution_y = int(1000 * w / max(w, h)), int(1000 * h / max(w, h))
        cam.data.ortho_scale = max(w, h)
        cam.location = (2.0, (y0 + y1) / 2, (z0 + z1) / 2); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
        sc.render.filepath = str(BASE / f"{nom}.png")
        t = time.time(); bpy.ops.render.render(write_still=True); p("rendu", nom, round(time.time() - t, 1), "s")

    cadre = (-0.75, 0.55, -0.03, 1.78)
    R["poser"](arm, {"bras": 0, "avant_bras": 0, "main": 0}); bpy.context.view_layer.update()
    accessoires_barre(arm); rendu("rdl-0-debout", cadre)
    R["poser"](arm, {"bassin": 70, "cuisse": -40, "jambe": 3, "pied": 0, "bras": 13, "avant_bras": 13, "main": 13})
    bpy.context.view_layer.update()
    c = accessoires_barre(arm); p("barre", tuple(round(x, 3) for x in c)); rendu("rdl-1-bas", cadre)
    p("OK")
except Exception:
    p(traceback.format_exc())
ecrire()
print("FINI")
