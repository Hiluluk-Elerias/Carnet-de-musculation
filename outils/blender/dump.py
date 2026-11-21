# Export des noms + boîtes englobantes (monde) des os et muscles visibles, pour concevoir le squelette articulé.
import bpy, json
from pathlib import Path
from mathutils import Vector
BASE = Path.home() / "Documents" / "planches-blender"
bpy.context.view_layer.update()
out = {}
for c in bpy.data.collections:
    if c.name not in ("1: Skeletal system", "4: Muscular system"):
        continue
    def walk(col, acc):
        for o in col.objects:
            acc.add(o)
        for ch in col.children:
            walk(ch, acc)
        return acc
    for o in walk(c, set()):
        if o.type != 'MESH' or o.hide_render:
            continue
        pts = [o.matrix_world @ Vector(v) for v in o.bound_box]
        mn = [round(min(p[i] for p in pts), 4) for i in range(3)]
        mx = [round(max(p[i] for p in pts), 4) for i in range(3)]
        out[o.name] = {"c": c.name[0], "min": mn, "max": mx, "nv": len(o.data.vertices),
                       "parent": o.parent.name if o.parent else None,
                       "mods": [m.type for m in o.modifiers], "shared": o.data.users}
(BASE / "dump.json").write_text(json.dumps(out), encoding="utf-8")
print("DUMP", len(out))
