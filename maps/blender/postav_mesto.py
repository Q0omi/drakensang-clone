# =====================================================================================
#  MESTO – Útočisko Draheim (nová mapa podľa referencie)
#  Spustenie v Blenderi: Scripting → Open → tento súbor → Run Script.
#  Postaví mapu, uloží maps\blend\mesto.blend a exportuje maps\mesto.glb.
#
#  Zásady: budovy, trh a brána tvoria OKRAJ mapy (fasádami dnu) – nedá sa zájsť za ne.
#  Juh je otvorený (nízky múrik + výhľad dolu), takže nič nezakrýva postavu.
# =====================================================================================
import os
ROOT = globals().get('ROOT') or r'A:\drake clone\maps'
for _f in ('blib2.py', 'blib2_mesto.py'):
    exec(compile(open(os.path.join(ROOT, 'blender', _f), encoding='utf-8').read(), _f, 'exec'), globals())
PREVIEW = globals().get('PREVIEW', True); EXPORT = globals().get('EXPORT', True)

reset_scene(); init_materials()
R = random.Random(777); rr = lambda a, b: a + R.random() * (b - a)
C_ASSET = collection('assets (zdroje)', True); C_ENV = collection('Mesto'); C_MARK = collection('znacky (hra)')

# ---------------------------------------------------------------- pochôdzna plocha (námestie + predpolie radnice + vyhliadková terasa)
A = Areas().rect(-23.0, 23.0, -18.0, 16.5).rect(-8.5, 8.5, -19.4, -18.0).circle(0.0, 15.5, 8.5)
A.bake(pad=60.0, step=0.5); VIEW = View(A)
LOBBY = [(-3.4, -12.6), (0.0, -13.2), (3.4, -12.6)]; SPAWN = (0.0, 12.0); FOUNT = (0.0, 2.5); WAYP = (10.3, -18.3); MERCH = (-21.9, -8.0)

# ---------------------------------------------------------------- terén: dlažba na námestí, tráva za domami, na juhu zráz
def ground_h(x, z):
    d = A.sdf(x, z)
    if d <= 0.6: return 0.0
    e = 0.6; gz = (A.sdf(x, z + e) - A.sdf(x, z - e)) / (2 * e)          # >0 = bod je južne od plochy
    south = sstep(0.15, 0.75, gz)
    up = min(3.0, (d - 0.6) * 0.07) + 0.5 * noise.noise(Vector((x * 0.05, z * 0.05, 0.3))) * sstep(4, 16, d)
    down = -6.2 * sstep(0.9, 5.5, d) - 0.03 * d
    return up * (1 - south) + down * south
def ground_c(x, z, y):
    d = A.sdf(x, z); n = noise.noise(Vector((x * 0.085, z * 0.085, 4.2))); n2 = noise.noise(Vector((x * 0.23, z * 0.23, 9.1)))
    shade = sstep(0.05, 0.45, n) * 0.55                                   # maľované fľaky svetla a tieňa
    c = lerp3((1.0, 0.96, 0.86), (0.60, 0.69, 0.74), shade)
    edge = sstep(-3.5, 0.5, d) * 0.28                                     # pri stenách tmavšie a machovejšie
    c = lerp3(c, (0.55, 0.66, 0.50), edge); k = 0.94 + 0.08 * n2
    if d > 2.5: c = lerp3((0.95, 1.0, 0.82), (0.55, 0.72, 0.66), sstep(0.0, 0.5, n) * 0.6); k *= 1.0 - 0.25 * sstep(0, 7, -y)
    return (c[0] * k, c[1] * k, c[2] * k)
terrain('ground', -74, 74, -70, 58, 1.0, ground_h, ground_c, lambda x, z: 0 if A.sdf(x, z) < 2.6 else 1, [MAT['cobble']['mat'], MAT['grass']['mat']], C_ENV)

