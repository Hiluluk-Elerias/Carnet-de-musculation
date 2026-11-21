"""Moteur de dessin des planches anatomiques (SVG originaux).

Le personnage est vu de profil et construit sur un squelette articulé : tronc, cou, tête,
bras (humérus, avant-bras, main) et jambes (fémur, tibia, pied), côté proche et côté éloigné.
Chaque muscle est un fuseau tendu entre deux points d'ancrage portés par les segments osseux,
il suit donc la pose. Muscles principaux en rouge, secondaires en orangé, autres en beige.

Repère : x vers la droite (le personnage regarde vers la droite), y vers le haut.
Angles en degrés, mesurés depuis la verticale montante, dans le sens horaire :
0 = vers le haut, 90 = vers l'avant, 180 = vers le bas, 270 = vers l'arrière.
"""
import math

# ------------------------------------------------------------------ géométrie
def rad(a): return math.radians(a)
def vdir(a): return (math.sin(rad(a)), math.cos(rad(a)))
def add(*ps): return (sum(p[0] for p in ps), sum(p[1] for p in ps))
def sub(p, q): return (p[0] - q[0], p[1] - q[1])
def mul(p, k): return (p[0] * k, p[1] * k)
def length(p): return math.hypot(p[0], p[1])
def unit(p):
    l = length(p)
    return (p[0] / l, p[1] / l) if l > 1e-9 else (0.0, 1.0)
