"""Poses, matériel et étiquettes de chaque exercice. Lancer : python3 planches.py [id ...]"""
import os
import sys
from moteur import *
from vues import ex_rotation_externe, ex_extensions_doigts

SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'fiches', 'svg')


def grip_of(S, side):
    h = S['hand_' + side]
    return add(h['at'], mul(vdir(h['ang']), 4.2))


def shift_pose(p, delta):
    p['hip'] = add(p['hip'], delta)
    for side in ('near', 'far'):
        for part in ('arms', 'legs'):
            if 'target' in p[part][side]:
                p[part][side]['target'] = add(p[part][side]['target'], delta)
    return p


def put(p, getter, target):
    """Translate la pose pour que getter(S) tombe sur target (les cibles des bras et jambes ne bougent pas)."""
    S = build(p)
    d = sub(target, getter(S))
    p['hip'] = add(p['hip'], d)
    return p


def frame_of(p, hl, show_far_arm=True, show_far_leg=True):
    fr = Frame(hl)
    S = build(p)
    draw_figure(fr, S, show_far_arm, show_far_leg)
    return fr, S


def foot_low(S, side):
    f = S['foot_' + side]
    d = vdir(f['ang']); n = ccw(d)
    return min(add(f['at'], mul(d, x), mul(n, y))[1] for x, y in FOOT)


def solve_plank(arm_height, foot_back=100):
    """Corps gainé en ligne droite, pointes de pieds au sol : renvoie l'angle du tronc qui place
    les épaules à arm_height au-dessus du sol."""
    best = None
    for a10 in range(500, 900):
        a = a10 / 10
        p = standing()
        p['torso'] = a
        for side in ('near', 'far'):
            p['legs'][side] = dict(th=a + 180, sh=a + 180, ft=a + 180 - foot_back, off=(0, 0) if side == 'near' else (-1.2, 0.3))
        S = build(p)
        g = foot_low(S, 'near')
        hgt = S['shoulder'][1] - g
        if best is None or abs(hgt - arm_height) < best[0]:
            best = (abs(hgt - arm_height), a, g)
    return best[1], best[2]


# ======================================================================== Séance A
def ex_dev_militaire():
    hl = {'delt_ant': 'p', 'delt_mid': 'p', 'triceps': 'p', 'trap': 's', 'serratus': 's'}
    frames = []
    for ph in (0, 1):
        p = standing()
        p['legs']['near'].update(th=178, sh=182)
        p['legs']['far'].update(th=177, sh=182)
        for side, off in (('near', (0, 0)), ('far', (-1.8, 0.8))):
            if ph == 0:
                p['arms'][side] = dict(ua=166, sua=0.42, fa=6, sfa=0.98, hd=6, off=off)
            else:
                p['arms'][side] = dict(ua=5, fa=2, hd=2, off=off)
        fr, S = frame_of(p, hl)
        g = fr.low(['foot_near', 'foot_far'])
        floor(fr, g, -26, 34)
        dumbbell(fr, grip_of(S, 'far'), 90, Z['far_hand'] + 0.5)
        dumbbell(fr, grip_of(S, 'near'), 90, Z['near_hand'] + 0.5)
        if ph == 0:
            h = grip_of(S, 'near')
            arrow(fr, [add(h, (15, 2)), add(h, (15, 32))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('delt_ant', 'Deltoïde antérieur', 'p'), ('delt_mid', 'Deltoïde moyen', 'p'), ('triceps', 'Triceps brachial', 'p'),
        ('trap', 'Trapèze', 's'), ('serratus', 'Dentelé antérieur', 's')])