# ---------------------------------------------------------------- assety
HALL = town_hall(); TAVERN = house(11, 12.0, 8.0, 2, roof_h=4.2, sign=True, porch=True, name='tavern'); SMITHY = smithy(); GATE = gatehouse()
H_C1 = house(21, 7.0, 6.5, 2, ridge='y', roof_h=3.8); H_C2 = house(22, 7.5, 6.5, 2, roof_h=3.6)
H_W1 = house(23, 8.0, 6.5, 2, roof_h=3.6, ridge='y'); H_W2 = house(24, 7.5, 6.5, 3, roof_h=3.4, fh=2.6); H_W3 = house(25, 11.0, 7.0, 2, roof_h=4.0, porch=True)
H_E1 = house(26, 9.0, 7.0, 2, roof_h=3.8, sign=True); H_E2 = house(27, 8.0, 6.5, 2, roof_h=3.5, ridge='y', porch=True)
H_LOW = [house(31 + i, 6.5 + i, 5.5, 1, roof_h=3.2, door=False, boxes=False) for i in range(2)]; H_BACK = [house(41 + i, 7.0 + i * 1.5, 6.0, 2, roof_h=3.6, ridge='xy'[i % 2], boxes=False) for i in range(3)]
STALLS = [stall(51 + i, c) for i, c in enumerate(('red', 'blue', 'green'))]
FOUNTAIN = fountain(); WAYPOINT, CRYSTAL = waypoint(); PED = pedestal(); PARAPET = parapet(0); PARAPET_E = parapet(1, post=False); WELL = well(); BOARD = notice_board()
BARREL = barrel(); CRATE = crate(); STACK = crate_stack(1); CART = cart(1); WAGON = cart(2, cover=True); BENCH = bench(); TABLE = table(); HAY = haystack(1); LAMP = lamp_post(); POLE = banner_pole(); FENCE = fence(1)
TREES = [tree(101, 12.5, 4.6, 0.6, 8), tree(102, 10.5, 4.0, 0.5, 7, lit=(1.0, 0.95, 0.62)), tree(103, 9.0, 3.4, 0.42, 6), tree(104, 11.5, 4.2, 0.55, 7, leaf='leafg', lit=(1.0, 0.96, 0.8))]
BUSHES = [bush(111), bush(112, 0.8), bush(113, 1.0, flowers=True)]; ROCKS = [boulder(121), boulder(122)]
PL_GRASS = [plant(131 + i, 'grass', 0.9, 0.6) for i in range(2)]; PL_FLOWER = plant(141, 'flower', 0.8, 0.65, 2); PL_FERN = plant(142, 'fern', 1.1, 0.7, 2)
PUMPKINS = [pumpkin(151), pumpkin(152, 0.8)]

def torch(x, z, y, color=0xffb060, inten=26, flame=0.0, **kw): marker('TORCH', P(x, z, y), C_MARK, color=color, int=inten, **({'flame': flame} if flame else {}), **kw)
def lamp(x, z, rot=0.0):
    put(LAMP, x, z, rot, check=False); torch(x + math.cos(rot) * 0.7, z - math.sin(rot) * 0.7, 2.75, flame=0.5)

# ---------------------------------------------------------------- SEVER: radnica, hostinec, kováčska dielňa, rohové domy
put(HALL, 0, -22.0, 0, box=True, force=True)
put(TAVERN, -17.0, -19.6, 0, box=True, force=True); put(SMITHY, 17.0, -19.6, 0, box=True, force=True)
put(H_C1, -28.6, -18.8, 0, box=True, force=True); put(H_C2, 28.4, -18.8, 0, box=True, force=True)
fx, fy, fz = SMITHY['v_forge']; torch(17.0 + fx, -19.6 - fy, fz, 0xff6a1a, 42, 1.3)
for k, (x, z, c) in enumerate(((-9.9, -20.4, 0xffb060), (9.9, -20.4, 0xffb060))): torch(x, z, 3.0, c, 24)
# ---------------------------------------------------------------- ZÁPAD: trh (stánky čelom na východ) pred radom domov
put(H_W1, -27.0, -12.4, math.pi / 2, box=True, force=True); put(H_W2, -27.0, -4.4, math.pi / 2, box=True, force=True); put(H_W3, -24.9, 7.4, math.pi / 2, box=True, force=True)
for i, z in enumerate((-13.6, -8.0, -2.4)): put(STALLS[i], -24.4, z, math.pi / 2, box=True, force=True)
# ---------------------------------------------------------------- VÝCHOD: dom, zatvorená brána s vežami, dom
put(H_E1, 24.9, -12.4, -math.pi / 2, box=True, force=True); put(GATE, 25.5, 0.0, -math.pi / 2, box=True, force=True); put(H_E2, 24.9, 11.6, -math.pi / 2, box=True, force=True)
for s in (-1, 1): torch(23.6, s * 4.4, 3.2, 0xffb060, 26, 0.6)
# druhý rad (kulisa za domami) – len na severe/západe/východe
for (hh, x, z, rot) in ((H_BACK[0], -36.5, -30.5, 0.25), (H_BACK[1], -14, -36.5, 0.0), (H_BACK[2], 15, -37.5, -0.1), (H_BACK[0], 37, -27, -0.3), (H_BACK[1], -38, -6, math.pi / 2), (H_BACK[2], 38.5, 12, -math.pi / 2), (H_BACK[1], 38, -9, -math.pi / 2), (H_BACK[0], -37, 14, math.pi / 2)):
    put(hh, x, z, rot, check=False, col='none', y=ground_h(x, z) - 0.3); BLOCKS.append((x - 6, x + 6, z - 6, z + 6))
