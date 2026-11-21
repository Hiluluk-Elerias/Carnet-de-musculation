# Squelette articulé pour l'atlas Z-Anatomy importé par import_leger.py, et pose d'un exercice.
# Les os de l'atlas suivent rigidement un os du squelette ; les muscles se déforment (poids calculés
# selon la distance aux os du squelette, avec un fondu aux articulations).
import bpy, math, time, traceback
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix

BASE = Path.home() / "Documents" / "planches-blender"
log = []
def p(*a):
    s = " ".join(str(x) for x in a); log.append(s); print(s)
def ecrire(nom="rapport-rig.txt"):
    (BASE / nom).write_text("\n".join(log), encoding="utf-8")

# Articulations en position anatomique (mètres ; z vers le haut, le corps regarde vers -y, gauche = +x)
J = {
    "hanche": (0.0, 0.02, 0.865), "L3": (0.0, 0.03, 1.035), "T12": (0.0, 0.035, 1.135), "T6": (0.0, 0.055, 1.30),
    "T1": (0.0, 0.045, 1.44), "C1": (0.0, 0.025, 1.54), "vertex": (0.0, 0.0, 1.70),
}
def S(n, x, y, z):  # articulations paires
    J[n + ".l"] = (x, y, z); J[n + ".r"] = (-x, y, z)
S("cou_epaule", 0.02, 0.03, 1.41); S("epaule", 0.18, 0.03, 1.375); S("coude", 0.222, 0.02, 1.10)
S("mi_avant_bras", 0.2385, 0.015, 0.9825); S("poignet", 0.255, 0.01, 0.865); S("main", 0.27, 0.0, 0.69)
S("tete_femur", 0.085, 0.02, 0.865); S("genou", 0.082, 0.02, 0.45); S("cheville", 0.075, 0.035, 0.075)
S("orteils", 0.09, -0.13, 0.02)

BONES = [  # nom, tête, queue, parent, côté (0 centre, 1 gauche, -1 droite)
    ("base", "hanche", None, None, 0),
    ("bassin", "hanche", "L3", "base", 0),
    ("lombaires", "L3", "T12", "bassin", 0),
    ("dorsales", "T12", "T6", "lombaires", 0),
    ("thorax", "T6", "T1", "dorsales", 0),
    ("cou", "T1", "C1", "thorax", 0),
    ("tete", "C1", "vertex", "cou", 0),
]
for sd, sg in (("l", 1), ("r", -1)):
    BONES += [
        (f"clavicule.{sd}", f"cou_epaule.{sd}", f"epaule.{sd}", "thorax", sg),
        (f"bras.{sd}", f"epaule.{sd}", f"coude.{sd}", f"clavicule.{sd}", sg),
        (f"avant_bras.{sd}", f"coude.{sd}", f"mi_avant_bras.{sd}", f"bras.{sd}", sg),
        (f"avant_bras2.{sd}", f"mi_avant_bras.{sd}", f"poignet.{sd}", f"avant_bras.{sd}", sg),
        (f"main.{sd}", f"poignet.{sd}", f"main.{sd}", f"avant_bras2.{sd}", sg),
        (f"cuisse.{sd}", f"tete_femur.{sd}", f"genou.{sd}", "base", sg),
        (f"jambe.{sd}", f"genou.{sd}", f"cheville.{sd}", f"cuisse.{sd}", sg),
        (f"pied.{sd}", f"cheville.{sd}", f"orteils.{sd}", f"jambe.{sd}", sg),
    ]

