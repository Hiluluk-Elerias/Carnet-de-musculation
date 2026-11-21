# Planches d'exercices (style réaliste) : chaque exercice = 1 ou 2 positions, muscles colorés, accessoires.
# Usage dans la console de Blender, après import_leger.py :  EXOS_A_FAIRE = ["rdl"]; R('planches.py')
import bpy, math, time, traceback, urllib.request
from pathlib import Path
from mathutils import Vector, Matrix

def charger(n):
    src = urllib.request.urlopen(urllib.request.Request(
        "https://api.github.com/repos/Hiluluk-Elerias/Carnet-de-musculation/contents/outils/blender/" + n,
        headers={"Accept": "application/vnd.github.raw"})).read()
    g = {"__name__": "module"}; exec(src, g); return g

R = charger("rig.py")
p, BASE = R["p"], R["BASE"]
SORTIE = BASE / "planches"; SORTIE.mkdir(exist_ok=True)
def ecrire(): R["ecrire"]("rapport-planches.txt")

ROUGE, ORANGE, MUSCLE, OS_ = (0.80, 0.12, 0.13), (0.96, 0.56, 0.42), (0.93, 0.80, 0.70), (0.95, 0.92, 0.84)
ACIER, GRIS, BOIS, ELAST = (0.25, 0.25, 0.27), (0.55, 0.56, 0.6), (0.72, 0.55, 0.36), (0.25, 0.62, 0.35)

# ---------------------------------------------------------------- accessoires
def _nouvel(o, nom, col):
    o.name = "Acc_" + nom; o.color = (*col, 1); o.hide_render = False; return o

def cylindre(nom, a, b, r, col, n=32):
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=d.length, location=(a + b) / 2)
    o = bpy.context.active_object
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return _nouvel(o, nom, col)

def boite(nom, c, taille, col):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    o = bpy.context.active_object; o.scale = taille
    return _nouvel(o, nom, col)

def prise(arm, sd):
    return R["centre_prise"](arm, sd)

def barre(arm, L=1.9, disques=True, ez=False):
    g = [prise(arm, "l"), prise(arm, "r")]; c = (g[0] + g[1]) / 2
    cylindre("barre", c + Vector((L / 2, 0, 0)), c - Vector((L / 2, 0, 0)), 0.014, ACIER)
    if disques:
        cylindre("disque", c + Vector((-0.595, 0, 0)), c + Vector((-0.645, 0, 0)), 0.2, GRIS, 48)
    if ez:
        cylindre("disque", c + Vector((-0.45, 0, 0)), c + Vector((-0.48, 0, 0)), 0.11, GRIS, 48)
    return c

def halteres(arm, axe=(0, 1, 0)):
    for sd, sg in (("l", 1), ("r", -1)):
        c = prise(arm, sd); ax = Vector(axe); ax.x *= sg; ax.normalize()
        cylindre("poignee" + sd, c - ax * 0.07, c + ax * 0.07, 0.016, ACIER)
        for s_ in (1, -1):
            cylindre("tete" + sd + str(s_), c + ax * s_ * 0.075, c + ax * s_ * 0.115, 0.055, GRIS)

def barre_fixe(arm, L=1.3):
    g = [prise(arm, "l"), prise(arm, "r")]; c = (g[0] + g[1]) / 2
    cylindre("barre_fixe", c + Vector((L / 2, 0, 0)), c - Vector((L / 2, 0, 0)), 0.018, ACIER)
    return c

def cable(arm, sd, vers, col=ACIER, poulie=True):
    c = prise(arm, sd)
    cylindre("cable" + sd, c, vers, 0.004 if col == ACIER else 0.008, col)
    if poulie:
        boite("poulie" + sd, vers, (0.06, 0.06, 0.06), GRIS)

def disque_dos(arm):
    b = arm.pose.bones["thorax"]; v = (b.tail - b.head).normalized()
    n = Vector((0, -v.z, v.y)); n = n if n.z > 0 else -n
    c = (b.head + b.tail) / 2 + n * 0.115
    return cylindre("disque_dos", c, c + n * 0.03, 0.17, GRIS, 48)

def caisse(arm):
    m = R["point_os"](arm, "pied.r", "mid"); haut = max(m.z - 0.035, 0.1)
    return boite("caisse", (0, m.y + 0.06, haut / 2), (0.5, 0.36, haut), BOIS)