# ---------------------------------------------------------------- JUH: múrik s lampami okolo terasy, dolu strechy a koruny stromov
def parapet_run(pts):
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        L = math.hypot(bx - ax, bz - az); n = max(1, round(L / 3.0)); a = math.atan2(-(bz - az), bx - ax)
        for k in range(n):
            t = (k + 0.5) / n; put(PARAPET, ax + (bx - ax) * t, az + (bz - az) * t, a, (L / n / 3.0, 1, 1), check=False)
arc = [(0 + math.sin(t) * 9.2, 15.5 + math.cos(t) * 9.2) for t in [(-1.385 + i * (2.77 / 10)) for i in range(11)]]     # oblúk terasy (od západu po východ)
arc = arc[::-1] if arc[0][0] > arc[-1][0] else arc
parapet_run([(-23.7, 13.6), (-23.7, 17.2), (arc[0][0], 17.2)]); parapet_run(arc); parapet_run([(arc[-1][0], 17.2), (23.7, 17.2), (23.7, 15.2)])
for i in (0, 3, 7, 10): lamp(arc[i][0] * 1.0, arc[i][1] + 0.0, math.pi / 2 if i < 5 else math.pi / 2)
lamp(-23.4, 17.0, 0.6); lamp(23.4, 17.0, 2.5)
for (hh, x, z, rot) in ((H_LOW[0], -16.0, 24.4, 0.12), (H_LOW[1], 17.5, 24.8, -0.15), (H_LOW[0], 1.5, 32.2, 0.05)):
    put(hh, x, z, rot, check=False, col='none', y=-6.5); BLOCKS.append((x - 5, x + 5, z - 1, z + 8))

# ---------------------------------------------------------------- námestie: fontána, teleportný kameň, podstavce hrdinov
put(FOUNTAIN, FOUNT[0], FOUNT[1], 0.2, force=True); marker('FOUNTAIN', P(FOUNT[0], FOUNT[1], 2.55), C_MARK)
put(WAYPOINT, WAYP[0], WAYP[1], 0.0, force=True); instance(CRYSTAL, 'waypoint_crystal', P(WAYP[0], WAYP[1], 4.5), 0, 1, C_ENV)
torch(WAYP[0], WAYP[1] + 0.6, 2.6, 0x5ab0ff, 45, steady=1)
for (x, z) in LOBBY: put(PED, x, z, 0.0, check=False)
# rekvizity – vysoké veci len tesne pri severnom okraji, stred námestia ostáva voľný
put(WAGON, -20.6, -16.6, 0.12, box=True, force=True); put(CART, 16.4, -16.9, math.pi + 0.1, box=True, force=True)
put(BOARD, -9.6, -18.9, 0.25, box=True, force=True); put(STACK, 21.6, -17.2, 0.6, check=False); put(HAY, -11.4, -19.4, 0, force=True)
for (x, z, rot) in ((-13.5, -15.6, 0.1), (-16.8, -14.9, -0.15)):
    put(TABLE, x, z, rot, check=False)
    for s in (-1, 1): put(BENCH, x - math.sin(rot) * s * 0.95, z - math.cos(rot) * s * 0.95, rot, check=False)
for (x, z) in ((-22.3, -16.9), (-12.0, -17.6), (22.4, -8.2), (22.3, 7.2), (-22.4, 13.4), (11.9, -16.9), (22.5, -16.3), (-22.5, 0.9)): put(BARREL, x, z, rr(0, TAU), rr(0.9, 1.05), check=False)
for (x, z) in ((22.2, -9.3), (22.4, 8.3), (-22.2, 14.4), (21.7, 15.2), (-21.6, 1.9), (13.0, -17.4)): put(CRATE, x, z, rr(0, TAU), rr(0.85, 1.1), check=False)
for (x, z, rot) in ((-6.5, 20.9, 0.9), (6.5, 20.9, -0.9), (0.0, 23.3, 0.0), (-15.0, 15.9, 0.0), (15.0, 15.9, 0.0)): put(BENCH, x, z, rot, check=False)
for (x, z, s) in ((-21.9, 2.9, 1.0), (-22.3, 3.6, 0.8), (-21.4, 3.7, 0.7), (22.0, 14.3, 0.9)): put(PUMPKINS[int(s * 10) % 2], x, z, rr(0, TAU), s, check=False)
# zeleň pri fasádach a múriku (nízka) + stromy za domami (vysoké, mimo výhľadu)
for i in range(70):
    a = rr(0, TAU); x, z = rr(-24.5, 24.5), rr(-19.5, 24.5); d = A.sdf(x, z)
    if -1.1 < d < 0.5 and not (abs(x) < 9 and z < -17): put(R.choice(BUSHES), x, z, rr(0, TAU), rr(0.45, 0.8), check=False)