DOIGTS = ["first", "second", "third", "fourth", "fifth"]
def articulations_doigts():
    """Ajoute à J et BONES les os des doigts, à partir des phalanges de l'atlas (pouce : métacarpien + 2 phalanges)."""
    def verts(nom):
        o = bpy.data.objects.get(nom)
        if o is None: return None
        n = len(o.data.vertices); co = np.empty(n * 3); o.data.vertices.foreach_get("co", co)
        mw = np.array(o.matrix_world); co = co.reshape(-1, 3)
        return co @ mw[:3, :3].T + mw[:3, 3]
    for sd, sg in (("l", 1), ("r", -1)):
        for k, f in enumerate(DOIGTS):
            seq = ([f"First metacarpal bone.{sd}"] if k == 0 else [f"{['First','Second','Third','Fourth','Fifth'][k]} metacarpal bone.{sd}"])
            seq += [f"Proximal phalanx of {f} finger of hand.{sd}"] + ([] if k == 0 else [f"Middle phalanx of {f} finger of hand.{sd}"])
            seq += [f"Distal phalanx of {f} finger of hand.{sd}"]
            V = [verts(n) for n in seq]
            if any(v is None for v in V):
                p("phalanges manquantes", f, sd); continue
            C = [v.mean(axis=0) for v in V]
            pts = []
            for i in range(len(V) - 1):
                a_ = V[i][np.argmin(np.linalg.norm(V[i] - C[i + 1], axis=1))]
                b_ = V[i + 1][np.argmin(np.linalg.norm(V[i + 1] - C[i], axis=1))]
                pts.append((a_ + b_) / 2)
            pts.append(V[-1][np.argmax(np.linalg.norm(V[-1] - C[-2], axis=1))])
            if k == 0:  # le pouce part de la base de son métacarpien
                base = V[0][np.argmax(np.linalg.norm(V[0] - C[1], axis=1))]
                pts = [base] + pts
            noms = []
            for i in range(len(pts) - 1):
                J[f"d{k}_{i}.{sd}"] = tuple(pts[i]); J[f"d{k}_{i + 1}.{sd}"] = tuple(pts[i + 1])
                nom = f"doigt{k}_{i}.{sd}"
                BONES.append((nom, f"d{k}_{i}.{sd}", f"d{k}_{i + 1}.{sd}", noms[-1] if noms else f"main.{sd}", sg))
                noms.append(nom)

def collections_objets():
    def walk(col, acc):
        acc |= set(col.objects)
        for ch in col.children:
            walk(ch, acc)
        return acc
    musc, os_ = set(), set()
    for c in bpy.data.collections:
        if c.name == "4: Muscular system": musc = walk(c, set())
        if c.name == "1: Skeletal system": os_ = walk(c, set())
    keep = lambda o: o.type == 'MESH' and not o.hide_render
    return [o for o in musc if keep(o)], [o for o in os_ if keep(o)]

