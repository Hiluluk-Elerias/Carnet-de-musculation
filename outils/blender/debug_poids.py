# Muscles dont les poids mélangent le bras et le tronc / la jambe (source des « voiles » étirés).
import bpy
from pathlib import Path
BASE = Path.home() / "Documents" / "planches-blender"
BRAS = ("bras", "avant_bras", "avant_bras2", "main", "doigt")
AUTRE = ("bassin", "lombaires", "cuisse", "jambe", "pied")
lignes = []
for o in bpy.data.objects:
    if o.type != 'MESH' or o.hide_render or not o.vertex_groups: continue
    g = [v.name for v in o.vertex_groups]
    b = [x for x in g if x.split(".")[0].rstrip("0123456789_") in BRAS or x.startswith("doigt")]
    a = [x for x in g if x.split(".")[0] in AUTRE]
    if b and a:
        lignes.append(f"{o.name}\tbras={b[:6]}\tautres={a[:6]}\tnv={len(o.data.vertices)}")
(BASE / "rapport-poids.txt").write_text("\n".join(lignes) or "aucun", encoding="utf-8")
print("POIDS", len(lignes))