# ---------------------------------------------------------------- couleurs
def colorer(musc, os_, prim, sec, cacher=()):
    for o in os_:
        o.color = (*OS_, 1)
    for o in musc:
        n = o.name.lower()
        if any(k in n for k in cacher):
            o.hide_render = True; continue
        o.hide_render = False
        o.color = (*(ROUGE if any(k in n for k in prim) else ORANGE if any(k in n for k in sec) else MUSCLE), 1)

def egaliser(arm, angles, cle, bornes, A, B):
    """Cherche l'angle (rotation x de l'os « cle ») qui met les points A et B à la même hauteur (ex. mains et pieds au sol)."""
    lo, hi = bornes
    def f(x):
        a = dict(angles); a[cle] = x; R["poser"](arm, a, ancre=None)
        return R["point_os"](arm, *A).z - R["point_os"](arm, *B).z
    flo = f(lo)
    for _ in range(18):
        mid = (lo + hi) / 2; fm = f(mid)
        if (fm > 0) == (flo > 0): lo, flo = mid, fm
        else: hi = mid
    return (lo + hi) / 2

def au_sol(arm, marge=0.0):
    """Translate le corps pour que le point le plus bas touche z = 0."""
    dg = bpy.context.evaluated_depsgraph_get(); zmin = 9
    for o in bpy.data.objects:
        if o.type == 'MESH' and not o.hide_render and not o.name.startswith("Acc_"):
            e = o.evaluated_get(dg)
            zmin = min(zmin, min((e.matrix_world @ Vector(c)).z for c in e.bound_box))
    pb = arm.pose.bones["base"]; pb.matrix = Matrix.Translation((0, 0, marge - zmin)) @ pb.matrix
    bpy.context.view_layer.update()