def construire():
    t0 = time.time()
    if not any(n.startswith("doigt") for n, *_ in BONES):
        articulations_doigts()
    old = bpy.data.objects.get("Squelette")
    if old: bpy.data.objects.remove(old, do_unlink=True)
    arm_d = bpy.data.armatures.new("Squelette")
    arm = bpy.data.objects.new("Squelette", arm_d)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for nom, h, t, par, sg in BONES:
        b = arm_d.edit_bones.new(nom)
        b.head = J[h]
        b.tail = J[t] if t else (J[h][0], J[h][1], J[h][2] - 0.06)
        if par:
            b.parent = arm_d.edit_bones[par]
            b.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    segs = [(nom, np.array(J[h]), np.array(J[t] if t else J[h]), sg) for nom, h, t, par, sg in BONES if nom != "base"]

    musc, os_ = collections_objets()
    p("muscles", len(musc), "os", len(os_))
    nv = 0
    for o in musc + os_:
        for m in [m for m in o.modifiers if m.type in ('HOOK', 'ARMATURE')]:
            o.modifiers.remove(m)
        if o.data.users > 1:
            o.data = o.data.copy()
        o.vertex_groups.clear()
        n = len(o.data.vertices)
        if n == 0: continue
        co = np.empty(n * 3); o.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        mw = np.array(o.matrix_world)
        w = co @ mw[:3, :3].T + mw[:3, 3]
        cx = w[:, 0].mean()
        elig = [s for s in segs if s[3] == 0 or (s[3] > 0 and cx > -0.02) or (s[3] < 0 and cx < 0.02)]
        if o not in musc:
            n_ = o.name.lower()
            CENTRE = ("bassin", "lombaires", "dorsales", "thorax", "cou", "tete")
            if any(k in n_ for k in ("sacrum", "coccyx", "hip bone", "pubic", "ilium", "ischium", "pelvi")):
                elig = [s for s in segs if s[0] == "bassin"]
            elif any(k in n_ for k in ("scapul", "clavic", "sternum", "rib", "costal", "manubri", "xiphoid")):
                elig = [s for s in segs if s[0] in ("thorax", "dorsales")]
            elif any(k in n_ for k in ("vertebra", "atlas", "axis", "intervertebral")):
                elig = [s for s in segs if s[0] in CENTRE]
            elif any(k in n_ for k in ("skull", "cranium", "mandible", "maxilla", "bone of", "tooth", "teeth", "hyoid", "nasal",
                                        "frontal", "parietal", "occipital", "temporal", "sphenoid", "ethmoid", "zygomatic",
                                        "vomer", "lacrimal", "palatine", "concha", "ossicle", "malleus", "incus", "stapes")):
                elig = [s for s in segs if s[0] in ("tete",)] if abs(cx) < 0.09 else elig
            else:
                elig = [s for s in elig if s[3] != 0] or elig
        if o in musc:
            n_ = o.name.lower(); cz = w[:, 2].mean()
            JAMBE = ("cuisse", "jambe", "pied")
            HANCHE = ("glute", "psoas", "iliacus", "iliopsoas", "piriformis", "obturator", "gemellus", "quadratus femoris",
                      "tensor fasciae", "sartorius", "rectus femoris", "gracilis", "adductor", "pectineus", "biceps femoris",
                      "semitendinosus", "semimembranosus")
            if cz > 0.92 and not any(k in n_ for k in HANCHE):
                elig = [s for s in elig if s[0].split(".")[0] not in JAMBE]
            BRAS = ("clavicule", "bras", "avant_bras", "avant_bras2", "main")
            cen = w.mean(axis=0)
            def dseg(a, b):
                ab = b - a; t = np.clip((cen - a) @ ab / max(ab @ ab, 1e-9), 0, 1); return np.linalg.norm(cen - (a + t * ab))
            est_bras = lambda nom: nom.split(".")[0] in BRAS or nom.startswith("doigt")
            ARM_TRONC = ("latissimus", "pectoralis", "trapezius", "deltoid", "serratus anterior", "teres", "infraspinatus",
                         "supraspinatus", "subscapularis", "rhomboid", "coracobrachialis", "biceps brachii", "triceps",
                         "levator scapulae", "subclavius", "omohyoid")
            dbras = min([dseg(a, b) for nom, a, b, sg in elig if est_bras(nom)] or [9])
            if dbras > 0.06 and (cz < 1.1 or not any(k in n_ for k in ARM_TRONC)):
                elig = [s for s in elig if not est_bras(s[0])]
            if any(k in n_ for k in ("rectus abdominis", "oblique", "transversus abdominis", "pyramidalis", "quadratus lumborum",
                                     "erector", "iliocostalis", "longissimus", "spinalis", "multifid", "rotatores", "interspinal",
                                     "intertransvers", "serratus posterior", "intercostal", "subcostal", "diaphragm")):
                elig = [s for s in elig if s[3] == 0]
        pts = w if o in musc else w.mean(axis=0, keepdims=True)
        D = []
        for nom, a, b, sg in elig:
            ab = b - a; L2 = max(ab @ ab, 1e-9)
            t_ = ((pts - a) @ ab) / L2
            t = np.clip(t_, 0, 1)
            d = np.linalg.norm(pts - (a + t[:, None] * ab), axis=1)
            # au-delà de la tête de l'os (côté parent), on laisse la place au parent
            d = d + 2.5 * np.maximum(0, -t_) * math.sqrt(L2)
            if sg != 0:  # un membre ne capte pas les sommets de l'autre côté
                d = np.where(pts[:, 0] * sg < -0.01, 9.0, d)
            D.append(d)
        D = np.array(D)
        if o in musc:
            W = 1.0 / (D + 0.004) ** 6
            W /= W.sum(axis=0, keepdims=True)
            for i, (nom, a, b, sg) in enumerate(elig):
                idx = np.nonzero(W[i] > 0.01)[0]
                if len(idx) == 0: continue
                vg = o.vertex_groups.new(name=nom)
                for val in np.unique(np.round(W[i, idx], 2)):
                    vg.add(idx[np.round(W[i, idx], 2) == val].tolist(), float(val), 'REPLACE')
        else:
            nom = elig[int(np.argmin(D[:, 0]))][0]
            o.vertex_groups.new(name=nom).add(list(range(n)), 1.0, 'REPLACE')
        mod = o.modifiers.new("Squelette", 'ARMATURE'); mod.object = arm
        if len(o.modifiers) > 1:
            o.modifiers.move(len(o.modifiers) - 1, 0)
        nv += n
    p("poids calculés pour", nv, "sommets en", round(time.time() - t0), "s")
    return arm

def _norm(spec):
    if spec is None: return None
    if isinstance(spec, dict): return dict(spec)
    if isinstance(spec, (tuple, list)): return {"x": spec[0], "tw": spec[1]}
    return {"x": spec}

def _rotation(spec, sg, rest):
    if "dir" in spec:
        d = Vector(spec["dir"]); d.x *= sg
        cur = rest @ Vector((0, 1, 0))
        M = cur.rotation_difference(d.normalized()).to_matrix()
    else:
        M = (Matrix.Rotation(math.radians(spec.get("z", 0) * sg), 3, 'Z') @ Matrix.Rotation(math.radians(spec.get("y", 0) * sg), 3, 'Y')
             @ Matrix.Rotation(math.radians(spec.get("x", 0)), 3, 'X'))
    return M @ rest @ Matrix.Rotation(math.radians(spec.get("tw", 0) * sg), 3, 'Y')

