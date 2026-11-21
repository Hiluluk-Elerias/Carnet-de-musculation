# Liste les objets visibles dont la géométrie évaluée sort du corps (morceaux « errants » après la pose).
import bpy, numpy as np
from pathlib import Path
BASE = Path.home() / "Documents" / "planches-blender"
import urllib.request
src = urllib.request.urlopen(urllib.request.Request("https://api.github.com/repos/Hiluluk-Elerias/Carnet-de-musculation/contents/outils/blender/rig.py",
      headers={"Accept": "application/vnd.github.raw"})).read()
R = {"__name__": "module"}; exec(src, R)
arm = bpy.data.objects["Squelette"]
R["poser"](arm, {"bras": (-7, 0), "avant_bras": (-7, 90), "main": (-7, 175)})
bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'; bpy.context.scene.render.use_freestyle = False
dg = bpy.context.evaluated_depsgraph_get()
lignes = []
for o in bpy.data.objects:
    if o.type != 'MESH' or o.hide_render or o.name.startswith("Acc_"):
        continue
    e = o.evaluated_get(dg); m = e.to_mesh()
    n = len(m.vertices)
    if n:
        co = np.empty(n * 3); m.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        mw = np.array(e.matrix_world); w = co @ mw[:3, :3].T + mw[:3, 3]
        # sommets nettement devant le plan du corps, au-dessus des mains
        sel = (w[:, 1] < -0.16) & (w[:, 2] > 0.55)
        if sel.sum() > 20:
            vg = [g.name for g in o.vertex_groups]
            lignes.append(f"{o.name}\t{int(sel.sum())}/{n}\tymin={w[:,1].min():.3f}\tgroupes={vg[:12]}")
    e.to_mesh_clear()
(BASE / "rapport-errants.txt").write_text("\n".join(lignes) or "aucun", encoding="utf-8")
print("ERRANTS", len(lignes))