# ---------------------------------------------------------------- exercices
P = lambda **k: k
EXOS = {
 "rdl": dict(vue=90, prim=["biceps femoris", "semitendinosus", "semimembranosus", "gluteus maximus"],
             sec=["iliocostalis", "longissimus", "spinalis", "trapezius", "flexor digitorum superficialis", "flexor digitorum profundus"],
             cacher=["latissimus", "thoracolumbar"],
             poses=[P(a={"bras": (-7, 0), "avant_bras": (-7, 0), "main": (-7, 175)}),
                    P(a={"bassin": 70, "cuisse": -40, "jambe": 3, "pied": 0, "bras": (13, 0), "avant_bras": (13, 0), "main": (13, 175)})],
             acc=lambda arm, i: barre(arm)),
 "curl-inverse": dict(vue=90, prim=["brachioradialis", "brachialis muscle"], sec=["biceps brachii", "extensor carpi"],
             poses=[P(a={"bras": (-4, 0), "avant_bras": (-4, 0), "main": (-4, 175)}),
                    P(a={"bras": (-12, 0), "avant_bras": {"dir": (0, -0.35, 1)}, "main": {"dir": (0, -0.2, 1), "tw": 175}})],
             acc=lambda arm, i: barre(arm, L=1.2, disques=False, ez=True)),
 "dev-militaire": dict(vue=90, prim=["deltoid", "triceps"], sec=["trapezius", "serratus anterior"],
             poses=[P(a={"bras": {"dir": (0.35, -0.55, -0.45)}, "avant_bras": {"dir": (0, -0.1, 1)}, "main": {"dir": (0, -0.1, 1), "tw": 90}}),
                    P(a={"bras": {"dir": (0.1, -0.08, 1)}, "avant_bras": {"dir": (-0.05, -0.05, 1)}, "main": {"dir": (0, -0.05, 1), "tw": 90}})],
             acc=lambda arm, i: halteres(arm, (0, 1, 0))),
 "split-squat": dict(vue=90, prim=["vastus", "rectus femoris", "gluteus maximus"],
             sec=["biceps femoris", "semitendinosus", "semimembranosus", "gluteus medius", "adductor", "gastrocnemius"],
             poses=[P(a={"cuisse.l": -12, "jambe.l": 6, "cuisse.r": 22, "jambe.r": 82, "pied.r": 150, "bras": (0, 0), "main": (0, 90)},
                      ancre=("point", "jambe.l", "tail", (None, None, 0.075))),
                    P(a={"bassin": 12, "cuisse.l": -82, "jambe.l": 14, "cuisse.r": 8, "jambe.r": 95, "pied.r": 150, "bras": (0, 0), "main": (0, 90)},
                      ancre=("point", "jambe.l", "tail", (None, None, 0.075)))],
             acc=lambda arm, i: (halteres(arm, (0, 1, 0)),
                                 caisse(arm))),
 "tractions": dict(vue=90, prim=["latissimus", "biceps brachii"],
             sec=["brachialis muscle", "brachioradialis", "trapezius", "scapular spinal part of deltoid", "teres major"],
             poses=[P(a={"bras": (-178, 0), "avant_bras": (-178, 0), "main": (-178, 180), "cuisse": -8, "jambe": 25}, ancre=("point", "main.l", "mid", (None, 0, 2.25))),
                    P(a={"bras": {"dir": (0.25, -0.35, -0.9)}, "avant_bras": {"dir": (0.05, 0.25, 1)}, "main": {"dir": (0, 0.1, 1), "tw": 180},
                         "cuisse": -10, "jambe": 30}, ancre=("point", "main.l", "mid", (None, 0, 2.25)))],
             acc=lambda arm, i: barre_fixe(arm)),
 "releves-jambes": dict(vue=90, prim=["rectus abdominis", "psoas", "iliacus"], sec=["abdominal oblique", "rectus femoris", "flexor digitorum superficialis", "flexor digitorum profundus"],
             poses=[P(a={"bras": (-178, 0), "avant_bras": (-178, 0), "main": (-178, 180)}, ancre=("point", "main.l", "mid", (None, 0, 2.25))),
                    P(a={"bras": (-172, 0), "avant_bras": (-172, 0), "main": (-172, 180), "bassin": -14, "cuisse": -95, "jambe": -92, "pied": -60},
                      ancre=("point", "main.l", "mid", (None, 0, 2.25)))],
             acc=lambda arm, i: barre_fixe(arm)),
 "front-lever-groupe": dict(vue=90, prim=["latissimus", "rectus abdominis"], sec=["scapular spinal part of deltoid", "long head of triceps", "teres major", "psoas", "iliacus"],
             poses=[P(a={"bras": (-178, 0), "avant_bras": (-178, 0), "main": (-178, 180)}, ancre=("point", "main.l", "mid", (None, 0, 2.25))),
                    P(a={"bassin": -90, "bras": (-170, 0), "avant_bras": (-170, 0), "main": (-170, 180), "cuisse": 105, "jambe": -60, "pied": -20},
                      ancre=("point", "main.l", "mid", (None, 0, 2.25)))],
             acc=lambda arm, i: barre_fixe(arm)),
 "face-pull": dict(vue=150, prim=["scapular spinal part of deltoid", "transverse part of trapezius", "ascending part of trapezius"],
             sec=["infraspinatus", "teres minor", "rhomboid", "acromial part of deltoid"],
             poses=[P(a={"bras": {"dir": (0.12, -1, 0.12)}, "avant_bras": {"dir": (-0.05, -1, 0.1)}, "main": {"dir": (-0.05, -1, 0.1), "tw": 90}}),
                    P(a={"bras": {"dir": (1, 0.1, 0.12)}, "avant_bras": {"dir": (0.1, -0.15, 1)}, "main": {"dir": (0.1, -0.1, 1), "tw": 90}})],
             acc=lambda arm, i: [cable(arm, sd, Vector((0, -1.3, 1.58)), poulie=(sd == "l")) for sd in "lr"]),
 "rotation-externe": dict(vue=180, prim=["infraspinatus", "teres minor"], sec=["scapular spinal part of deltoid", "transverse part of trapezius"],
             poses=[P(a={"bras.l": (0, 0), "avant_bras.l": {"dir": (-0.75, -0.65, 0)}, "main.l": {"dir": (-0.75, -0.65, 0), "tw": 90}}),
                    P(a={"bras.l": (0, 0), "avant_bras.l": {"dir": (0.75, -0.65, 0)}, "main.l": {"dir": (0.75, -0.65, 0), "tw": 90}})],
             acc=lambda arm, i: cable(arm, "l", Vector((-0.75, -0.25, 1.0)), col=ELAST, poulie=False)),
 "dips": dict(vue=90, prim=["triceps", "sternocostal head of pectoralis major", "abdominal part of pectoralis major"], sec=["clavicular part of deltoid"],
             poses=[P(a={"bassin": 12, "bras": (3, 0), "avant_bras": (3, 0), "main": {"dir": (0, -1, -0.25), "tw": 90}, "cuisse": -25, "jambe": 75},
                      ancre=("point", "main.l", "head", (None, 0, 1.25))),
                    P(a={"bassin": 28, "bras": (88, 0), "avant_bras": (2, 0), "main": {"dir": (0, -1, -0.25), "tw": 90}, "cuisse": -30, "jambe": 75},
                      ancre=("point", "main.l", "head", (None, 0, 1.25)))],
             acc=lambda arm, i: [cylindre("barre_dips" + sd, prise(arm, sd) + Vector((0, -0.35, -0.03)), prise(arm, sd) + Vector((0, 0.35, -0.03)), 0.02, ACIER) for sd in "lr"]),
 "leg-curl-nordique": dict(vue=90, prim=["biceps femoris", "semitendinosus", "semimembranosus"], sec=["gastrocnemius", "gluteus maximus", "rectus abdominis"],
             poses=[P(a={"cuisse": 0, "jambe": 90, "pied": 160, "bras": {"dir": (0.1, -0.5, -0.5)}, "avant_bras": {"dir": (-0.2, -0.3, 1)}},
                      ancre=("point", "jambe.l", "head", (None, 0, 0.07))),
                    P(a={"bassin": 50, "cuisse": 50, "jambe": 90, "pied": 160, "bras": {"dir": (0.1, -1, -0.6)}, "avant_bras": {"dir": (0, -1, -0.2)}},
                      ancre=("point", "jambe.l", "head", (None, 0, 0.07)))],
             acc=lambda arm, i: cylindre("rouleau", R["point_os"](arm, "jambe.l", "tail") + Vector((0.25, 0.02, 0.07)),
                                         R["point_os"](arm, "jambe.r", "tail") + Vector((-0.25, 0.02, 0.07)), 0.035, ACIER)),
 "rowing-inverse": dict(vue=90, prim=["latissimus", "transverse part of trapezius", "rhomboid"], sec=["biceps brachii", "scapular spinal part of deltoid", "brachialis muscle"],
             poses=[P(a={"base": -62, "bras": (178, 0), "avant_bras": (178, 0), "main": (178, 180), "pied": -55}, ancre=("point", "jambe.l", "tail", (None, None, 0.09))),
                    P(a={"base": -62, "bras": {"dir": (0.15, -0.55, -0.6)}, "avant_bras": {"dir": (0, 0.2, 1)}, "main": {"dir": (0, 0.1, 1), "tw": 180}, "pied": -55},
                      ancre=("point", "jambe.l", "tail", (None, None, 0.09)))],
             acc=lambda arm, i: barre_fixe(arm, L=1.4)),
 "pompes-lestees": dict(vue=90, prim=["sternocostal head of pectoralis major", "clavicular head of pectoralis major", "abdominal part of pectoralis major", "triceps"],
             sec=["clavicular part of deltoid", "serratus anterior", "rectus abdominis"],
             poses=[P(egal=("base", (40, 89), ("main.l", "head"), ("pied.l", "tail")),
                      a={"bras": (0, 0), "avant_bras": (0, 0), "main": {"dir": (0, -1, -0.1), "tw": 180}, "pied": 140}, flex=(5, 5, 5)),
                    P(egal=("base", (55, 89), ("main.l", "head"), ("pied.l", "tail")),
                      a={"bras": (55, 0), "avant_bras": (-5, 0), "main": {"dir": (0, -1, -0.1), "tw": 180}, "pied": 140}, flex=(5, 5, 5))],
             acc=lambda arm, i: disque_dos(arm)),
 "gainage-planche": dict(vue=90, prim=["rectus abdominis", "transversus abdominis"], sec=["abdominal oblique", "gluteus maximus", "vastus", "rectus femoris", "clavicular part of deltoid"],
             poses=[P(egal=("base", (60, 89), ("avant_bras.l", "head"), ("pied.l", "tail")),
                      a={"bras": (0, 0), "avant_bras": {"dir": (0, -1, 0)}, "main": {"dir": (0, -1, 0), "tw": 90}, "pied": 140}, flex=(15, 20, 10))],
             acc=None),
 "y-sol": dict(vue=90, prim=["ascending part of trapezius", "transverse part of trapezius"], sec=["scapular spinal part of deltoid", "infraspinatus", "rhomboid"],
             poses=[P(a={"base": 90, "bras": {"dir": (0.5, -1, -0.12)}, "avant_bras": {"dir": (0.5, -1, -0.12)}, "main": {"dir": (0.5, -1, -0.12), "tw": 90}, "pied": 150}, flex=(5, 10, 5)),
                    P(a={"base": 90, "bras": {"dir": (0.5, -1, 0.16)}, "avant_bras": {"dir": (0.5, -1, 0.16)}, "main": {"dir": (0.5, -1, 0.16), "tw": 90}, "pied": 150}, flex=(5, 10, 5))],
             sol=True, acc=None),
 "pallof": dict(vue=40, prim=["external abdominal oblique", "internal abdominal oblique", "rectus abdominis", "transversus abdominis"],
             sec=["gluteus medius", "clavicular part of deltoid", "serratus anterior"],
             poses=[P(a={"bras": {"dir": (-0.2, 0.25, -1)}, "avant_bras": {"dir": (-0.75, -1, 0.15)}, "main": {"dir": (-0.75, -1, 0.15), "tw": 90}, "cuisse": {"dir": (0.12, 0, -1)}, "jambe": {"dir": (0.12, 0, -1)}}),
                    P(a={"bras": {"dir": (-0.2, -1, -0.05)}, "avant_bras": {"dir": (-0.2, -1, 0)}, "main": {"dir": (-0.2, -1, 0), "tw": 90}, "cuisse": {"dir": (0.12, 0, -1)}, "jambe": {"dir": (0.12, 0, -1)}})],
             acc=lambda arm, i: cable(arm, "r", Vector((-1.1, (prise(arm, "r").y), prise(arm, "r").z)))),
 "poutre-repeaters": dict(vue=90, prim=["flexor digitorum superficialis", "flexor digitorum profundus"], sec=["flexor carpi", "palmaris", "flexor pollicis", "latissimus"],
             poses=[P(a={"bras": (-174, 0), "avant_bras": (-178, 0), "main": (-178, 180), "cuisse": -15, "jambe": 40}, ancre=("point", "main.l", "mid", (None, 0, 2.25)), flex=(10, 95, 15)),
                    P(a={"bras": (-174, 0), "avant_bras": (-178, 0), "main": (-178, 180)}, flex=(10, 95, 15))],
             acc=lambda arm, i: boite("poutre", (prise(arm, "l") + prise(arm, "r")) / 2 + Vector((0, 0.02, 0.05)), (0.62, 0.09, 0.07), BOIS)),
}