def point_os(arm, nom, ou="tail"):
    b = arm.pose.bones[nom]
    return (b.head if ou == "head" else b.tail if ou == "tail" else (b.head + b.tail) / 2).copy()

def poser(arm, angles, ancre="pieds"):
    """angles : orientation de chaque os dans le repère du monde, par rapport à la position anatomique.
    Nombre = rotation sagittale (degrés ; + : un os orienté vers le haut bascule vers l'avant, un os orienté vers le bas part vers l'arrière).
    (angle, torsion) ; ou dict avec x, y, z (rotations du monde, miroir pour le côté droit), dir (direction visée), tw (torsion autour de l'os).
    Clé « os » : les deux côtés ; « os.l » / « os.r » : un seul côté. Un os non précisé suit son parent.
    ancre : 'pieds' (chevilles à leur place), ('point', os, 'head'|'tail'|'mid', (x, y, z) avec None pour libre), ou None."""
    pb = arm.pose.bones
    for b in pb:
        b.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    A = {k: _norm(v) for k, v in angles.items()}
    for sd in ("l", "r"):  # la pronation se répartit le long de l'avant-bras, la main suit le radius
        ab = A.get(f"avant_bras.{sd}") or A.get("avant_bras")
        mn = A.get(f"main.{sd}") or A.get("main")
        if ab is None: continue
        T = mn["tw"] if (mn is not None and "tw" in mn) else ab.get("tw", 0)
        a1 = dict(ab); a1["tw"] = T * 0.35; A[f"avant_bras.{sd}"] = a1
        if f"avant_bras2.{sd}" not in A and "avant_bras2" not in A:
            a2 = dict(ab); a2["tw"] = T * 0.75; A[f"avant_bras2.{sd}"] = a2
    for nom, h, t, par, sg in BONES:
        spec = A.get(nom, A.get(nom.split(".")[0]))
        if spec is None:
            continue
        bpy.context.view_layer.update()
        b = pb[nom]
        head = b.matrix.translation.copy()
        rest = arm.data.bones[nom].matrix_local.to_3x3()
        b.matrix = Matrix.Translation(head) @ _rotation(spec, sg, rest).to_4x4()
    bpy.context.view_layer.update()
    deplacer = None
    if ancre == "pieds":
        ch = (pb["jambe.l"].tail + pb["jambe.r"].tail) / 2
        rest_ch = Vector(((J["cheville.l"][0] + J["cheville.r"][0]) / 2, J["cheville.l"][1], J["cheville.l"][2]))
        deplacer = rest_ch - ch
    elif isinstance(ancre, tuple) and ancre[0] == "point":
        _, nom, ou, cible = ancre
        cur = point_os(arm, nom, ou)
        deplacer = Vector([(c - v) if c is not None else 0 for c, v in zip(cible, cur)])
    if deplacer is not None:
        pb["base"].matrix = Matrix.Translation(deplacer) @ pb["base"].matrix
        bpy.context.view_layer.update()

def fermer_mains(arm, flex=(55, 90, 60), pouce=(25, 35, 45), signe=1):
    """Fléchit les doigts (angles en degrés par articulation, de la base vers le bout), autour de l'axe de flexion au repos."""
    pb = arm.pose.bones
    for b in pb:
        if not b.name.startswith("doigt"): continue
        k = int(b.name[5]); i = int(b.name.split("_")[1].split(".")[0]); sd = b.name[-1]
        rest = arm.data.bones[b.name].matrix_local.to_3x3()
        d = (rest @ Vector((0, 1, 0))).normalized()
        if k == 0:
            # le pouce se replie vers la paume, vers l'index
            idx = Vector(J[f"d1_1.{sd}"]) - Vector(J[f"d0_1.{sd}"])
            ax = d.cross(idx).normalized(); ang = pouce[min(i, 2)]
        else:
            ax = d.cross(Vector((0, -1, 0))).normalized(); ang = flex[min(i, 2)]  # la paume regarde vers l'avant au repos
        ax_loc = rest.inverted() @ ax
        b.matrix_basis = Matrix.Rotation(math.radians(ang * signe), 4, ax_loc)
    bpy.context.view_layer.update()

def centre_prise(arm, sd):
    pb = arm.pose.bones
    pts = [pb[f"doigt{k}_{i}.{sd}"].head for k in range(1, 5) for i in range(3) if f"doigt{k}_{i}.{sd}" in pb]
    pts += [pb[f"doigt{k}_2.{sd}"].tail for k in range(1, 5) if f"doigt{k}_2.{sd}" in pb]
    return sum(pts, Vector()) / len(pts)
