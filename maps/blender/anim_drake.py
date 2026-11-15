# =====================================================================================
#  Kroniky Popola – nové útočné animácie pre ohnivého draka (boss) a malých drakov
#  Pôvodné Attack1 / Spell1 v modeli sú poškodené (drak sa zmenší a otočí), preto tu
#  vznikajú nové akcie nad kostrou modelu:
#    Boss_Bite, Boss_TailSwipe, Boss_Breath, Boss_Roar, Boss_Slam
#  Póza vychádza z animácie SRU_dragon_idle_aggro1 a pridáva rotácie kostí v priestore
#  armatúry (krk, hlava, čeľusť, chrbtica, chvost, krídla, koreň).
#  Premenné SRC (vstupný .glb) a DST (výstupný .glb) nastaví volajúci skript.
# =====================================================================================
import bpy, math
from mathutils import Vector, Matrix, Quaternion

FPS = 30

def clear():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            try: coll.remove(d)
            except Exception: pass

def find_action(name):
    for a in bpy.data.actions:
        if a.name == name or a.name.startswith(name): return a
    return None

def smooth(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)

def sample_keys(keys, t):
    """keys: list of (time, value); smooth interpolation"""
    if t <= keys[0][0]: return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1: return v0 + (v1 - v0) * smooth((t - t0) / max(1e-6, t1 - t0))
    return keys[-1][1]