def ex_pompes():
    hl = {'pec': 'p', 'triceps': 'p', 'delt_ant': 's', 'serratus': 's', 'abs': 's'}
    frames = []
    for ph, (hgt, sua) in enumerate(((55.5, 1.0), (23.0, 0.82))):
        a, g = solve_plank(hgt)
        p = standing()
        p['torso'] = a
        p['head'] = -6
        for side in ('near', 'far'):
            p['legs'][side] = dict(th=a + 180, sh=a + 180, ft=a + 80, off=(0, 0) if side == 'near' else (-1.2, 0.3))
        S = build(p)
        sx = S['shoulder'][0]
        for side, dx in (('near', 1.5), ('far', 0.0)):
            p['arms'][side] = dict(target=(sx + dx, g + 2.4), sua=sua, bend='back', hd=90, grip='flat')
        fr, S = frame_of(p, hl)
        floor(fr, g, S['foot_near']['at'][0] - 12, sx + 30)
        t = S['torso']
        plate_pts = [t.pt(0.60, -11.6), t.pt(0.97, -11.6), t.pt(0.97, -14.6), t.pt(0.60, -14.6)]
        shape(fr, Z['front'], plate_pts, '#8d96a3', EQUIP['line'], 0.7, k=0.3)
        if ph == 0:
            c = t.pt(0.72, 14)
            arrow(fr, [add(c, (10, 4)), add(c, (10, -16))])
        else:
            c = t.pt(0.72, 14)
            arrow(fr, [add(c, (14, -6)), add(c, (14, 14))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('pec', 'Grand pectoral', 'p'), ('triceps', 'Triceps brachial', 'p'), ('delt_ant', 'Deltoïde antérieur', 's'),
        ('serratus', 'Dentelé antérieur', 's'), ('abs', "Grand droit de l'abdomen", 's')], wide=True)


def ex_y_sol():
    hl = {'trap': 'p', 'delt_post': 's'}
    frames = []
    for ph, ua in enumerate((97, 70)):
        p = standing()
        p['torso'] = 90
        p['head'] = 4
        for side in ('near', 'far'):
            p['legs'][side] = dict(th=270, sh=270, ft=258, off=(0, 0) if side == 'near' else (-1, 0.4))
        for side, off in (('near', (0, 0)), ('far', (-1, 0.6))):
            p['arms'][side] = dict(ua=ua - (6 if side == 'far' else 0), sua=0.86, fa=ua - (6 if side == 'far' else 0), sfa=0.9,
                                   hd=ua, grip='flat', off=off)
        fr, S = frame_of(p, hl)
        g = fr.low(['torso'])
        floor(fr, g, S['foot_near']['at'][0] - 10, grip_of(S, 'near')[0] + 16)
        h = S['head']
        towel = ellipse_pts(add(h.pt(14, 9.5), (0, -1.2)), 4.5, 2.2, 90, 10)
        shape(fr, Z['head'] - 1, towel, '#f8f8f6', '#9aa0a8', 0.5)
        if ph == 0:
            w = grip_of(S, 'near')
            arrow(fr, [add(w, (-6, 6)), add(w, (-2, 13)), add(w, (5, 17))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('trap', 'Trapèze (faisceaux moyen et inférieur)', 'p'), ('delt_post', 'Deltoïde postérieur', 's')], wide=True)


def hang_frame(p, hl, bar, z_bar=Z['near_hand'] + 1):
    p = put(p, lambda S: grip_of(S, 'near'), bar)
    fr, S = frame_of(p, hl)
    bar_end(fr, bar, z_bar, 2.3)
    fr.add(Z['far_arm'] - 2, f'<path d="M{P(bar)} L{P(add(bar, (0, 14)))}" stroke="{EQUIP["line"]}" stroke-width="2.4"/>', [add(bar, (0, 14))])
    return fr, S


