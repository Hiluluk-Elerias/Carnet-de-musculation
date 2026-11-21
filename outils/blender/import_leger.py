# Étape 2 bis : scène vide + import des seuls os et muscles de Z-Anatomy, puis rendu de test rapide.
# À lancer dans un Blender fraîchement ouvert (fichier par défaut), depuis la console Python.
import bpy, math, time, traceback
from pathlib import Path
from mathutils import Vector

BASE = Path.home() / "Documents" / "planches-blender"
BLEND = BASE / "z-anatomy" / "extrait" / "Z-Anatomy" / "Startup.blend"
log = []
def p(*a):
    s = " ".join(str(x) for x in a); log.append(s); print(s)
def ecrire():
    (BASE / "rapport-import.txt").write_text("\n".join(log), encoding="utf-8")

try:
    t0 = time.time()
    # scène propre
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    bpy.data.orphans_purge(do_recursive=True)
    sc = bpy.context.scene
    sc.render.use_freestyle = False
    with bpy.data.libraries.load(str(BLEND), link=False) as (src, dst):
        cols = [c for c in src.collections if c in ("1: Skeletal system", "4: Muscular system")]
        p("collections importées :", cols)
        dst.collections = cols
    for c in dst.collections:
        if c is not None:
            sc.collection.children.link(c)
    p("import", round(time.time() - t0), "s")

    def all_objs(col):
        out = set(col.objects)
        for c in col.children:
            out |= all_objs(c)
        return out
    meshes = {}
    for c in dst.collections:
        if c is None: continue
        ms = [o for o in all_objs(c) if o.type == 'MESH']
        meshes[c.name] = ms
        p(c.name, "meshes", len(ms), "autres", len(all_objs(c)) - len(ms))
    # on n'affiche que les maillages, pas les étiquettes ni les repères
    keep = set(o for ms in meshes.values() for o in ms)
    for o in bpy.data.objects:
        o.hide_render = o not in keep
    musc = [o for n, ms in meshes.items() if "Muscular" in n for o in ms]
    p("échantillon muscles :", sorted(o.name for o in musc)[:200])
    ecrire()

    prim = ["biceps femoris", "semitendinosus", "semimembranosus", "gluteus maximus"]
    sec = ["erector", "iliocostalis", "longissimus", "spinalis", "trapezius", "flexor digitorum"]
    for o in musc:
        n = o.name.lower()
        o.color = (0.80, 0.12, 0.13, 1) if any(k in n for k in prim) else (0.96, 0.56, 0.42, 1) if any(k in n for k in sec) else (0.86, 0.72, 0.62, 1)
    for o in keep - set(musc):
        o.color = (0.93, 0.90, 0.82, 1)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'OBJECT'; sh.show_cavity = True
    sh.show_object_outline = True; sh.object_outline_color = (0.15, 0.1, 0.08); sh.show_shadows = False
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 600, 960, 100
    mins = Vector((1e9,) * 3); maxs = Vector((-1e9,) * 3)
    for o in keep:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
    p("bbox", tuple(round(x, 3) for x in mins), tuple(round(x, 3) for x in maxs))
    ctr = (mins + maxs) / 2; h = max(maxs - mins)
    cam_d = bpy.data.cameras.new("CamPlanche"); cam_d.type = 'ORTHO'; cam_d.ortho_scale = h * 1.08; cam_d.clip_end = h * 10
    cam = bpy.data.objects.new("CamPlanche", cam_d); sc.collection.objects.link(cam); sc.camera = cam
    for nom, loc, rot in [("profil", (ctr.x + h * 3, ctr.y, ctr.z), (90, 0, 90)), ("face", (ctr.x, ctr.y - h * 3, ctr.z), (90, 0, 0)),
                          ("dos", (ctr.x, ctr.y + h * 3, ctr.z), (90, 0, 180))]:
        cam.location = loc; cam.rotation_euler = tuple(math.radians(a) for a in rot)
        t = time.time()
        sc.render.filepath = str(BASE / f"test-{nom}.png")
        bpy.ops.render.render(write_still=True)
        p("rendu", nom, round(time.time() - t, 1), "s")
        ecrire()
    p("total", round(time.time() - t0), "s")
except Exception:
    p(traceback.format_exc())
ecrire()
print("RAPPORT ÉCRIT")
