# Soulevé de terre roumain : départ et position basse, mains fermées sur la barre, en deux styles.
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
ROUGE, ORANGE, MUSCLE, OS_, ACIER, DISQUE = (0.80, 0.12, 0.13), (0.96, 0.56, 0.42), (0.93, 0.80, 0.70), (0.95, 0.92, 0.84), (0.25, 0.25, 0.27), (0.55, 0.56, 0.6)
PRIM = ["biceps femoris", "semitendinosus", "semimembranosus", "gluteus maximus"]
SEC = ["erector", "iliocostalis", "longissimus", "spinalis", "trapezius", "flexor digitorum"]

def categorie(o, os_set):
    n = o.name.lower()
    if o.name.startswith("Acc_"): return "acier" if ("barre" in n or "butee" in n) else "disque"
    if o in os_set: return "os"
    if any(k in n for k in PRIM): return "rouge"
    if any(k in n for k in SEC): return "orange"
    return "muscle"
COUL = {"rouge": ROUGE, "orange": ORANGE, "muscle": MUSCLE, "os": OS_, "acier": ACIER, "disque": DISQUE}

def accessoires_barre(c):
    for n in [o.name for o in bpy.data.objects if o.name.startswith("Acc_")]:
        bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
    def cyl(nom, r, L, x):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=L, location=(x, c.y, c.z), rotation=(0, math.radians(90), 0))
        o = bpy.context.active_object; o.name = "Acc_" + nom; return o
    cyl("barre", 0.014, 1.9, 0)
    cyl("disque", 0.2, 0.05, -0.62); cyl("butee", 0.03, 0.04, -0.575)

def materiaux_dessin():
    mats = {}
    for cat, col in COUL.items():
        m = bpy.data.materials.get("Dessin_" + cat) or bpy.data.materials.new("Dessin_" + cat)
        m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial"); dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
        s2r = nt.nodes.new("ShaderNodeShaderToRGB"); ramp = nt.nodes.new("ShaderNodeValToRGB"); em = nt.nodes.new("ShaderNodeEmission")
        dif.inputs["Color"].default_value = (1, 1, 1, 1)
        r = ramp.color_ramp; r.interpolation = 'CONSTANT'
        clair = tuple(min(1, c * 1.0) for c in col); moyen = tuple(c * 0.82 for c in col); ombre = tuple(c * 0.62 for c in col)
        r.elements[0].position = 0.0; r.elements[0].color = (*ombre, 1)
        r.elements[1].position = 0.62; r.elements[1].color = (*clair, 1)
        e = r.elements.new(0.3); e.color = (*moyen, 1)
        nt.links.new(dif.outputs[0], s2r.inputs[0]); nt.links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], em.inputs["Color"]); nt.links.new(em.outputs[0], out.inputs["Surface"])
        mats[cat] = m
    return mats

try:
    for o in bpy.data.objects:  # étiquettes et icônes de groupes de l'atlas : pas de l'anatomie
        if o.type == 'MESH' and o.name.rsplit(".", 1)[-1] in ("g", "j", "t", "i", "s"):
            o.hide_render = True
    arm = R["construire"]()
    sc = bpy.context.scene
    musc, os_l = R["collections_objets"]()
    os_set = set(os_l)
    for o in bpy.data.objects:
        if o.type == 'MESH' and ("latissimus" in o.name.lower() or "thoracolumbar" in o.name.lower()):
            o.hide_render = True
    ecrire()

    def poser(angles, prise):
        R["poser"](arm, angles)
        if prise: R["fermer_mains"](arm)
        bpy.context.view_layer.update()
        c = (R["centre_prise"](arm, "l") + R["centre_prise"](arm, "r")) / 2
        accessoires_barre(c); p("barre", tuple(round(x, 3) for x in c))

    def cadrer(nom, cadre, style):
        y0, y1, z0, z1 = cadre; w, h = y1 - y0, z1 - z0
        sc.render.resolution_x, sc.render.resolution_y = int(1500 * w / max(w, h)), int(1500 * h / max(w, h))
        cam = sc.camera; cam.data.ortho_scale = max(w, h)
        cam.location = (2.0, (y0 + y1) / 2, (z0 + z1) / 2); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
        sc.render.filepath = str(BASE / f"{nom}-{style}.png")
        t = time.time(); bpy.ops.render.render(write_still=True); p("rendu", nom, style, round(time.time() - t, 1), "s")

    def style_realiste():
        sc.render.engine = 'BLENDER_WORKBENCH'; sc.render.use_freestyle = False
        sh = sc.display.shading
        sh.light = 'STUDIO'; sh.color_type = 'OBJECT'; sh.show_cavity = True; sh.cavity_type = 'BOTH'
        sh.curvature_ridge_factor = 1.0; sh.curvature_valley_factor = 1.0
        sh.show_object_outline = True; sh.object_outline_color = (0.18, 0.1, 0.07); sh.show_shadows = False
        sc.world.color = (1, 1, 1)
        for o in bpy.data.objects:
            if o.type == 'MESH': o.color = (*COUL[categorie(o, os_set)], 1)

    MATS = {}
    def style_dessin():
        for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
            try: sc.render.engine = eng; break
            except Exception: pass
        if not MATS: MATS.update(materiaux_dessin())
        for o in bpy.data.objects:
            if o.type == 'MESH' and not o.hide_render:
                m = MATS[categorie(o, os_set)]
                o.data.materials.clear(); o.data.materials.append(m)
        if not bpy.data.objects.get("Soleil_dessin"):
            l = bpy.data.objects.new("Soleil_dessin", bpy.data.lights.new("Soleil_dessin", 'SUN'))
            sc.collection.objects.link(l)
            l.rotation_euler = Vector((-0.55, 0.35, -0.75)).to_track_quat('-Z', 'Y').to_euler(); l.data.energy = 2.2
        w = sc.world; w.use_nodes = True
        bg = w.node_tree.nodes.get("Background")
        if bg: bg.inputs["Color"].default_value = (1, 1, 1, 1); bg.inputs["Strength"].default_value = 1
        sc.render.film_transparent = False
        sc.render.use_freestyle = True; sc.render.line_thickness_mode = 'ABSOLUTE'; sc.render.line_thickness = 1.3
        fs = sc.view_layers[0].freestyle_settings
        ls = fs.linesets[0] if fs.linesets else fs.linesets.new("Contours")
        ls.select_by_visibility = True; ls.select_by_edge_types = True
        ls.select_silhouette = True; ls.select_border = True; ls.select_crease = False; ls.select_contour = True
        ls.linestyle.color = (0.22, 0.13, 0.1); ls.linestyle.thickness = 1.3

    cadre = (-0.75, 0.55, -0.03, 1.78)
    poses = [("rdl-0-debout", {"bras": (-7, 0), "avant_bras": (-7, 90), "main": (-7, 175)}),
             ("rdl-1-bas", {"bassin": 70, "cuisse": -40, "jambe": 3, "pied": 0, "bras": (13, 0), "avant_bras": (13, 90), "main": (13, 175)})]
    for style, appliquer in (("realiste", style_realiste), ("dessin", style_dessin)):
        for nom, ang in poses:
            poser(ang, True)
            appliquer()
            cadrer(nom, cadre, style)
            ecrire()
    p("OK")
except Exception:
    p(traceback.format_exc())
ecrire()
print("FINI")