def ex_front_lever():
    hl = {'lats': 'p', 'abs': 'p', 'delt_post': 's', 'triceps': 's'}
    bar = (0.0, 210.0)
    frames = []
    p = standing()
    for side, off in (('near', (0, 0)), ('far', (-1.2, 0.5))):
        p['arms'][side] = dict(ua=0, fa=0, hd=0, off=off)
    p['legs']['near'] = dict(th=176, sh=186, ft=128)
    p['legs']['far'] = dict(th=178, sh=188, ft=130, off=(-1.2, 0))
    fr, S = hang_frame(p, hl, bar)
    k = S['sh_near'].b
    arrow(fr, [add(k, (12, -4)), add(k, (24, 14)), add(k, (24, 34))])
    frames.append(fr)
    p = standing()
    p['torso'] = 272
    p['head'] = -4
    for side, off in (('near', (0, 0)), ('far', (-1.2, 0.5))):
        p['arms'][side] = dict(ua=12, fa=12, hd=12, off=off)
    p['legs']['near'] = dict(th=320, sh=95, ft=130)
    p['legs']['far'] = dict(th=322, sh=97, ft=132, off=(-1.2, 0.4))
    fr, S = hang_frame(p, hl, bar)
    frames.append(fr)
    return dict(frames=frames, planche=1, align='top', labels=[
        ('lats', 'Grand dorsal', 'p'), ('abs', "Grand droit de l'abdomen", 'p'), ('delt_post', 'Deltoïde postérieur', 's'),
        ('triceps', 'Triceps (longue portion)', 's')])


# ======================================================================== Séance B
def ex_split_squat():
    hl = {'quads': 'p', 'vastus': 'p', 'glute': 'p', 'hams': 's', 'glute_med': 's'}
    front, back = (27.0, 7.0), (-58.0, 46.0)
    frames = []
    for ph, (hip, lean) in enumerate((((0.0, 88.5), 4), ((-4.0, 51.0), 12))):
        p = standing()
        p['hip'] = hip
        p['torso'] = lean
        p['legs']['near'] = dict(target=front, bend='front', ft=90)
        p['legs']['far'] = dict(target=back, bend='low', ft=283)
        for side, off in (('near', (0, 0)), ('far', (-1.6, 0.6))):
            p['arms'][side] = dict(ua=181 - lean * 0.2, fa=181, off=off)
        fr, S = frame_of(p, hl)
        g = foot_low(S, 'near')
        floor(fr, g, -78, 50)
        top = foot_low(S, 'far')
        bench(fr, back[0] - 16, back[0] + 10, top, g)
        dumbbell(fr, grip_of(S, 'far'), 90, Z['far_hand'] + 0.5)
        dumbbell(fr, grip_of(S, 'near'), 90, Z['near_hand'] + 0.5)
        if ph == 0:
            arrow(fr, [add(hip, (-18, 6)), add(hip, (-18, -26))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('quads', 'Quadriceps', 'p'), ('glute', 'Grand fessier', 'p'), ('hams', 'Ischio-jambiers', 's'),
        ('glute_med', 'Moyen fessier', 's')])


def ex_pallof():
    hl = {'obliques': 'p', 'abs': 'p', 'glute_med': 's', 'delt_ant': 's', 'serratus': 's'}
    frames = []
    for ph in (0, 1):
        p = standing()
        p['hip'] = (0.0, 89.0)
        p['torso'] = 3
        p['legs']['near'] = dict(target=(5.0, 7.0), bend='front', ft=90)
        p['legs']['far'] = dict(target=(3.5, 7.0), bend='front', ft=90, off=(-1.5, 0))
        S = build(p)
        if ph == 0:
            tgt = S['torso'].pt(0.76, 15.0)
        else:
            tgt = add(S['shoulder'], (50.0, -6.0))
        p['arms']['near'] = dict(target=tgt, bend='low', hd=90)
        p['arms']['far'] = dict(target=add(tgt, (-1.2, 0.8)), bend='low', hd=90, off=(-1.5, 0.6))
        fr, S = frame_of(p, hl)
        g = fr.low(['foot_near', 'foot_far'])
        floor(fr, g, -26, 64)
        gr = grip_of(S, 'near')
        pul = (-36.0, gr[1] - 4)
        cable(fr, gr, pul, Z['front'])
        pulley(fr, pul, Z['front'] + 1, 5.5)
        text(fr, Z['front'] + 2, (pul[0], pul[1] - 14), 'poulie', 6.4, 'middle', '#4b5563')
        text(fr, Z['front'] + 2, (pul[0], pul[1] - 21), 'sur le côté', 6.4, 'middle', '#4b5563')
        if ph == 0:
            arrow(fr, [add(gr, (6, 9)), add(gr, (34, 9))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('obliques', 'Obliques', 'p'), ('abs', "Grand droit de l'abdomen", 'p'), ('glute_med', 'Moyen fessier', 's'),
        ('delt_ant', 'Deltoïde antérieur', 's'), ('serratus', 'Dentelé antérieur', 's')])


