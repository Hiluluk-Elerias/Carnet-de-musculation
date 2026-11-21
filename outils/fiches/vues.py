"""Vues particulières : buste de face / de dos (rotation externe) et main vue de dessus (extensions des doigts)."""
from moteur import *


def mirror(pts):
    return [(-x, y) for x, y in pts]


def mshape(fr, z, pts, role, side='near', sw=0.5, fibers=None):
    """Muscle dessiné à partir d'un contour (vue de face ou de dos)."""
    pal = PAL[side]
    if role:
        c = HL[side][role]
        fill, ln, fib = c['fill'], c['line'], c['fib']
    else:
        fill, ln, fib = pal['mus'], pal['mus_line'], pal['fib']
    shape(fr, z, pts, fill, ln, sw)
    for f in fibers or []:
        fr.add(z + 0.1, f'<path d="{path_open(f)}" fill="none" stroke="{fib}" stroke-width="0.32" stroke-linecap="round"/>', f)


def mspindle(fr, z, A, B, w, role, peak=0.5, key=None, side='near'):
    outline, mid, nrm = spindle(A, B, w, peak)
    fibers = [[add(c, mul(nrm, wf * k)) for c, wf in mid[1:-1]] for k in (-0.5, 0, 0.5)]
    mshape(fr, z, outline, role, side, 0.5, fibers)
    if key:
        fr.anchors[key] = mid[len(mid) // 2][0]


def capsule(fr, z, a, b, w0, w1, tag=None, side='near'):
    d = unit(sub(b, a)); n = ccw(d)
    pts = [add(a, mul(n, w0)), add(b, mul(n, w1)), add(b, mul(d, w1 * 0.8)), add(b, mul(n, -w1)), add(a, mul(n, -w0)), add(a, mul(d, -w0 * 0.7))]
    shape(fr, z, pts, PAL[side]['skin'], PAL[side]['skin_line'], 0.7, tag=tag)


# ------------------------------------------------------------------ buste de face / de dos
TORSO_R = [(-5.2, 154.0), (-11.0, 150.6), (-17.4, 147.6), (-16.9, 135.0), (-17.6, 125.0), (-15.6, 113.0), (-13.8, 104.0),
           (-15.4, 96.0), (-17.4, 88.0), (-17.2, 76.0), (-16.0, 64.0), (-2.2, 64.0), (-1.2, 79.0)]
HEAD_R = [(0.0, 178.2), (-5.8, 176.4), (-8.4, 170.0), (-8.2, 163.0), (-6.0, 157.6), (-3.0, 154.6), (0.0, 153.8)]


def torso_outline():
    right = TORSO_R
    left = mirror(right)[::-1]
    return right + [(0.0, 80.4)] + left


def head(fr, z, back=False):
    pts = HEAD_R + mirror(HEAD_R)[::-1][1:-1]
    capsule(fr, z - 1, (0, 150.0), (0, 158.0), 5.0, 4.6)
    for sx in (-1, 1):
        shape(fr, z - 0.5, ellipse_pts((sx * 8.4, 166.0), 3.0, 1.6, 0, 10), PAL['near']['skin'], PAL['near']['skin_line'], 0.5)
    shape(fr, z, pts, PAL['near']['skin'], PAL['near']['skin_line'], 0.75, tag='head')
    if back:
        line(fr, z + 0.1, [(-5.6, 157.8), (0, 156.6), (5.6, 157.8)], PAL['near']['mus_line'], 0.45, smooth=True)
    else:
        for sx in (-1, 1):
            line(fr, z + 0.1, [(sx * 1.8, 167.8), (sx * 4.6, 167.8)], PAL['near']['skin_line'], 0.6)
            line(fr, z + 0.1, [(sx * 1.6, 170.2), (sx * 4.8, 170.8)], PAL['near']['mus_line'], 0.45)
        line(fr, z + 0.1, [(0, 166.6), (-0.6, 162.6), (0.8, 162.2)], PAL['near']['skin_line'], 0.5)
        line(fr, z + 0.1, [(-2.2, 159.8), (2.2, 159.8)], PAL['near']['skin_line'], 0.55)


def arm_front(fr, side_x, elbow, wrist, z, roles=None, back=False, fist_dir=None):
    """Bras vu de face ou de dos : épaule, coude, poignet en coordonnées du plan."""
    roles = roles or {}
    sx = side_x
    sho = (sx * 19.4, 141.0)
    capsule(fr, z, sho, elbow, 5.0, 3.8)
    if back:
        mspindle(fr, z + 1, add(sho, (sx * -0.4, -5.0)), add(elbow, (0, 1.6)), 3.2, roles.get('triceps'), key='triceps' if sx > 0 else None)
    else:
        mspindle(fr, z + 1, add(sho, (sx * -0.2, -6.0)), add(elbow, (sx * 0.2, 2.6)), 3.3, roles.get('biceps'), 0.55)
    capsule(fr, z + 2, elbow, wrist, 3.8, 2.4)
    mspindle(fr, z + 3, add(elbow, mul(unit(sub(wrist, elbow)), 1.0)), lerp(elbow, wrist, 0.72), 2.6, roles.get('forearm'), 0.35)
    d = unit(sub(wrist, elbow)) if fist_dir is None else fist_dir
    c = add(wrist, mul(d, 4.0))
    shape(fr, z + 4, ellipse_pts(c, 4.4, 3.8, angle(d), 12), PAL['near']['skin'], PAL['near']['skin_line'], 0.6, tag='hand')
    return c


def deltoid(fr, sx, z, role, key=None):
    pts = [(15.0, 146.6), (19.8, 147.8), (23.2, 143.0), (23.4, 135.0), (21.0, 128.6), (18.8, 131.6), (16.8, 138.0)]
    pts = [(sx * x, y) for x, y in pts]
    fib = [[(sx * 17.6, 146.4), (sx * 21.4, 139.0), (sx * 21.2, 131.0)], [(sx * 19.8, 147.0), (sx * 22.4, 140.0), (sx * 22.0, 132.0)]]
    mshape(fr, z, pts, role, fibers=fib)
    if key:
        fr.anchors[key] = (sx * 21.4, 140.0)


def front_body(fr, forearm_end, hl):
    """Buste de face, bras droit du sujet (à gauche de l'image) en rotation externe."""
    shape(fr, 30, torso_outline(), PAL['near']['skin'], PAL['near']['skin_line'], 0.8, tag='torso')
    for sx in (-1, 1):
        S = lambda pts: [(sx * abs(x) if x != 0 else 0, y) for x, y in pts]
        mspindle(fr, 31, (sx * 4.6, 155.6), (sx * 17.0, 147.8), 2.3, None)
        mshape(fr, 32, S([(1.2, 144.0), (9.0, 145.6), (16.4, 141.0), (17.0, 136.0), (13.0, 129.6), (6.0, 128.6), (1.2, 130.6)]), None,
               fibers=[S([(2, 141), (9, 139), (16, 138)]), S([(2, 135), (9, 135), (16, 137)]), S([(3, 131), (10, 132), (15, 135)])])
        mshape(fr, 32, S([(0.7, 126.6), (6.0, 127.0), (6.4, 104.0), (5.2, 94.0), (0.7, 92.0)]), None)
        for y in (118.6, 110.6, 102.6):
            line(fr, 32.2, [(sx * 0.8, y), (sx * 6.2, y - 0.4)], PAL['near']['mus_line'], 0.45)
        mshape(fr, 31.5, S([(6.8, 123.0), (15.2, 121.6), (14.2, 106.0), (15.0, 97.6), (9.6, 95.0), (6.8, 103.0)]), None,
               fibers=[S([(8, 120), (12, 110), (12, 99)]), S([(11, 121), (14, 110), (13, 99)])])
        for k in range(3):
            mspindle(fr, 31.6, (sx * 12.4, 128.4 - 3.4 * k), (sx * 16.4, 125.8 - 3.2 * k), 1.2, None)
        mshape(fr, 31.5, S([(15.6, 86.0), (6.0, 82.0), (3.0, 64.4), (15.6, 64.4)]), None,
               fibers=[S([(13, 84), (10, 74), (9, 65)]), S([(8, 82), (6, 73), (5, 65)])])
    head(fr, 50)


def back_body(fr, hl):
    shape(fr, 30, torso_outline(), PAL['near']['skin'], PAL['near']['skin_line'], 0.8, tag='torso')
    trap = [(0.0, 157.0), (-4.6, 154.6), (-17.0, 147.6), (-10.0, 140.0), (0.0, 117.0), (10.0, 140.0), (17.0, 147.6), (4.6, 154.6)]
    mshape(fr, 31.8, trap, hl.get('trap'), fibers=[[(-15, 147), (-7, 143), (0, 140)], [(15, 147), (7, 143), (0, 140)],
                                                [(-9, 139), (-4, 130), (0, 121)], [(9, 139), (4, 130), (0, 121)]])
    fr.anchors['trap'] = (5.0, 137.0)
    for sx in (-1, 1):
        S = lambda pts: [(sx * x, y) for x, y in pts]
        mshape(fr, 31, S([(5.6, 124.0), (17.6, 131.0), (17.8, 119.0), (15.4, 105.0), (6.0, 96.0), (1.6, 100.0)]), None,
               fibers=[S([(6, 121), (12, 115), (14, 106)]), S([(9, 125), (15, 118), (16, 109)])])
        mshape(fr, 31.2, S([(1.0, 122.0), (4.2, 121.0), (4.4, 96.0), (1.0, 94.0)]), None)
        role_i = hl.get('infra') if sx > 0 else None
        role_t = hl.get('teres') if sx > 0 else None
        mshape(fr, 32, S([(5.6, 139.0), (16.6, 143.4), (16.2, 136.5), (13.4, 130.2), (8.4, 125.4), (5.6, 128.6)]), role_i,
               fibers=[S([(7, 137), (12, 136), (16, 139)]), S([(7, 132), (12, 132), (15, 135)]), S([(8, 128), (12, 129), (14, 132)])])
        mspindle(fr, 32.4, S([(13.6, 130.6)])[0], S([(18.6, 136.4)])[0], 1.5, role_t, key='teres' if sx > 0 else None)
        mspindle(fr, 32.3, S([(9.8, 125.8)])[0], S([(18.2, 132.4)])[0], 2.0, None)
        line(fr, 33.5, S([(5.4, 139.8), (11.0, 141.4), (17.2, 144.6)]), PAL['near']['mus_line'], 0.8, smooth=True)
    fr.anchors['infra'] = (11.2, 134.0)
    head(fr, 50, back=True)


def ex_rotation_externe():
    hl_back = {'infra': 'p', 'teres': 'p', 'delt_post': 's', 'trap': 's'}
    frames = []
    for ph in (0, 1):
        fr = Frame({})
        front_body(fr, None, {})
        # bras gauche du sujet (à droite de l'image) le long du corps
        deltoid(fr, 1, 40, None)
        arm_front(fr, 1, (20.8, 113.6), (21.8, 89.6), 36)
        deltoid(fr, 1, 40.5, None)
        # bras droit du sujet (à gauche de l'image) : coude au corps, avant-bras qui pivote
        elbow = (-20.8, 113.6)
        wrist = (-1.2, 111.4) if ph == 0 else (-42.4, 112.4)
        shape(fr, 34, ellipse_pts((-17.2, 116.0), 4.2, 2.1, 0, 10), '#ffffff', '#9aa0a8', 0.5)
        g = arm_front(fr, -1, elbow, wrist, 60)
        deltoid(fr, -1, 61.5, None)
        pul = (50.0, 112.0)
        cable(fr, g, pul, 80)
        pulley(fr, pul, 81, 4.6)
        fr.add(1, f'<path d="M{P((pul[0] + 5, 64))} L{P((pul[0] + 5, 132))}" stroke="{EQUIP["line"]}" stroke-width="2.4"/>', [(pul[0] + 5, 64), (pul[0] + 5, 132)])
        if ph == 0:
            arrow(fr, [(-2.0, 121.0), (-14.0, 128.0), (-30.0, 125.0), (-38.0, 119.0)])
        frames.append(fr)
    # planche : vue de dos, bras droit du sujet (à droite de l'image) en fin de rotation
    pl = Frame(hl_back)
    back_body(pl, hl_back)
    deltoid(pl, -1, 40, None)
    arm_front(pl, -1, (-20.8, 113.6), (-21.8, 89.6), 36, back=True)
    deltoid(pl, -1, 40.5, None)
    shape(pl, 34, ellipse_pts((17.2, 116.0), 4.2, 2.1, 0, 10), '#ffffff', '#9aa0a8', 0.5)
    arm_front(pl, 1, (20.8, 113.6), (42.4, 112.4), 60, roles={}, back=True)
    deltoid(pl, 1, 61.5, hl_back.get('delt_post'), key='delt_post')
    text(pl, 100, (0.0, 184.0), 'Vue de dos', 7.0, 'middle', '#6b7280', 600)
    labels = [('infra', 'Infra-épineux', 'p', 'R'), ('teres', 'Petit rond', 'p', 'R'), ('delt_post', 'Deltoïde postérieur', 's', 'R'),
              ('trap', 'Trapèze (faisceau moyen)', 's', 'L')]
    return dict(frames=frames, planche_frame=pl, labels=labels)


# ------------------------------------------------------------------ main vue de dessus
def finger(fr, z, base, tip, w0, w1, tag='hand'):
    d = unit(sub(tip, base)); n = ccw(d)
    pts = [add(base, mul(n, w0)), add(lerp(base, tip, 0.5), mul(n, (w0 + w1) / 2)), add(tip, mul(n, w1)), add(tip, mul(d, w1 * 0.9)),
           add(tip, mul(n, -w1)), add(lerp(base, tip, 0.5), mul(n, -(w0 + w1) / 2)), add(base, mul(n, -w0))]
    shape(fr, z, pts, PAL['near']['skin'], PAL['near']['skin_line'], 0.6, tag=tag)
    for f in (0.42, 0.72):
        c = lerp(base, tip, f)
        line(fr, z + 0.1, [add(c, mul(n, w0 * 0.55)), add(c, mul(d, 0.4)), add(c, mul(n, -w0 * 0.55))], PAL['near']['mus_line'], 0.35, smooth=True)
    nail = lerp(base, tip, 0.93)
    shape(fr, z + 0.2, ellipse_pts(nail, 1.3, w1 * 0.55, angle(d), 8), '#f7ece4', PAL['near']['mus_line'], 0.3)


def ex_extensions_doigts():
    hl = {'ext_dig': 'p', 'ext_rad': 's', 'ext_uln': 's'}
    BASES = dict(index=(21.6, 6.6), middle=(23.4, 2.2), ring=(22.9, -2.4), little=(20.8, -6.4), thumb=(9.0, 7.6))
    TIPS = [dict(index=(41.2, 2.8), middle=(43.8, 0.9), ring=(42.8, -1.2), little=(38.8, -3.2), thumb=(37.6, 4.8)),
            dict(index=(39.0, 22.5), middle=(47.4, 7.6), ring=(46.0, -7.2), little=(36.6, -18.8), thumb=(16.4, 27.6))]
    W = dict(index=(2.6, 2.0), middle=(2.7, 2.1), ring=(2.5, 1.9), little=(2.1, 1.6), thumb=(3.1, 2.3))
    frames = []
    for ph in (0, 1):
        fr = Frame(hl)
        arm = [(-74, 8.8), (-50, 9.4), (-25, 7.6), (0, 5.8), (0, -5.6), (-25, -7.4), (-50, -9.2), (-74, -8.6)]
        shape(fr, 30, arm, PAL['near']['skin'], PAL['near']['skin_line'], 0.8, tag='arm', k=0.6)
        mspindle(fr, 31, (-70, 5.6), (-14, 3.8), 2.6, hl['ext_rad'], 0.35, key='ext_rad')
        mspindle(fr, 31, (-68, -4.6), (-12, -3.8), 2.4, hl['ext_uln'], 0.35, key='ext_uln')
        mspindle(fr, 31.5, (-68, 0.6), (-8, 0.2), 3.2, hl['ext_dig'], 0.35, key='ext_dig')
        dorsum = [(0, 5.8), (8.0, 7.8), (20.0, 9.2), (22.8, 6.2), (23.8, 1.4), (23.2, -3.2), (21.4, -7.4), (17.0, -9.0), (6.0, -7.6), (0, -5.6)]
        shape(fr, 40, dorsum, PAL['near']['skin'], PAL['near']['skin_line'], 0.7, tag='hand', k=0.8)
        for nm in ('thumb', 'little', 'ring', 'index', 'middle'):
            finger(fr, 41 if nm != 'thumb' else 39, BASES[nm], TIPS[ph][nm], *W[nm])
        tc = HL['near']['p']['fill']
        for nm, y0 in (('index', 1.6), ('middle', 0.5), ('ring', -0.6), ('little', -1.7)):
            b, t = BASES[nm], TIPS[ph][nm]
            line(fr, 44, [(1.2, y0), b, lerp(b, t, 0.82)], tc, 0.9, extra=' stroke-opacity="0.85"')
        if ph == 0:
            band(fr, ellipse_pts((38.6, 1.0), 2.6, 5.8, 0, 12), 46, closed=True)
            arrow(fr, [(46.0, 5.0), (52.0, 14.0)])
            arrow(fr, [(44.0, -4.0), (50.0, -13.0)])
        else:
            cen = (32.0, 2.0)
            loop = []
            for nm in ('thumb', 'index', 'middle', 'ring', 'little'):
                pnt = lerp(BASES[nm], TIPS[ph][nm], 0.74)
                loop.append(add(pnt, mul(unit(sub(pnt, cen)), 2.6)))
            band(fr, loop, 46, closed=True)
        frames.append(fr)
    labels = [('ext_dig', 'Extenseur commun des doigts', 'p', 'L'), ('ext_rad', 'Extenseurs radiaux du poignet', 's', 'L'),
              ('ext_uln', 'Extenseur ulnaire du poignet', 's', 'L')]
    return dict(frames=frames, planche=1, labels=labels, wide=True, captions=['1 · Doigts réunis', '2 · Main ouverte'])