def cadrer(nom, vue, ech=None):
    """Caméra orthographique horizontale ; vue = azimut (90 : profil gauche, 0 : face, 180 : dos)."""
    sc = bpy.context.scene; dg = bpy.context.evaluated_depsgraph_get()
    az = math.radians(vue); fwd = Vector((-math.sin(az), math.cos(az), 0)); right = Vector((math.cos(az), math.sin(az), 0))
    us, zs = [], []
    for o in bpy.data.objects:
        if o.type == 'MESH' and not o.hide_render:
            e = o.evaluated_get(dg)
            for c in e.bound_box:
                w = e.matrix_world @ Vector(c); us.append(w.dot(right)); zs.append(w.z)
    us.sort(); zs.sort()
    u0, u1, z0, z1 = us[0], us[-1], zs[0], zs[-1]
    w, h = (u1 - u0) * 1.08 + 0.06, (z1 - z0) * 1.06 + 0.06
    return (u0, u1, z0, z1, w, h, fwd, right)

def rendre(nom, cad, ech):
    sc = bpy.context.scene; u0, u1, z0, z1, w, h, fwd, right = cad
    W, H = max(w, 0.2), max(h, 0.2)
    PXM = 780  # pixels par mètre, identique pour toutes les planches
    sc.render.resolution_x, sc.render.resolution_y = int(PXM * W), int(PXM * H)
    cam = sc.camera; cam.data.ortho_scale = max(W, H)
    ctr = right * ((u0 + u1) / 2) + Vector((0, 0, (z0 + z1) / 2))
    cam.location = ctr - fwd * 3
    cam.rotation_mode = 'XYZ'; cam.rotation_euler = (math.radians(90), 0, math.atan2(-fwd.x, fwd.y))
    sc.render.filepath = str(SORTIE / f"{nom}.png")
    bpy.ops.render.render(write_still=True)