def ex_rdl():
    hl = {'hams': 'p', 'glute': 'p', 'erectors': 's', 'trap': 's', 'flex_av': 's'}
    frames = []
    for ph, (hip, lean) in enumerate((((0.0, 91.0), 2), ((-40.0, 76.0), 80))):
        p = standing()
        p['hip'] = hip
        p['torso'] = lean
        p['head'] = -lean * 0.25
        p['legs']['near'] = dict(target=(3.0, 7.0), bend='front', ft=90)
        p['legs']['far'] = dict(target=(1.5, 7.0), bend='front', ft=90, off=(-1.5, 0))
        for side, off in (('near', (0, 0)), ('far', (-1.5, 0.6))):
            p['arms'][side] = dict(ua=181, fa=181, off=off)
        fr, S = frame_of(p, hl)
        g = fr.low(['foot_near', 'foot_far'])
        floor(fr, g, -50, 40)
        plate(fr, grip_of(S, 'near'), 16.5, Z['front'])
        if ph == 0:
            arrow(fr, [add(hip, (-14, 2)), add(hip, (-24, -4)), add(hip, (-30, -14))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('hams', 'Ischio-jambiers', 'p'), ('glute', 'Grand fessier', 'p'), ('erectors', 'Érecteurs du rachis', 's'),
        ('trap', 'Trapèze', 's'), ('flex_av', 'Fléchisseurs des doigts (prise)', 's')])


def ex_dips():
    hl = {'triceps': 'p', 'pec': 'p', 'delt_ant': 's'}
    bar = (0.0, 120.0)
    frames = []
    for ph, (lean, sho) in enumerate(((10, (-3.0, 120.0 + 56.0)), (30, (23.0, 120.0 + 22.0)))):
        p = standing()
        p['torso'] = lean
        p['legs']['near'] = dict(th=186, sh=240, ft=175)
        p['legs']['far'] = dict(th=190, sh=246, ft=182, off=(-1.4, 0.4))
        p = put(p, lambda S: S['shoulder'], sho)
        wrist = add(bar, (0, 4.2))
        p['arms']['near'] = dict(target=wrist, bend='back', hd=180)
        p['arms']['far'] = dict(target=add(wrist, (-1.4, 0.6)), bend='back', hd=180, off=(-1.4, 0.6))
        fr, S = frame_of(p, hl)
        fr.add(Z['far_arm'] - 3, f'<path d="M{P((-46, bar[1]))} L{P((44, bar[1]))}" stroke="{EQUIP["dark"]}" stroke-width="2.6" stroke-linecap="round"/>'
                                 f'<path d="M{P((-40, bar[1]))} L{P((-40, bar[1] - 38))}" stroke="{EQUIP["line"]}" stroke-width="2.2"/>',
               [(-46, bar[1]), (44, bar[1] - 38)])
        if ph == 0:
            s = S['shoulder']
            arrow(fr, [add(s, (-16, 4)), add(s, (-16, -24))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('triceps', 'Triceps brachial', 'p'), ('pec', 'Grand pectoral (partie basse)', 'p'), ('delt_ant', 'Deltoïde antérieur', 's')])