def build(SRC, DST, scale_hint=1.0):
    clear()
    bpy.ops.import_scene.gltf(filepath=SRC)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    base = find_action('SRU_dragon_idle_aggro1')
    if base is None: raise RuntimeError('idle action not found: ' + ', '.join(a.name for a in bpy.data.actions))
    for a in bpy.data.actions: a.use_fake_user = True
    arm.animation_data_create()
    pbs = arm.pose.bones
    order = [pb for pb in pbs]                       # pose.bones is parent-first
    sc = bpy.context.scene; sc.render.fps = FPS

    # --- read the idle pose (local channels) per frame
    def pose_from(action, frame):
        arm.animation_data.action = action
        if hasattr(arm.animation_data, 'action_slot') and action.slots: arm.animation_data.action_slot = action.slots[0]
        sc.frame_set(int(frame)); bpy.context.view_layer.update()
        return {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy()) for pb in pbs}
    idle_len = int(base.frame_range[1] - base.frame_range[0]) or 60
    idle0 = pose_from(base, base.frame_range[0])
    # body axes in armature space
    bpy.context.view_layer.update()
    head = pbs['Head'].head.copy(); tail = pbs['Tail2'].head.copy()
    F = Vector((head.x - tail.x, head.y - tail.y, 0)).normalized(); U = Vector((0, 0, 1)); Lat = F.cross(U).normalized()
    UNIT = (head - tail).length / 2.2      # model units per in-game 'dragon metre' (head→tail ≈ 2.2 in bind scale)
    print('forward', F, 'lateral', Lat, 'unit', UNIT, 'arm scale', tuple(arm.matrix_world.to_scale()))

    def rot_about(axis, deg): return Matrix.Rotation(math.radians(deg), 4, axis)

    def make(name, dur, tracks):
        """tracks: {bone: [(axis, keys)]} – angles in degrees, moves (move_f / move_u) in model units.
        Poses are computed with NO action assigned (so the depsgraph cannot overwrite them), then keyed."""
        n = int(round(dur * FPS)); frames = []
        for f in range(0, n + 1):
            t = f / FPS
            P = pose_from(base, base.frame_range[0] + (f % idle_len))
            arm.animation_data.action = None
            for pb in pbs:
                l, r, s_ = P[pb.name]; pb.location = l; pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = r; pb.scale = s_
            bpy.context.view_layer.update()
            for pb in order:
                ops = tracks.get(pb.name)
                if not ops: continue
                M = pb.matrix.copy(); h = M.to_translation()
                for (ax, keys) in ops:
                    v = sample_keys(keys, t)
                    if abs(v) < 1e-6: continue
                    if ax == 'move_f': M = Matrix.Translation(F * v * UNIT) @ M
                    elif ax == 'move_u': M = Matrix.Translation(U * v * UNIT) @ M
                    else:
                        axis = {'pitch': Lat, 'yaw': U, 'roll': F}[ax]
                        M = Matrix.Translation(h) @ rot_about(axis, v) @ Matrix.Translation(-h) @ M
                pb.matrix = M
                bpy.context.view_layer.update()
            frames.append({pb.name: (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy()) for pb in pbs})
        act = bpy.data.actions.new(name); act.use_fake_user = True
        arm.animation_data.action = act
        for f, P in enumerate(frames):
            for pb in pbs:
                l, r, s_ = P[pb.name]; pb.location = l; pb.rotation_quaternion = r; pb.scale = s_
                pb.keyframe_insert('location', frame=f, group=pb.name); pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name); pb.keyframe_insert('scale', frame=f, group=pb.name)
        arm.animation_data.action = None
        return act

    W = lambda side, keys: [('roll', [(t, v * side) for t, v in keys])]
    # ---------------- bite: rear back, lunge, snap jaw (impact ≈ 0.55 s)
    make('Boss_Bite', 1.3, {
        'Root': [('move_f', [(0, 0), (0.42, -0.4), (0.55, 1.0), (0.75, 0.7), (1.3, 0)])],
        'Spine3': [('pitch', [(0, 0), (0.42, 8), (0.55, -8), (1.3, 0)])],
        'Neck': [('pitch', [(0, 0), (0.42, 26), (0.55, -34), (0.8, -22), (1.3, 0)])],
        'Head': [('pitch', [(0, 0), (0.42, 12), (0.55, -16), (1.3, 0)])],
        'Jaw': [('pitch', [(0, 0), (0.4, -30), (0.53, -36), (0.58, -4), (0.9, -8), (1.3, 0)])],
    })
    # ---------------- tail swipe: wind up turning away, whip around (impact ≈ 0.65 s)
    tail_y = lambda k: [(0, 0), (0.45, -12 - 2 * k), (0.68, 16 + 3 * k), (1.0, 6), (1.5, 0)]
    make('Boss_TailSwipe', 1.5, dict({
        'Root': [('yaw', [(0, 0), (0.45, -38), (0.68, 52), (1.05, 18), (1.5, 0)])],
        'Neck': [('yaw', [(0, 0), (0.45, 18), (0.68, -22), (1.5, 0)])],
    }, **{f'Tail{k}': [('yaw', tail_y(k))] for k in range(1, 7)}))
    # ---------------- fire breath: rear up, then neck forward + jaw open, slow sweep (fire 0.9–2.5 s)
    make('Boss_Breath', 3.0, {
        'Root': [('move_u', [(0, 0), (0.6, 0.45), (0.9, 0.1), (2.6, 0.1), (3.0, 0)])],
        'Spine2': [('pitch', [(0, 0), (0.6, 14), (0.9, -4), (2.6, -4), (3.0, 0)])],
        'Neck': [('pitch', [(0, 0), (0.6, 30), (0.9, -16), (2.6, -16), (3.0, 0)]), ('yaw', [(0, 0), (0.9, -10), (1.7, 12), (2.5, -6), (3.0, 0)])],
        'Head': [('pitch', [(0, 0), (0.6, 18), (0.9, -12), (2.6, -12), (3.0, 0)])],
        'Jaw': [('pitch', [(0, 0), (0.6, -12), (0.85, -42), (2.55, -42), (2.8, 0)])],
        'L_Wing_Upper': W(1, [(0, 0), (0.6, 28), (0.9, 10), (2.6, 10), (3.0, 0)]),
        'R_Wing_Upper': W(-1, [(0, 0), (0.6, 28), (0.9, 10), (2.6, 10), (3.0, 0)]),
    })
    # ---------------- roar (also used for summoning): head up, jaw wide, wings spread
    make('Boss_Roar', 1.8, {
        'Root': [('move_u', [(0, 0), (0.5, 0.3), (1.4, 0.3), (1.8, 0)])],
        'Spine2': [('pitch', [(0, 0), (0.5, 12), (1.4, 12), (1.8, 0)])],
        'Neck': [('pitch', [(0, 0), (0.45, 34), (1.4, 30), (1.8, 0)])],
        'Head': [('pitch', [(0, 0), (0.45, 22), (1.4, 18), (1.8, 0)])],
        'Jaw': [('pitch', [(0, 0), (0.45, -48), (1.35, -44), (1.7, 0)])],
        'L_Wing_Upper': W(1, [(0, 0), (0.5, 42), (1.4, 38), (1.8, 0)]),
        'R_Wing_Upper': W(-1, [(0, 0), (0.5, 42), (1.4, 38), (1.8, 0)]),
    })
    # ---------------- slam: leap up with wings raised, crash down (impact ≈ 1.15 s)
    make('Boss_Slam', 2.0, {
        'Root': [('move_u', [(0, 0), (0.25, -0.25), (0.75, 2.6), (1.1, 0.1), (1.18, -0.35), (1.5, -0.1), (2.0, 0)]), ('move_f', [(0, 0), (0.75, 0.4), (1.15, 0.9), (2.0, 0)])],
        'Spine2': [('pitch', [(0, 0), (0.75, 16), (1.15, -14), (1.6, -6), (2.0, 0)])],
        'Neck': [('pitch', [(0, 0), (0.75, 20), (1.15, -22), (2.0, 0)])],
        'Head': [('pitch', [(0, 0), (0.75, 10), (1.15, -12), (2.0, 0)])],
        'Jaw': [('pitch', [(0, 0), (1.05, -10), (1.18, -40), (1.6, -10), (2.0, 0)])],
        'L_Wing_Upper': W(1, [(0, 0), (0.75, 55), (1.1, -25), (1.5, -10), (2.0, 0)]),
        'R_Wing_Upper': W(-1, [(0, 0), (0.75, 55), (1.1, -25), (1.5, -10), (2.0, 0)]),
        'Tail1': [('pitch', [(0, 0), (0.75, -12), (1.15, 14), (2.0, 0)])],
    })
    keep = ('Boss_', 'Run', 'Death', 'SRU_dragon_idle_aggro1', 'SRU_dragon_idle_normal', 'Landing', 'Spell2', 'SRU_Dragon_flying_Run')
    for a in list(bpy.data.actions):
        if not a.name.startswith(keep): bpy.data.actions.remove(a)
    arm.animation_data.action = base
    bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_animation_mode='ACTIONS', export_apply=False, export_yup=True,
                              export_extras=False, export_cameras=False, export_lights=False, export_image_format='AUTO', export_force_sampling=True, export_optimize_animation_size=False)
    return {'actions': [a.name for a in bpy.data.actions]}