def faire(eid, arm, musc, os_):
    X = EXOS[eid]; t = time.time()
    for o in list(bpy.data.objects):
        if o.name.startswith("Acc_"): bpy.data.objects.remove(o, do_unlink=True)
    colorer(musc, os_, X["prim"], X["sec"], X.get("cacher", ()))
    cads = []
    for i, ps in enumerate(X["poses"]):
        a = dict(ps["a"])
        if "egal" in ps:
            cle, bornes, A, B = ps["egal"]
            a[cle] = egaliser(arm, a, cle, bornes, A, B)
        R["poser"](arm, a, ancre=ps.get("ancre", "pieds") if "egal" not in ps else None)
        R["fermer_mains"](arm, flex=ps.get("flex", (55, 90, 60)))
        if "egal" in ps or X.get("sol"): au_sol(arm)
        for o in list(bpy.data.objects):
            if o.name.startswith("Acc_"): bpy.data.objects.remove(o, do_unlink=True)
        if X.get("acc"): X["acc"](arm, i)
        # objets loin de tout os : on les signale et on les masque
        dg = bpy.context.evaluated_depsgraph_get()
        segs = [(b.head.copy(), b.tail.copy()) for b in arm.pose.bones if b.name != "base"]
        for o in bpy.data.objects:
            if o.type != 'MESH' or o.hide_render or o.name.startswith("Acc_"): continue
            e = o.evaluated_get(dg)
            c = sum((e.matrix_world @ Vector(v) for v in e.bound_box), Vector()) / 8
            d = min(((c - (h + (t - h) * max(0, min(1, (c - h).dot(t - h) / max((t - h).length_squared, 1e-9))))).length) for h, t in segs)
            if d > 0.25:
                p(eid, i + 1, "errant masqué :", o.name, round(d, 2)); o.hide_render = True
        cads.append((i, a, ps, cadrer(eid, X["vue"])))
        ech = max(max(c[3][4], c[3][5]) for c in cads)
        rendre(f"{eid}-{i + 1}", cads[-1][3], max(cads[-1][3][4], cads[-1][3][5]))
    p(eid, "ok", round(time.time() - t, 1), "s")