def ex_nordique():
    hl = {'hams': 'p', 'gastro': 's', 'glute': 's'}
    knee = (0.0, 8.6)
    frames = []
    for ph, lean in enumerate((0, 58)):
        p = standing()
        p['hip'] = add(knee, mul(vdir(lean), 44))
        p['torso'] = lean
        p['head'] = -lean * 0.15
        p['legs']['near'] = dict(th=lean + 180, sh=270, ft=258)
        p['legs']['far'] = dict(th=lean + 180, sh=270, ft=258, off=(-1.2, 0.3))
        for side, off in (('near', (0, 0)), ('far', (-1.2, 0.6))):
            if ph == 0:
                p['arms'][side] = dict(ua=172, sua=0.75, fa=40, sfa=0.8, off=off)
            else:
                p['arms'][side] = dict(ua=128, fa=118, hd=118, grip='flat', off=off)
        fr, S = frame_of(p, hl)
        pad = [(-52, 0), (14, 0), (14, 3.2), (-52, 3.2)]
        shape(fr, 2, pad, '#7fb3c9', '#3e6f85', 0.6, k=0.2)
        floor(fr, 0, -60, 70)
        ank = S['sh_near'].b
        plate(fr, (ank[0] - 2, 14.5), 14.5, Z['front'])
        if ph == 0:
            h = S['head'].pt(10, 0)
            arrow(fr, [add(h, (8, 2)), add(h, (24, -8)), add(h, (34, -26))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('hams', 'Ischio-jambiers', 'p'), ('gastro', 'Gastrocnémien', 's'), ('glute', 'Grand fessier', 's')], wide=True)


def ex_rowing_inverse():
    hl = {'lats': 'p', 'trap': 'p', 'biceps': 's', 'delt_post': 's', 'brachialis': 's'}
    ankle = (0.0, 6.0)

    def pose_for(e):
        p = standing()
        p['torso'] = 270 + e
        p['head'] = 6
        d = (-math.cos(rad(e)), math.sin(rad(e)))
        p['hip'] = add(ankle, mul(d, 86.0))
        for side, off in (('near', (0, 0)), ('far', (1.2, 0.3))):
            p['legs'][side] = dict(th=90 + e, sh=90 + e, ft=12 + e, off=off)
        return p

    p0 = pose_for(13)
    S0 = build(p0)
    wrist0 = add(S0['shoulder'], (0.0, 53.0))
    bar = add(wrist0, (0, 4.2))
    best = None
    for e10 in range(140, 520):
        e = e10 / 10
        S = build(pose_for(e))
        chest = S['torso'].pt(0.74, 13.0)
        dd = length(sub(chest, bar))
        if best is None or dd < best[0]:
            best = (dd, e)
    frames = []
    for ph, e in enumerate((13, best[1])):
        p = pose_for(e)
        wrist = sub(bar, (0, 4.2))
        p['arms']['near'] = dict(target=wrist, bend='low', hd=0, sua=0.9)
        p['arms']['far'] = dict(target=add(wrist, (1.2, 0.4)), bend='low', hd=0, sua=0.9, off=(1.2, 0.4))
        fr, S = frame_of(p, hl)
        g = foot_low(S, 'near')
        floor(fr, g, bar[0] - 30, 30)
        bar_end(fr, bar, Z['near_hand'] + 1, 2.3)
        fr.add(Z['far_arm'] - 3, f'<path d="M{P((bar[0] - 7, g))} L{P((bar[0] - 7, bar[1] + 22))}" stroke="{EQUIP["line"]}" stroke-width="2.6"/>',
               [(bar[0] - 7, bar[1] + 22)])
        if ph == 0:
            c = S['torso'].pt(0.74, 16)
            arrow(fr, [add(c, (6, 2)), add(c, (4, 22))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('lats', 'Grand dorsal', 'p'), ('trap', 'Trapèze (faisceau moyen)', 'p'), ('biceps', 'Biceps brachial', 's'),
        ('delt_post', 'Deltoïde postérieur', 's'), ('brachialis', 'Brachial', 's')], wide=True)