def ccw(v): return (-v[1], v[0])
def cw(v): return (v[1], -v[0])
def angle(v): return math.degrees(math.atan2(v[0], v[1]))
def lerp(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
def P(p): return f"{p[0]:.1f},{-p[1]:.1f}"


def path_closed(pts, k=1.0):
    n = len(pts)
    d = f"M{P(pts[0])}"
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = add(p1, mul(sub(p2, p0), k / 6))
        c2 = sub(p2, mul(sub(p3, p1), k / 6))
        d += f" C{P(c1)} {P(c2)} {P(p2)}"
    return d + " Z"


def path_open(pts, k=1.0):
    n = len(pts)
    d = f"M{P(pts[0])}"
    for i in range(n - 1):
        p0 = pts[i - 1] if i > 0 else pts[i]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < n else pts[i + 1]
        c1 = add(p1, mul(sub(p2, p0), k / 6))
        c2 = sub(p2, mul(sub(p3, p1), k / 6))
        d += f" C{P(c1)} {P(c2)} {P(p2)}"
    return d


def poly(pts):
    return "M" + " L".join(P(p) for p in pts) + " Z"


def ellipse_pts(c, rx, ry, a=0.0, n=14):
    """Ellipse de centre c, demi-axe rx le long de la direction a, ry perpendiculaire."""
    d = vdir(a); nn = ccw(d)
    return [add(c, mul(d, rx * math.cos(2 * math.pi * i / n)), mul(nn, ry * math.sin(2 * math.pi * i / n))) for i in range(n)]


# ------------------------------------------------------------------ couleurs
PAL = {
    'near': dict(skin='#f3e3d6', skin_line='#5e463b', mus='#ecd0bf', mus_line='#80604f', fib='#c99f8a'),
    'far': dict(skin='#dccabd', skin_line='#735c50', mus='#d6bba9', mus_line='#957666', fib='#b8937f'),
}
HL = {
    'near': {'p': dict(fill='#d7343c', line='#7a1219', fib='#a01d25'), 's': dict(fill='#f39375', line='#a84a2f', fib='#cf6a4a')},
    'far': {'p': dict(fill='#b8383e', line='#6e161b', fib='#8c2228'), 's': dict(fill='#d98b70', line='#93462f', fib='#b8603f')},
}
INK = '#2b2622'
EQUIP = dict(fill='#d5d9df', line='#4b5360', dark='#5b6472', light='#eef0f3')

# ------------------------------------------------------------------ squelette
SEGLEN = dict(torso=50.0, neck=8.0, ua=29.0, fa=25.0, th=44.0, sh=42.0)


class Seg:
    def __init__(self, a, b, ant):
        self.a, self.b = a, b
        v = sub(b, a)
        self.L = max(length(v), 1e-6)
        self.d = unit(v)
        self.n = ccw(self.d) if ant == 'ccw' else cw(self.d)

    def pt(self, t, off=0.0):
        return add(self.a, mul(self.d, t * self.L), mul(self.n, off))


def ik2(A, T, l1, l2, bend):
    """Cinématique inverse à deux segments. bend = +1 / -1 choisit le côté du coude ou du genou."""
    v = sub(T, A)
    d = length(v)
    d = min(max(d, abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3)
    ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    a = math.degrees(math.acos(max(-1.0, min(1.0, ca))))
    E = add(A, mul(vdir(angle(v) + bend * a), l1))
    W = add(E, mul(unit(sub(T, E)), l2))
    return E, W


def ik_pick(A, T, l1, l2, bend):
    """bend : +1 / -1, ou 'low' / 'high' / 'front' / 'back' pour choisir la solution la plus basse, haute…"""
    if not isinstance(bend, str):
        return ik2(A, T, l1, l2, bend)
    sols = [ik2(A, T, l1, l2, 1), ik2(A, T, l1, l2, -1)]
    key = {'low': lambda s: s[0][1], 'high': lambda s: -s[0][1], 'front': lambda s: -s[0][0], 'back': lambda s: s[0][0]}[bend]
    return min(sols, key=key)


def standing():
    return dict(
        hip=(0.0, 93.0), torso=0.0, head=0.0,
        arms=dict(near=dict(ua=181, fa=181), far=dict(ua=183, fa=183, off=(-1.5, 0.6))),
        legs=dict(near=dict(th=180, sh=180, ft=90), far=dict(th=178, sh=181, ft=90, off=(-1.5, 0))),
    )


def build(p):
    S = {}
    hip = p['hip']
    torso = Seg(hip, add(hip, mul(vdir(p['torso']), SEGLEN['torso'])), 'cw')
    S['torso'] = torso
    sho = torso.pt(0.97, 1.0)
    S['shoulder'] = sho
    nb = torso.pt(1.04, -1.4)
    hdir = vdir(p['torso'] + p.get('head', 0))
    nt = add(nb, mul(hdir, SEGLEN['neck']))
    S['neck'] = Seg(nb, nt, 'cw')
    S['head'] = Seg(nt, add(nt, hdir), 'cw')
    for side in ('far', 'near'):
        a = p['arms'][side]
        l1 = SEGLEN['ua'] * a.get('sua', 1)
        l2 = SEGLEN['fa'] * a.get('sfa', 1)
        base = add(sho, a.get('off', (0, 0)))
        if 'target' in a:
            E, W = ik_pick(base, a['target'], l1, l2, a.get('bend', 1))
        else:
            E = add(base, mul(vdir(a['ua']), l1))
            W = add(E, mul(vdir(a['fa']), l2))
        S['ua_' + side] = Seg(base, E, 'ccw')
        S['fa_' + side] = Seg(E, W, 'ccw')
        S['hand_' + side] = dict(at=W, ang=a.get('hd', angle(sub(W, E))), grip=a.get('grip', 'fist'),
                                 flip=a.get('flip', False))
        l = p['legs'][side]
        l1 = SEGLEN['th'] * l.get('sth', 1)
        l2 = SEGLEN['sh'] * l.get('ssh', 1)
        base = add(hip, l.get('off', (0, 0)))
        if 'target' in l:
            K, Ak = ik_pick(base, l['target'], l1, l2, l.get('bend', -1))
        else:
            K = add(base, mul(vdir(l['th']), l1))
            Ak = add(K, mul(vdir(l['sh']), l2))
        S['th_' + side] = Seg(base, K, 'ccw')
        S['sh_' + side] = Seg(K, Ak, 'ccw')
        S['foot_' + side] = dict(at=Ak, ang=l.get('ft', 90))
    return S


def place(p, joint, target):
    """Décale la pose pour qu'un point du squelette ('shoulder', 'hip'…) tombe sur target."""
    S = build(p)
    cur = S[joint] if isinstance(S[joint], tuple) else S[joint]
    dx, dy = sub(target, cur)
    p['hip'] = add(p['hip'], (dx, dy))
    return p


# ------------------------------------------------------------------ silhouettes
TORSO_ANT = [(-0.06, 6.0), (0.06, 8.0), (0.22, 9.0), (0.40, 9.6), (0.55, 10.4), (0.68, 12.4), (0.82, 12.4), (0.94, 9.0), (1.04, 4.6)]
TORSO_POST = [(1.06, -5.0), (0.99, -9.2), (0.86, -11.0), (0.68, -11.0), (0.50, -9.0), (0.34, -7.2), (0.20, -9.0), (0.07, -11.2), (-0.07, -10.2), (-0.17, -6.0)]
PROF = {
    'th': [(0.0, 8.0, 8.4), (0.25, 7.6, 7.4), (0.6, 6.6, 6.2), (0.9, 5.6, 5.3), (1.0, 5.1, 4.9)],
    'sh': [(0.0, 4.8, 4.8), (0.2, 4.2, 6.3), (0.45, 3.9, 5.6), (0.75, 3.1, 3.5), (1.0, 2.9, 2.9)],
    'ua': [(0.0, 5.3, 5.3), (0.35, 4.5, 4.9), (0.8, 3.8, 3.9), (1.0, 3.5, 3.5)],
    'fa': [(0.0, 3.8, 3.8), (0.25, 4.2, 3.8), (0.7, 2.9, 2.7), (1.0, 2.3, 2.2)],
    'neck': [(0.0, 4.4, 5.0), (1.0, 3.9, 4.3)],
}
HEAD = [(-2.4, 0.2), (-6.6, 3.2), (-8.2, 8.2), (-7.4, 14.2), (-4.2, 18.8), (0.6, 20.6), (5.0, 19.4), (7.6, 15.6),
        (8.3, 12.4), (7.7, 10.9), (8.5, 9.6), (9.9, 7.5), (8.2, 6.7), (8.7, 5.4), (8.2, 4.5), (8.6, 3.5),
        (7.6, 1.7), (5.4, 0.3), (2.0, 0.7)]
FOOT = [(-4.6, 0.8), (-5.4, -3.2), (-4.2, -6.6), (-1.0, -7.2), (7.0, -7.0), (14.5, -6.6), (19.0, -5.6),
        (20.6, -4.2), (19.6, -2.8), (15.5, -2.2), (9.5, -0.6), (4.0, 2.0), (1.0, 3.6), (-2.8, 3.2)]

# ------------------------------------------------------------------ muscles
# A et B : (segment, t le long du segment, décalage perpendiculaire ; positif = face avant)
MUSCLES = {
    'torso': [
        dict(id='erectors', A=('torso', 0.05, -6.2), B=('torso', 0.56, -7.0), w=2.4, peak=0.45),
        dict(id='obliques', A=('torso', 0.10, 1.2), B=('torso', 0.57, 3.8), w=5.6, peak=0.45),
        dict(id='abs', A=('torso', 0.03, 6.0), B=('torso', 0.64, 8.8), w=2.5, peak=0.5, bands=True),
        dict(id='serratus', A=('torso', 0.56, 8.0), B=('torso', 0.73, 1.8), w=1.5, peak=0.45),
        dict(id='serratus', A=('torso', 0.63, 9.2), B=('torso', 0.78, 1.4), w=1.5, peak=0.45),
        dict(id='serratus', A=('torso', 0.70, 10.2), B=('torso', 0.83, 1.0), w=1.4, peak=0.45),
        dict(id='lats', A=('torso', 0.24, -5.2), B=('ua', 0.15, -1.2), w=6.3, peak=0.42),
        dict(id='trap', A=('neck', 0.75, -3.2), B=('torso', 0.62, -8.6), w=3.2, peak=0.4),
    ],
    'arm': [
        dict(id='pec', A=('torso', 0.78, 9.0), B=('ua', 0.15, 1.4), w=5.8, peak=0.45),
        dict(id='triceps', A=('ua', 0.04, -2.0), B=('fa', 0.02, -2.2), w=3.7, peak=0.45),
        dict(id='brachialis', A=('ua', 0.52, 0.2), B=('fa', 0.14, -0.3), w=2.3, peak=0.5),
        dict(id='biceps', A=('ua', 0.22, 1.7), B=('fa', 0.10, 0.8), w=3.3, peak=0.55),
        dict(id='delt_post', A=('torso', 0.99, -5.2), B=('ua', 0.50, -1.8), w=3.3, peak=0.35),
        dict(id='delt_mid', A=('torso', 1.05, 0.0), B=('ua', 0.53, 0.0), w=3.6, peak=0.35),
        dict(id='delt_ant', A=('torso', 1.0, 4.8), B=('ua', 0.50, 1.9), w=3.3, peak=0.35),
        dict(id='flex_av', A=('fa', 0.05, -1.6), B=('fa', 0.72, -1.1), w=2.4, peak=0.35),
        dict(id='ext_av', A=('fa', 0.10, 0.1), B=('fa', 0.80, 0.1), w=2.1, peak=0.35),
        dict(id='brachiorad', A=('ua', 0.66, 1.8), B=('fa', 0.74, 1.2), w=2.8, peak=0.3),
    ],
    'leg': [
        dict(id='glute_med', A=('torso', 0.24, -1.2), B=('th', 0.04, -0.6), w=3.6, peak=0.5),
        dict(id='hams', A=('torso', -0.04, -4.4), B=('sh', 0.08, -2.4), w=4.6, peak=0.45),
        dict(id='glute', A=('torso', 0.25, -7.4), B=('th', 0.30, -3.4), w=6.2, peak=0.42, bias=-0.12),
        dict(id='vastus', A=('th', 0.14, 0.0), B=('th', 0.95, 1.0), w=5.4, peak=0.55),
        dict(id='quads', A=('th', 0.02, 4.0), B=('sh', 0.02, 3.1), w=5.5, peak=0.45),
        dict(id='tib', A=('sh', 0.08, 2.3), B=('sh', 0.80, 1.2), w=2.3, peak=0.4),
        dict(id='soleus', A=('sh', 0.30, -1.3), B=('sh', 0.86, -1.1), w=3.1, peak=0.45),
        dict(id='gastro', A=('th', 0.94, -2.5), B=('sh', 0.64, -2.1), w=4.5, peak=0.35),
    ],
}

NOMS = {
    'erectors': 'Érecteurs du rachis', 'obliques': 'Oblique externe', 'abs': "Grand droit de l'abdomen",
    'serratus': 'Dentelé antérieur', 'lats': 'Grand dorsal', 'trap': 'Trapèze', 'pec': 'Grand pectoral',
    'triceps': 'Triceps brachial', 'brachialis': 'Brachial', 'biceps': 'Biceps brachial',
    'delt_post': 'Deltoïde postérieur', 'delt_mid': 'Deltoïde moyen', 'delt_ant': 'Deltoïde antérieur',
    'flex_av': 'Fléchisseurs des doigts', 'ext_av': 'Extenseurs du poignet', 'brachiorad': 'Brachio-radial',
    'glute_med': 'Moyen fessier', 'hams': 'Ischio-jambiers', 'glute': 'Grand fessier', 'vastus': 'Vaste latéral',
    'quads': 'Quadriceps', 'tib': 'Tibial antérieur', 'soleus': 'Soléaire', 'gastro': 'Gastrocnémien',
}


def spindle(A, B, w, peak=0.5, bias=0.0, n=8):
    v = sub(B, A)
    d = unit(v)
    nrm = ccw(d)
    top, bot, mid = [], [], []
    for i in range(n + 1):
        f = i / n
        g = f / (2 * peak) if f <= peak else 0.5 + (f - peak) / (2 * (1 - peak))
        wf = w * (max(0.0, math.sin(math.pi * g)) ** 0.72)
        c = add(A, mul(v, f))
        top.append(add(c, mul(nrm, wf * (1 + bias))))
        bot.append(add(c, mul(nrm, -wf * (1 - bias))))
        mid.append((c, wf))
    return top + bot[::-1][1:-1], mid, nrm


# ------------------------------------------------------------------ cadre de dessin
class Frame:
    def __init__(self, hl=None):
        self.items = []
        self.pts = []
        self.tags = {}
        self.anchors = {}
        self.hl = hl or {}

    def add(self, z, svg, pts=(), tag=None):
        self.items.append((z, len(self.items), svg))
        self.pts.extend(pts)
        if tag:
            self.tags.setdefault(tag, []).extend(pts)

    def svg(self):
        return "".join(s for _, _, s in sorted(self.items))

    def bbox(self):
        xs = [p[0] for p in self.pts]
        ys = [p[1] for p in self.pts]
        return min(xs), min(ys), max(xs), max(ys)

    def low(self, tags):
        ys = [p[1] for t in tags for p in self.tags.get(t, [])]
        return min(ys)


def shape(fr, z, pts, fill, line, sw=0.7, tag=None, k=1.0, extra=""):
    fr.add(z, f'<path d="{path_closed(pts, k)}" fill="{fill}" stroke="{line}" stroke-width="{sw}" stroke-linejoin="round"{extra}/>', pts, tag)


def line(fr, z, pts, color=INK, sw=0.8, dash=None, smooth=False, extra=""):
    d = path_open(pts) if smooth else "M" + " L".join(P(p) for p in pts)
    da = f' stroke-dasharray="{dash}"' if dash else ""
    fr.add(z, f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"{da}{extra}/>', pts)


def circle(fr, z, c, r, fill, line_c, sw=0.7, opacity=1.0):
    op = f' fill-opacity="{opacity}"' if opacity < 1 else ""
    fr.add(z, f'<circle cx="{c[0]:.2f}" cy="{-c[1]:.2f}" r="{r:.2f}" fill="{fill}" stroke="{line_c}" stroke-width="{sw}"{op}/>',
           [(c[0] - r, c[1] - r), (c[0] + r, c[1] + r)])


def arrow(fr, pts, color='#1f2a37', sw=1.3, z=95, smooth=True):
    """Flèche de mouvement (trait + pointe)."""
    d = path_open(pts) if smooth and len(pts) > 2 else "M" + " L".join(P(p) for p in pts)
    tip = pts[-1]
    back = unit(sub(pts[-2], tip))
    hw = 3.0
    b = add(tip, mul(back, 5.5))
    head = [tip, add(b, mul(ccw(back), hw)), add(b, mul(cw(back), hw))]
    fr.add(z, f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round"/>'
              f'<path d="{poly(head)}" fill="{color}"/>', list(pts) + head)


def text(fr, z, at, s, size=7.2, anchor='start', color=INK, weight=400):
    s2 = s.replace('&', '&amp;').replace('<', '&lt;')
    w = len(s) * size * 0.52
    x0 = at[0] - (w if anchor == 'end' else w / 2 if anchor == 'middle' else 0)
    fr.add(z, f'<text x="{at[0]:.1f}" y="{-at[1]:.1f}" font-size="{size}" text-anchor="{anchor}" fill="{color}" font-weight="{weight}">{s2}</text>',
           [(x0, at[1] - 2), (x0 + w, at[1] + size)])


# ------------------------------------------------------------------ corps
Z = dict(far_arm=10, far_hand=12, far_leg=20, far_foot=22, mid=25, torso=30, torso_m=35, near_leg=40, near_leg_m=44,
         near_foot=47, head=50, near_arm=60, near_arm_m=64, near_hand=70, front=80)


def limb_pts(seg, prof):
    ant = [seg.pt(t, wa) for t, wa, wp in prof]
    post = [seg.pt(t, -wp) for t, wa, wp in prof][::-1]
    w1 = (prof[-1][1] + prof[-1][2]) / 2
    w0 = (prof[0][1] + prof[0][2]) / 2
    return ant + [add(seg.b, mul(seg.d, w1 * 0.7))] + post + [add(seg.a, mul(seg.d, -w0 * 0.7))]


def seg_of(S, name, side):
    return S[name] if name in ('torso', 'neck') else S[name + '_' + side]


def draw_muscle(fr, S, side, m, z):
    A = seg_of(S, m['A'][0], side).pt(m['A'][1], m['A'][2])
    B = seg_of(S, m['B'][0], side).pt(m['B'][1], m['B'][2])
    outline, mid, nrm = spindle(A, B, m['w'], m.get('peak', 0.5), m.get('bias', 0.0))
    role = fr.hl.get(m['id'])
    base = PAL[side]
    if role:
        c = HL[side][role]
        fill, ln, fib = c['fill'], c['line'], c['fib']
    else:
        fill, ln, fib = base['mus'], base['mus_line'], base['fib']
    svg = f'<path d="{path_closed(outline)}" fill="{fill}" stroke="{ln}" stroke-width="0.5" stroke-linejoin="round"/>'
    b = m.get('bias', 0.0)
    if side == 'near' or role:
        sm = mid[::2] if len(mid) > 5 else mid
        shade = [c for c, wf in sm] + [add(c, mul(nrm, -wf * (1 - b) * 0.96)) for c, wf in sm][::-1][1:-1]
        svg += f'<path d="{path_closed(shade)}" fill="#3a1d12" fill-opacity="0.09" stroke="none"/>'
        fib_d = ""
        for fr_ in (-0.5, 0.0, 0.5):
            pts = [add(c, mul(nrm, wf * fr_)) for c, wf in mid[1:-1:2]] + [mid[-2][0]]
            fib_d += " " + path_open([add(mid[1][0], mul(nrm, mid[1][1] * fr_))] + pts[1:])
        svg += f'<path d="{fib_d}" fill="none" stroke="{fib}" stroke-width="0.32" stroke-linecap="round"/>'
    if m.get('bands'):
        for f in (0.32, 0.52, 0.72):
            c, wf = mid[round(f * (len(mid) - 1))]
            a1, a2 = add(c, mul(nrm, wf)), add(c, mul(nrm, -wf))
            svg += f'<path d="M{P(a1)} L{P(a2)}" stroke="{ln}" stroke-width="0.45"/>'
    fr.add(z, svg, outline, tag='body_' + side)
    key = m['id']
    if side == 'near' or key not in fr.anchors:
        c, wf = mid[len(mid) // 2]
        fr.anchors[key] = c


def draw_head(fr, S):
    h = S['head']
    pts = [h.pt(u, v) for v, u in HEAD]
    shape(fr, Z['head'], pts, PAL['near']['skin'], PAL['near']['skin_line'], 0.75, tag='head')
    ear = ellipse_pts(h.pt(9.4, -1.6), 3.0, 1.8, angle(h.d), 10)
    shape(fr, Z['head'] + 1, ear, PAL['near']['skin'], PAL['near']['skin_line'], 0.5)
    line(fr, Z['head'] + 1, [h.pt(12.0, 4.8), h.pt(12.4, 6.6), h.pt(11.9, 7.6)], PAL['near']['skin_line'], 0.5, smooth=True)
    line(fr, Z['head'] + 1, [h.pt(10.6, 5.6), h.pt(10.4, 6.9)], PAL['near']['skin_line'], 0.6)
    line(fr, Z['head'] + 1, [h.pt(4.5, 4.4), h.pt(2.2, 1.6), h.pt(1.0, -1.2)], PAL['near']['mus_line'], 0.45, smooth=True)


def draw_hand(fr, S, side, z):
    h = S['hand_' + side]
    pal = PAL[side]
    d = vdir(h['ang'])
    if h['grip'] == 'fist':
        c = add(h['at'], mul(d, 4.2))
        pts = ellipse_pts(c, 4.6, 3.9, h['ang'], 12)
        shape(fr, z, pts, pal['skin'], pal['skin_line'], 0.6, tag='hand_' + side)
        n = ccw(d)
        line(fr, z + 0.5, [add(c, mul(n, -2.6), mul(d, -1.0)), add(c, mul(n, 0.4), mul(d, 2.2))], pal['skin_line'], 0.4)
    elif h['grip'] in ('open', 'flat'):
        n = ccw(d)
        sgn = -1 if h.get('flip') else 1
        prof = [(0, 2.3, 2.1), (6, 2.8, 2.0), (10, 2.4, 1.7), (15, 1.6, 1.2), (17.2, 0.6, 0.6)]
        top = [add(h['at'], mul(d, t), mul(n, sgn * a)) for t, a, b in prof]
        bot = [add(h['at'], mul(d, t), mul(n, -sgn * b)) for t, a, b in prof][::-1]
        shape(fr, z, top + bot, pal['skin'], pal['skin_line'], 0.6, tag='hand_' + side)
    elif h['grip'] == 'crimp':
        # semi-arqué : paume dans l'axe, doigts repliés à 90° sur la réglette
        n = ccw(d)
        palm_end = add(h['at'], mul(d, 9.5))
        tip = add(palm_end, mul(n, 6.2), mul(d, 1.5))
        pts = [add(h['at'], mul(n, 2.4)), add(palm_end, mul(n, 2.6)), add(tip, mul(d, 1.6)), add(tip, mul(d, -1.4)),
               add(palm_end, mul(n, -0.6), mul(d, -2.2)), add(h['at'], mul(n, -2.2))]
        shape(fr, z, pts, pal['skin'], pal['skin_line'], 0.6, tag='hand_' + side)


def draw_foot(fr, S, side, z):
    f = S['foot_' + side]
    d = vdir(f['ang'])
    n = ccw(d)
    pts = [add(f['at'], mul(d, x), mul(n, y)) for x, y in FOOT]
    shape(fr, z, pts, PAL[side]['skin'], PAL[side]['skin_line'], 0.6, tag='foot_' + side)


def draw_figure(fr, S, show_far_arm=True, show_far_leg=True):
    pal_n, pal_f = PAL['near'], PAL['far']
    # côté éloigné
    if show_far_arm:
        for nm in ('ua', 'fa'):
            shape(fr, Z['far_arm'], limb_pts(S[nm + '_far'], PROF[nm]), pal_f['skin'], pal_f['skin_line'], 0.6, tag='body_far')
        for m in MUSCLES['arm']:
            draw_muscle(fr, S, 'far', m, Z['far_arm'] + 1)
        draw_hand(fr, S, 'far', Z['far_hand'])
    if show_far_leg:
        for nm in ('th', 'sh'):
            shape(fr, Z['far_leg'], limb_pts(S[nm + '_far'], PROF[nm]), pal_f['skin'], pal_f['skin_line'], 0.6, tag='body_far')
        for m in MUSCLES['leg']:
            draw_muscle(fr, S, 'far', m, Z['far_leg'] + 1)
        draw_foot(fr, S, 'far', Z['far_foot'])
    # tronc
    t = S['torso']
    tp = [t.pt(a, o) for a, o in TORSO_ANT] + [t.pt(a, o) for a, o in TORSO_POST]
    shape(fr, Z['torso'], tp, pal_n['skin'], pal_n['skin_line'], 0.8, tag='torso')
    shape(fr, Z['torso'] + 1, limb_pts(S['neck'], PROF['neck']), pal_n['skin'], pal_n['skin_line'], 0.7, tag='torso')
    for m in MUSCLES['torso']:
        draw_muscle(fr, S, 'near', m, Z['torso_m'])
    # jambe proche
    for nm in ('th', 'sh'):
        shape(fr, Z['near_leg'], limb_pts(S[nm + '_near'], PROF[nm]), pal_n['skin'], pal_n['skin_line'], 0.75, tag='body_near')
    for m in MUSCLES['leg']:
        draw_muscle(fr, S, 'near', m, Z['near_leg_m'])
    knee = S['sh_near'].a
    circle(fr, Z['near_leg_m'] + 1, S['sh_near'].pt(0.02, 4.4), 2.3, pal_n['mus'], pal_n['mus_line'], 0.45)
    draw_foot(fr, S, 'near', Z['near_foot'])
    draw_head(fr, S)
    # bras proche
    for nm in ('ua', 'fa'):
        shape(fr, Z['near_arm'], limb_pts(S[nm + '_near'], PROF[nm]), pal_n['skin'], pal_n['skin_line'], 0.75, tag='body_near')
    for m in MUSCLES['arm']:
        draw_muscle(fr, S, 'near', m, Z['near_arm_m'])
    draw_hand(fr, S, 'near', Z['near_hand'])
    return S


# ------------------------------------------------------------------ matériel
def floor(fr, y, x0, x1, z=1):
    fr.add(z, f'<path d="M{P((x0, y))} L{P((x1, y))}" stroke="#8b8f97" stroke-width="0.9"/>', [(x0, y), (x1, y)])
    hatch = "".join(f'<path d="M{P((x, y))} L{P((x - 3.5, y - 3.5))}" stroke="#b9bdc4" stroke-width="0.5"/>'
                    for x in [x0 + 4 + 6 * i for i in range(int((x1 - x0) / 6))])
    fr.add(z, hatch, [(x0, y - 4)])


def plate(fr, c, r, z, opacity=0.38):
    circle(fr, z, c, r, '#7c8594', EQUIP['line'], 0.8, opacity)
    circle(fr, z + 0.1, c, r * 0.45, 'none', EQUIP['line'], 0.5)
    circle(fr, z + 0.2, c, 1.7, EQUIP['dark'], EQUIP['line'], 0.5)


def dumbbell(fr, c, axis, z, length=17.0, r=4.4):
    """Haltère vu de côté : poignée selon axis, disques aux extrémités."""
    d = vdir(axis)
    n = ccw(d)
    a, b = add(c, mul(d, -length / 2)), add(c, mul(d, length / 2))
    fr.add(z, f'<path d="M{P(a)} L{P(b)}" stroke="{EQUIP["dark"]}" stroke-width="1.6" stroke-linecap="round"/>', [a, b])
    for e in (a, b):
        pts = [add(e, mul(d, -2.2), mul(n, r)), add(e, mul(d, 2.2), mul(n, r)), add(e, mul(d, 2.2), mul(n, -r)), add(e, mul(d, -2.2), mul(n, -r))]
        fr.add(z + 0.1, f'<path d="{poly(pts)}" fill="#8d96a3" stroke="{EQUIP["line"]}" stroke-width="0.6" stroke-linejoin="round"/>', pts)


def bench(fr, x0, x1, top, ground, z=2):
    pts = [(x0, top), (x1, top), (x1, top - 4), (x0, top - 4)]
    fr.add(z, f'<path d="{poly(pts)}" fill="#c8a982" stroke="#6b5640" stroke-width="0.7"/>', pts)
    for x in (x0 + 3, x1 - 3):
        fr.add(z, f'<path d="M{P((x, top - 4))} L{P((x, ground))}" stroke="#6b5640" stroke-width="1.6"/>', [(x, ground)])


def bar_end(fr, c, z, r=1.9):
    circle(fr, z, c, r, EQUIP['dark'], EQUIP['line'], 0.6)


def pulley(fr, c, z, r=4.2):
    circle(fr, z, c, r, EQUIP['fill'], EQUIP['line'], 0.8)
    circle(fr, z + 0.1, c, 1.2, EQUIP['dark'], EQUIP['line'], 0.4)


def cable(fr, a, b, z):
    fr.add(z, f'<path d="M{P(a)} L{P(b)}" stroke="#3d4452" stroke-width="0.7"/>', [a, b])


def band(fr, pts, z, closed=False):
    d = path_closed(pts) if closed else path_open(pts)
    fr.add(z, f'<path d="{d}" fill="none" stroke="#2f9e6f" stroke-width="1.6" stroke-linecap="round"/>', pts)


# ------------------------------------------------------------------ mise en page
def labels_layout(fr, labels, font=7.6):
    """Place les noms des muscles à gauche ou à droite du dessin avec un trait de rappel."""
    x0, y0, x1, y1 = fr.bbox()
    cx = (x0 + x1) / 2
    sides = {'L': [], 'R': []}
    for key, txt, role, *forced in labels:
        if key not in fr.anchors and not key.startswith('@'):
            continue
        a = fr.anchors[key] if key in fr.anchors else None
        side = forced[0] if forced else ('L' if a[0] < cx else 'R')
        sides[side].append([a, txt, role])
    gap = font * 1.55
    for side, items in sides.items():
        items.sort(key=lambda it: -it[0][1])
        last = None
        for it in items:
            y = it[0][1]
            if last is not None and y > last - gap:
                y = last - gap
            it.append(y)
            last = y
        # recentre la colonne si elle déborde vers le bas
        if items and items[-1][3] < y0 - 4:
            shift = (y0 - 4) - items[-1][3]
            for it in items:
                it[3] += shift
        for a, txt, role, y in items:
            col = '#9c1c23' if role == 'p' else '#a8492f'
            weight = 600 if role == 'p' else 500
            if side == 'L':
                tx = x0 - 10
                text(fr, 120, (tx, y - font * 0.35), txt, font, 'end', col, weight)
                pts = [(tx + 1.5, y), (x0 - 4, y), a]
            else:
                tx = x1 + 10
                text(fr, 120, (tx, y - font * 0.35), txt, font, 'start', col, weight)
                pts = [(tx - 1.5, y), (x1 + 4, y), a]
            fr.add(119, f'<path d="M{P(pts[0])} L{P(pts[1])} L{P(pts[2])}" fill="none" stroke="#3b332e" stroke-width="0.45"/>'
                        f'<circle cx="{a[0]:.2f}" cy="{-a[1]:.2f}" r="1.15" fill="#3b332e"/>', pts)


def labels_legend(fr, labels, font=None):
    """Repères numérotés sur le dessin et légende en dessous (pour les dessins allongés)."""
    x0, y0, x1, y1 = fr.bbox()
    if font is None:
        font = max(5.6, min(9.0, (x1 - x0 + 16) * 0.036))
    rr = font * 0.42
    nf = font * 0.68
    items = [(k, t, r) for k, t, r, *_ in labels if k in fr.anchors]
    need = max(12 + len(t) * font * 0.53 for k, t, r in items)
    cols = 2 if 2 * need < (x1 - x0) else 1
    colw = (x1 - x0) / cols
    for i, (k, txt, role) in enumerate(items):
        a = fr.anchors[k]
        col = '#9c1c23' if role == 'p' else '#a8492f'
        fr.add(121, f'<circle cx="{a[0]:.2f}" cy="{-a[1]:.2f}" r="{rr:.2f}" fill="#ffffff" stroke="{col}" stroke-width="{rr * 0.26:.2f}"/>'
                    f'<text x="{a[0]:.2f}" y="{-a[1] + nf * 0.36:.2f}" font-size="{nf:.2f}" text-anchor="middle" fill="{col}" font-weight="700">{i + 1}</text>', [a])
        cx = x0 + (i % cols) * colw
        cy = y0 - font * 1.6 - (i // cols) * (font * 1.6)
        my = -(cy - font * 0.7) - font * 0.33
        fr.add(121, f'<circle cx="{cx + rr:.2f}" cy="{my:.2f}" r="{rr:.2f}" fill="#ffffff" stroke="{col}" stroke-width="{rr * 0.26:.2f}"/>'
                    f'<text x="{cx + rr:.2f}" y="{my + nf * 0.36:.2f}" font-size="{nf:.2f}" text-anchor="middle" fill="{col}" font-weight="700">{i + 1}</text>',
               [(cx, cy - 3), (cx + 2 * rr, cy + font)])
        text(fr, 121, (cx + 2 * rr + font * 0.5, cy - font * 0.7), txt, font, 'start', col, 600 if role == 'p' else 500)


def render_svg(frames, captions=None, pad=8, gap=22, layout='row', align='bottom'):
    """Assemble un ou plusieurs cadres dans un SVG autonome : côte à côte (alignés sur le bas)
    ou les uns sous les autres (layout='col', pour les exercices allongés)."""
    boxes = [f.bbox() for f in frames]
    cap_h = 13 if captions else 0
    parts = []
    if layout == 'col':
        W = max(b[2] - b[0] for b in boxes) + 2 * pad
        y = pad
        for i, (f, b) in enumerate(zip(frames, boxes)):
            w, h = b[2] - b[0], b[3] - b[1]
            dx = (W - w) / 2 - b[0]
            if captions:
                parts.append(f'<text x="{W / 2:.1f}" y="{y + 8:.1f}" font-size="8.4" text-anchor="middle" fill="#374151" font-weight="600">{captions[i]}</text>')
            ty = y + cap_h + h + b[1]
            parts.append(f'<g transform="translate({dx:.2f},{ty:.2f})">{f.svg()}</g>')
            y += cap_h + h + gap
        Ht = y - gap + pad
    else:
        H = max(b[3] - b[1] for b in boxes)
        x = pad
        for i, (f, b) in enumerate(zip(frames, boxes)):
            w0 = b[2] - b[0]
            w = max(w0, len(captions[i]) * 4.7) if captions else w0
            dx = x + (w - w0) / 2 - b[0]
            ty = (pad + cap_h + b[3]) if align == 'top' else (pad + cap_h + H + b[1])
            parts.append(f'<g transform="translate({dx:.2f},{ty:.2f})">{f.svg()}</g>')
            if captions:
                parts.append(f'<text x="{x + w / 2:.1f}" y="{pad + 8:.1f}" font-size="8.4" text-anchor="middle" fill="#374151" font-weight="600">{captions[i]}</text>')
            if i < len(frames) - 1 and captions:
                ax = x + w + gap / 2
                ay = pad + cap_h + H / 2
                parts.append(f'<path d="M{ax - 6:.1f},{ay:.1f} L{ax + 4:.1f},{ay:.1f}" stroke="#9ca3af" stroke-width="1.6"/><path d="M{ax + 7:.1f},{ay:.1f} L{ax + 2:.1f},{ay - 3.5:.1f} L{ax + 2:.1f},{ay + 3.5:.1f} Z" fill="#9ca3af"/>')
            x += w + gap
        W = x - gap + pad
        Ht = pad * 2 + cap_h + H
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {Ht:.1f}" font-family="Barlow, \'Segoe UI\', Roboto, Arial, sans-serif">'
            f'<rect width="100%" height="100%" rx="10" fill="#ffffff"/>{"".join(parts)}</svg>')