try:
    sc = bpy.context.scene
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name.rsplit(".", 1)[-1] in ("g", "j", "t", "i", "s"):
            o.hide_render = True
    arm = bpy.data.objects.get("Squelette")
    if arm is None or "v4" not in arm.keys():
        arm = R["construire"](); arm["v4"] = 1
    else:
        R["articulations_doigts"]()  # recrée la liste des os des doigts dans ce module
    musc, os_ = R["collections_objets"]()
    for o in bpy.data.objects:  # pièces sans squelette (elles resteraient en place) : masquées
        if o.type == 'MESH' and not o.hide_render and not o.name.startswith("Acc_") and not any(m.type == 'ARMATURE' for m in o.modifiers):
            o.hide_render = True; p("sans squelette, masqué :", o.name)
    musc = [o for o in musc if not o.hide_render]; os_ = [o for o in os_ if not o.hide_render]
    musc_all = [o for o in musc]
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.render.use_freestyle = False
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'OBJECT'; sh.show_cavity = True; sh.cavity_type = 'BOTH'
    sh.curvature_ridge_factor = 1.0; sh.curvature_valley_factor = 1.0
    sh.show_object_outline = True; sh.object_outline_color = (0.18, 0.1, 0.07); sh.show_shadows = False
    sc.world.color = (1, 1, 1); sc.view_settings.view_transform = 'Standard'
    liste = globals().get("EXOS_A_FAIRE") or list(EXOS)
    import builtins
    liste = getattr(builtins, "EXOS_A_FAIRE", None) or liste
    for eid in liste:
        try:
            faire(eid, arm, musc_all, os_)
        except Exception:
            p(eid, traceback.format_exc())
        ecrire()
except Exception:
    p(traceback.format_exc())
ecrire()
print("FINI")