def ex_curl_inverse():
    hl = {'brachiorad': 'p', 'brachialis': 'p', 'biceps': 's', 'ext_av': 's'}
    frames = []
    for ph in (0, 1):
        p = standing()
        for side, off in (('near', (0, 0)), ('far', (-1.6, 0.6))):
            if ph == 0:
                p['arms'][side] = dict(ua=181, fa=184, hd=186, off=off)
            else:
                p['arms'][side] = dict(ua=176, fa=48, hd=58, off=off)
        fr, S = frame_of(p, hl)
        g = fr.low(['foot_near', 'foot_far'])
        floor(fr, g, -26, 40)
        gr = grip_of(S, 'near')
        circle(fr, Z['near_hand'] + 1, gr, 7.5, '#8d96a3', EQUIP['line'], 0.7, 0.55)
        bar_end(fr, gr, Z['near_hand'] + 1.2, 1.6)
        if ph == 0:
            e = S['fa_near'].a
            arrow(fr, [add(gr, (9, 0)), add(gr, (17, 13)), add(gr, (14, 28))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('brachiorad', 'Brachio-radial', 'p'), ('brachialis', 'Brachial', 'p'), ('biceps', 'Biceps brachial', 's'),
        ('ext_av', 'Extenseurs du poignet', 's')])


# ======================================================================== autres exercices
def ex_tractions():
    hl = {'lats': 'p', 'biceps': 'p', 'brachialis': 's', 'brachiorad': 's', 'trap': 's', 'delt_post': 's', 'flex_av': 's'}
    bar = (0.0, 210.0)
    frames = []
    p = standing()
    for side, off in (('near', (0, 0)), ('far', (-1.2, 0.5))):
        p['arms'][side] = dict(ua=0, fa=0, hd=0, off=off)
    p['legs']['near'] = dict(th=172, sh=206, ft=146)
    p['legs']['far'] = dict(th=170, sh=212, ft=152, off=(-1.2, 0))
    fr, S = hang_frame(p, hl, bar)
    s = S['shoulder']
    arrow(fr, [add(s, (-20, -6)), add(s, (-20, 22))])
    frames.append(fr)
    p = standing()
    p['torso'] = -6
    p['legs']['near'] = dict(th=170, sh=206, ft=146)
    p['legs']['far'] = dict(th=168, sh=212, ft=152, off=(-1.2, 0))
    p = put(p, lambda S: S['shoulder'], add(bar, (-10.0, -7.5)))
    wrist = sub(bar, (0, 4.2))
    p['arms']['near'] = dict(target=wrist, bend='front', sua=0.8, hd=0)
    p['arms']['far'] = dict(target=add(wrist, (-1.2, 0.5)), bend='front', sua=0.8, hd=0, off=(-1.2, 0.5))
    fr, S = frame_of(p, hl)
    bar_end(fr, bar, Z['near_hand'] + 1, 2.3)
    fr.add(Z['far_arm'] - 2, f'<path d="M{P(bar)} L{P(add(bar, (0, 14)))}" stroke="{EQUIP["line"]}" stroke-width="2.4"/>', [add(bar, (0, 14))])
    frames.append(fr)
    return dict(frames=frames, planche=1, align='top', labels=[
        ('lats', 'Grand dorsal', 'p'), ('biceps', 'Biceps brachial', 'p'), ('brachialis', 'Brachial', 's'),
        ('trap', 'Trapèze', 's'), ('delt_post', 'Deltoïde postérieur', 's'), ('flex_av', 'Fléchisseurs des doigts', 's')])