S = Scatter(4.0); placed_t = 0
for i in range(900):
    x, z = rr(-70, 70), rr(-66, 54); d = A.sdf(x, z)
    if d < 6.5 or d > 44 or blocked(x, z, 2.2): continue
    y = ground_h(x, z); src = R.choice(TREES); s = rr(0.85, 1.25)
    if not S.free(x, z, 5.2): continue
    if put(src, x, z, rr(0, TAU), s, y=y - 0.25, col='none') is not None: S.add(x, z); placed_t += 1
for i in range(500):
    x, z = rr(-60, 60), rr(-60, 50); d = A.sdf(x, z)
    if d < 3.0 or d > 34 or blocked(x, z, 0.6): continue
    y = ground_h(x, z)
    if S.free(x, z, 2.2):
        src = R.choice(BUSHES + ROCKS[:1]); put(src, x, z, rr(0, TAU), rr(0.8, 1.6), y=y - 0.1, check=(y > -1.0)); S.add(x, z)
for i in range(900):
    x, z = rr(-55, 55), rr(-55, 46); d = A.sdf(x, z)
    if d < 2.8 or d > 26 or blocked(x, z, 0.2): continue
    put(R.choice(PL_GRASS + PL_GRASS + [PL_FLOWER, PL_FERN]), x, z, rr(0, TAU), rr(0.8, 1.5), y=ground_h(x, z), check=False)
# nálepky: tráva vyrastajúca z dlažby pri okrajoch, hlina pri trhu a kováčovi
for i in range(46):
    x, z = rr(-23.5, 23.5), rr(-19, 24); d = A.sdf(x, z)
    if -2.6 < d < 0.2: decal('dgrass', x, z, rr(2.2, 4.2), C_ENV, 0.025 + (i % 5) * 0.003)
for (x, z, s) in ((-21.5, -8, 6.5), (-21.2, -13.5, 5.5), (-21.4, -2.5, 5.5), (16.5, -16.5, 7.5), (-15, -15.5, 7), (21.5, 0, 6)): decal('ddirt', x, z, s, C_ENV, 0.02)
for (x, z) in ((-30, -32), (31, -31), (-34, 2), (34, 3)): sunbeam(x, z, C_ENV, 14, 2.6, (0.55, 0.28), 0.8)

# ---------------------------------------------------------------- značky pre hru
A.markers(C_MARK)
marker('SPAWN', P(*SPAWN), C_MARK); marker('SHOW', P(0, -12.8), C_MARK); marker('WAYPOINT', P(*WAYP), C_MARK); marker('MERCHANT', P(*MERCH), C_MARK, rot=math.pi / 2)
for i, (x, z) in enumerate(LOBBY): marker('LOBBY', P(x, z, 0.36), C_MARK, slot=i)

OUT = {'stats': stats(), 'trees': placed_t, 'view_warn': VIEW.warn[:40]}
if PREVIEW:
    setup_preview((20, 30, 10), (1.0, 0.86, 0.66), 4.2, (0.40, 0.62, 0.64), 1.0); pv = os.path.join(ROOT, 'blend', 'preview')
    for nm, (tx, tz, dist) in {'mesto_1_radnica': (0, -10, 26), 'mesto_2_trh': (-13, -7, 26), 'mesto_3_brana': (13, -2, 26), 'mesto_4_terasa': (0, 13, 26), 'mesto_5_sever': (-12, -14, 26)}.items(): render(os.path.join(pv, nm + '.jpg'), tx, tz, dist)
    render_top(os.path.join(pv, 'mesto_top.jpg'), -48, 48, -46, 40)
if EXPORT:
    os.makedirs(os.path.join(ROOT, 'blend'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'blend', 'mesto.blend'))
    export_glb(os.path.join(ROOT, 'mesto.glb')); OUT['glb_mb'] = round(os.path.getsize(os.path.join(ROOT, 'mesto.glb')) / 1e6, 1)
result = OUT
