# Étape 2 : inventaire de l'atlas ouvert + rendu de test (vue de profil, muscles visés en rouge).
import bpy, math, traceback
from pathlib import Path
from mathutils import Vector

BASE = Path.home() / "Documents" / "planches-blender"
log = []
def p(*a):
    s = " ".join(str(x) for x in a); log.append(s); print(s)

def all_objs(col):
    out = set(col.objects)
    for c in col.children:
        out |= all_objs(c)
    return out

try:
    sc = bpy.context.scene
    def tree(col, d=0):
        if d > 2: return
        n = len(all_objs(col))
        p("  " * d + f"- {col.name} ({n})")
        for c in col.children:
            tree(c, d + 1)
    tree(sc.collection)
    types = {}
    for o in bpy.data.objects:
        types[o.type] = types.get(o.type, 0) + 1
    p("types", types)

    cols = {c.name: c for c in bpy.data.collections}
    def find_col(word):
        for n, c in cols.items():
            if word.lower() in n.lower():
                return c
    musc = find_col("Muscular system"); sk = find_col("Skeletal system")
    p("muscular", musc and musc.name, "skeletal", sk and sk.name)
    mus_objs = [o for o in all_objs(musc) if o.type == 'MESH'] if musc else []
    sk_objs = [o for o in all_objs(sk) if o.type == 'MESH'] if sk else []
    p("mesh muscles", len(mus_objs), "mesh os", len(sk_objs))
    keys = ["biceps femoris", "semitendinosus", "semimembranosus", "gluteus maximus", "erector", "iliocostalis",
            "longissimus", "spinalis", "trapezius", "flexor digitorum", "latissimus", "rectus femoris"]
    for k in keys:
        p(k, "->", [o.name for o in mus_objs if k in o.name.lower()][:12])
    suf = {}
    for o in mus_objs:
        s = o.name.rsplit(".", 1)[-1] if "." in o.name else "-"
        suf[s] = suf.get(s, 0) + 1
    p("suffixes muscles", suf)
    p("échantillon muscles", [o.name for o in mus_objs][:80])

    # --- rendu de test ---
    keep = set(mus_objs) | set(sk_objs)
    for o in bpy.data.objects:
        o.hide_render = o not in keep
    prim = ["biceps femoris", "semitendinosus", "semimembranosus", "gluteus maximus"]
    sec = ["erector", "iliocostalis", "longissimus", "spinalis", "trapezius", "flexor digitorum"]
    for o in mus_objs:
        n = o.name.lower()
        o.color = (0.80, 0.12, 0.13, 1) if any(k in n for k in prim) else (0.95, 0.55, 0.42, 1) if any(k in n for k in sec) else (0.86, 0.72, 0.62, 1)
    for o in sk_objs:
        o.color = (0.93, 0.90, 0.82, 1)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'OBJECT'; sh.show_cavity = True; sh.show_object_outline = True
    sh.object_outline_color = (0.15, 0.1, 0.08); sh.show_shadows = False
    sc.render.film_transparent = False
    if sc.world is None: sc.world = bpy.data.worlds.new("W")
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1000, 1600, 100
    mins = Vector((1e9,) * 3); maxs = Vector((-1e9,) * 3)
    for o in keep:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
    p("bbox", tuple(round(x, 3) for x in mins), tuple(round(x, 3) for x in maxs))
    ctr = (mins + maxs) / 2; h = max(maxs - mins)
    cam_d = bpy.data.cameras.new("CamPlanche"); cam_d.type = 'ORTHO'; cam_d.ortho_scale = h * 1.08
    cam = bpy.data.objects.new("CamPlanche", cam_d); sc.collection.objects.link(cam)
    cam.location = (ctr.x + h * 3, ctr.y, ctr.z); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    cam_d.clip_end = h * 10
    sc.camera = cam
    sc.render.filepath = str(BASE / "test-01-profil.png")
    bpy.ops.render.render(write_still=True)
    cam.location = (ctr.x, ctr.y - h * 3, ctr.z); cam.rotation_euler = (math.radians(90), 0, 0)
    sc.render.filepath = str(BASE / "test-02-face.png")
    bpy.ops.render.render(write_still=True)
    p("rendus OK")
except Exception:
    p(traceback.format_exc())
(BASE / "rapport-inspect.txt").write_text("\n".join(log), encoding="utf-8")
print("RAPPORT ÉCRIT")