def ex_face_pull():
    hl = {'delt_post': 'p', 'trap': 'p', 'delt_mid': 's', 'brachiorad': 's'}
    pul = (66.0, 162.0)
    frames = []
    for ph in (0, 1):
        p = standing()
        p['torso'] = -3
        p['legs']['near'] = dict(th=168, sh=181, ft=90)
        p['legs']['far'] = dict(th=196, sh=192, ft=96, off=(-1.4, 0))
        S = build(p)
        s = S['shoulder']
        if ph == 0:
            tgt = add(s, mul(unit(sub(pul, s)), 50))
            for side, off in (('near', (0, 0)), ('far', (-1.4, 0.6))):
                p['arms'][side] = dict(target=add(tgt, off), bend='low', off=off)
        else:
            for side, off in (('near', (0, 0)), ('far', (-1.4, 0.6))):
                p['arms'][side] = dict(ua=262, sua=0.32, fa=8, hd=8, off=off)
        fr, S = frame_of(p, hl)
        g = fr.low(['foot_near', 'foot_far'])
        floor(fr, g, -36, pul[0] + 10)
        gr = grip_of(S, 'near')
        cable(fr, gr, pul, Z['far_arm'] - 1)
        pulley(fr, pul, Z['far_arm'] - 1, 4.5)
        fr.add(1, f'<path d="M{P((pul[0] + 6, g))} L{P((pul[0] + 6, pul[1] + 12))}" stroke="{EQUIP["line"]}" stroke-width="2.6"/>', [(pul[0] + 6, pul[1] + 12)])
        if ph == 0:
            arrow(fr, [add(gr, (-4, 10)), add(gr, (-26, 12))])
        frames.append(fr)
    return dict(frames=frames, planche=1, labels=[
        ('delt_post', 'Deltoïde postérieur', 'p'), ('trap', 'Trapèze (moyen et inférieur)', 'p'), ('delt_mid', 'Deltoïde moyen', 's')])


def ex_releves():
    hl = {'abs': 'p', 'obliques': 's', 'quads': 's', 'flex_av': 's'}
    bar = (0.0, 210.0)
    frames = []
    for ph in (0, 1):
        p = standing()
        p['torso'] = 0 if ph == 0 else -8
        for side, off in (('near', (0, 0)), ('far', (-1.2, 0.5))):
            p['arms'][side] = dict(ua=0 if ph == 0 else 4, fa=0 if ph == 0 else 4, hd=0, off=off)
        if ph == 0:
            p['legs']['near'] = dict(th=180, sh=180, ft=128)
            p['legs']['far'] = dict(th=181, sh=181, ft=130, off=(-1.2, 0))
        else:
            p['legs']['near'] = dict(th=88, sh=88, ft=40)
            p['legs']['far'] = dict(th=89, sh=89, ft=42, off=(-1.2, 0.4))
        fr, S = hang_frame(p, hl, bar)
        if ph == 0:
            a = S['foot_near']['at']
            arrow(fr, [add(a, (12, 4)), add(a, (40, 22)), add(a, (54, 52))])
        frames.append(fr)
    return dict(frames=frames, planche=1, align='top', labels=[
        ('abs', "Grand droit de l'abdomen", 'p'), ('obliques', 'Obliques', 's'), ('quads', 'Droit fémoral (quadriceps)', 's'),
        ('flex_av', 'Fléchisseurs des doigts', 's')])


def ex_gainage():
    hl = {'abs': 'p', 'obliques': 's', 'glute': 's', 'quads': 's', 'delt_ant': 's'}
    a, g = solve_plank(32.5)
    p = standing()
    p['torso'] = a
    p['head'] = -4
    for side in ('near', 'far'):
        p['legs'][side] = dict(th=a + 180, sh=a + 180, ft=a + 80, off=(0, 0) if side == 'near' else (-1.2, 0.3))
    for side, off in (('near', (0, 0)), ('far', (-1.0, 0.4))):
        p['arms'][side] = dict(ua=181, sua=1.0, fa=90, hd=90, off=off)
    fr, S = frame_of(p, hl)
    floor(fr, g, S['foot_near']['at'][0] - 12, grip_of(S, 'near')[0] + 14)
    return dict(frames=[fr], planche=0, captions=['Position à tenir'], labels=[
        ('abs', "Grand droit de l'abdomen", 'p'), ('obliques', 'Obliques', 's'), ('glute', 'Grand fessier', 's'),
        ('quads', 'Quadriceps', 's'), ('delt_ant', 'Deltoïde antérieur', 's')], wide=True)


def ex_poutre():
    hl = {'flex_av': 'p', 'brachiorad': 's', 'lats': 's'}
    edge = (0.0, 214.0)
    frames = []
    for ph in (0, 1):
        p = standing()
        for side, off in (('near', (0, 0)), ('far', (-1.2, 0.5))):
            p['arms'][side] = dict(ua=356, fa=6, hd=8, grip='crimp' if ph == 0 else 'open', off=off)
        if ph == 0:
            p['legs']['near'] = dict(th=170, sh=208, ft=148)
            p['legs']['far'] = dict(th=168, sh=214, ft=154, off=(-1.2, 0))
            p = put(p, lambda S: S['hand_near']['at'], add(edge, (-1.0, -9.0)))
        else:
            p['arms']['near'].update(ua=358, fa=2)
            p['arms']['far'].update(ua=360, fa=4)
            p = put(p, lambda S: foot_low(S, 'near') and (S['foot_near']['at'][0], foot_low(S, 'near')), (0.0, 0.0))
        fr, S = frame_of(p, hl)
        board = [(edge[0] - 4, edge[1]), (edge[0] + 14, edge[1]), (edge[0] + 14, edge[1] + 12), (edge[0] - 4, edge[1] + 12)]
        shape(fr, Z['far_arm'] - 3, board, '#c8a982', '#6b5640', 0.7, k=0.2)
        fr.add(Z['far_arm'] - 3, f'<path d="M{P((edge[0] + 14, edge[1] - 6))} L{P((edge[0] + 14, edge[1] + 22))}" stroke="#8b8f97" stroke-width="2"/>',
               [(edge[0] + 14, edge[1] + 22)])
        if ph == 1:
            floor(fr, 0.0, -30, 40)
        frames.append(fr)
    return dict(frames=frames, planche=0, align='top', captions=['Suspension 7 s', 'Pause 3 s'], labels=[
        ('flex_av', 'Fléchisseurs des doigts', 'p'), ('brachiorad', 'Brachio-radial', 's'), ('lats', 'Grand dorsal', 's')])


EXOS = {
    'dev-militaire': ex_dev_militaire, 'pompes-lestees': ex_pompes, 'y-sol': ex_y_sol, 'front-lever-groupe': ex_front_lever,
    'split-squat': ex_split_squat, 'pallof': ex_pallof, 'rdl': ex_rdl, 'dips': ex_dips, 'leg-curl-nordique': ex_nordique,
    'rowing-inverse': ex_rowing_inverse, 'curl-inverse': ex_curl_inverse, 'tractions': ex_tractions, 'face-pull': ex_face_pull,
    'releves-jambes': ex_releves, 'gainage-planche': ex_gainage, 'poutre-repeaters': ex_poutre,
    'rotation-externe': ex_rotation_externe, 'extensions-doigts': ex_extensions_doigts,
}


def generate(eid):
    spec = EXOS[eid]()
    frames = spec['frames']
    caps = spec.get('captions') or ['1 · Départ', '2 · Arrivée']
    # planche : le cadre choisi, redessiné avec les étiquettes
    spec2 = EXOS[eid]()
    pl = spec2.get('planche_frame') or spec2['frames'][spec2['planche']]
    x0, y0, x1, y1 = pl.bbox()
    if spec2.get('wide') or (x1 - x0) / (y1 - y0) > 0.6:
        labels_legend(pl, spec2['labels'])
    else:
        labels_layout(pl, spec2['labels'])
    os.makedirs(SORTIE, exist_ok=True)
    open(os.path.join(SORTIE, f'{eid}-planche.svg'), 'w').write(render_svg([pl]))
    layout = 'col' if spec.get('wide') else 'row'
    open(os.path.join(SORTIE, f'{eid}-mouvement.svg'), 'w').write(render_svg(frames, captions=caps[:len(frames)], layout=layout, align=spec.get('align', 'bottom')))


if __name__ == '__main__':
    ids = sys.argv[1:] or list(EXOS)
    for eid in ids:
        generate(eid)
        print('ok', eid)
