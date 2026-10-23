extends Node
## Godot renderer for a painted town pack (specs/10-town-pack.md), for the renderer comparison
## (specs/08). Same behaviour as ../web/town.js: the relief is rebuilt on the GPU from the pack's
## depth map, window light per building follows live agent state from ../state.mjs.
##   godot --path . -- --pack=<dir> [--variant=night|day] [--view=pano|close|priest] [--size=WxH]
##                     [--state=http://127.0.0.1:4478/state] [--bench=<s>] [--shot=<png>] [--nodof]
##                     [--on-top] [--borderless] [--opacity=0.8] [--hud]

const WIN := {"agent": 4.0, "recent": 0.55, "rest": 0.0}       # the user's choice (option 三, "mix")
const SPILL_MIN := 2.0
const CHAR_H := 2.193
const BIG := 2.25
const WALK_SPEED := 7.0
const COLORS := {"hero": "#ff9a3c", "mage": "#b56cff", "priest": "#3fe0c8"}
const CLIP := {
	"hero": {"write": "hero_hammer", "walk": "hero_walk"},
	"mage": {"read": "mage_read", "walk": "mage_walk"},
	"priest": {"blocked": "priest_bump", "walk": "priest_walk"},
}
const SLOT := {"hero": Vector2(17, 50), "mage": Vector2(75, -20), "priest": Vector2(-40, 45)}
const BLOCKED_SLOT := Vector2(-160, 29)

var pack_dir := ""
var variant := "night"
var view := "pano"
var size := Vector2i(0, 0)                  # 0 = follow the window
var state_url := "http://127.0.0.1:4478/state"
var shot_path := ""
var shot_wait := 90
var bench_s := 0.0
var use_dof := true
var show_hud := false
var night := true
var big := true

var pack: Dictionary
var V: Dictionary
var B: Basis
var vp := SubViewport.new()
var world := Node3D.new()
var cam := Camera3D.new()
var cam_attr := CameraAttributesPractical.new()
var env := Environment.new()
var relief_mat := ShaderMaterial.new()
var win_levels := PackedFloat32Array()
var buildings := {}                          # id -> {index, pixel: Vector2, pos: Vector3}
var depth_img: Image
var windows_on := false
var tex_cache := {}
var hud := Label.new()
var tr := TextureRect.new()

var agents := {}                             # key -> agent dictionary (see _agent_new)
var barriers := {}
var scaffolds := {}
var spills := {}
var http := HTTPRequest.new()
var poll_t := 0.0
var polling := false
var load_ms := 0.0

var bench_t := 0.0
var bench_frames := 0
var bench_min_fps := 1e9
var bench_warm := 2.0
var gpu_ms: Array = []
var dts: Array = []
var fps_t := 0.0
var fps_frames := 0


func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--pack="): pack_dir = a.substr(7)
		elif a.begins_with("--variant="): variant = a.substr(10)
		elif a.begins_with("--view="): view = a.substr(7)
		elif a.begins_with("--size="):
			var p := a.substr(7).split("x")
			size = Vector2i(int(p[0]), int(p[1]))
		elif a.begins_with("--state="): state_url = a.substr(8)
		elif a.begins_with("--shot="): shot_path = a.substr(7)
		elif a.begins_with("--bench="): bench_s = float(a.substr(8))
		elif a == "--nodof": use_dof = false
		elif a == "--hud": show_hud = true
		elif a == "--on-top": DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_ALWAYS_ON_TOP, true)
		elif a == "--borderless": DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
		elif a.begins_with("--opacity="):
			# whole-window opacity through per-pixel transparency (project setting allows it)
			get_viewport().transparent_bg = true
			DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_TRANSPARENT, true)
			tr.modulate.a = float(a.substr(10))
	night = variant == "night"
	big = view == "pano"
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if "--vsync" in OS.get_cmdline_user_args() else DisplayServer.VSYNC_DISABLED)
	pack = JSON.parse_string(FileAccess.get_file_as_string(pack_dir.path_join("theme.json")))
	V = pack.variants[variant]
	var b: Array = V.basis
	B = Basis(Vector3(b[0][0], b[0][1], b[0][2]), Vector3(b[1][0], b[1][1], b[1][2]), Vector3(b[2][0], b[2][1], b[2][2]))
	depth_img = Image.load_from_file(pack_dir.path_join(V.depth))
	for bd in V.buildings:
		buildings[bd.id] = {"index": int(bd.index), "pixel": Vector2(bd.pixel[0], bd.pixel[1]), "pos": _v(bd.world)}
	win_levels.resize(32)

	vp.size = size if size.x > 0 else DisplayServer.window_get_size()
	vp.own_world_3d = true
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vp.msaa_3d = Viewport.MSAA_2X
	add_child(vp)
	tr.texture = vp.get_texture()
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(tr)
	vp.add_child(world)
	if size.x == 0:
		get_window().size_changed.connect(func(): vp.size = DisplayServer.window_get_size(); _place_camera())

	_build_stage()
	_build_lights()
	_build_camera()
	add_child(http)
	http.request_completed.connect(_on_state)
	if show_hud:
		hud.position = Vector2(8, 6)
		hud.add_theme_color_override("font_shadow_color", Color.BLACK)
		add_child(hud)
	RenderingServer.viewport_set_measure_render_time(vp.get_viewport_rid(), true)
	print("WINDOW ", JSON.stringify({
		"on_top": DisplayServer.window_get_flag(DisplayServer.WINDOW_FLAG_ALWAYS_ON_TOP),
		"borderless": DisplayServer.window_get_flag(DisplayServer.WINDOW_FLAG_BORDERLESS),
		"transparent": DisplayServer.window_get_flag(DisplayServer.WINDOW_FLAG_TRANSPARENT),
		"opacity": tr.modulate.a, "resizable": not DisplayServer.window_get_flag(DisplayServer.WINDOW_FLAG_RESIZE_DISABLED),
	}))
	load_ms = Time.get_ticks_msec() - t0


# ---------------------------------------------------------------- helpers
func _tex(rel: String, mips := true) -> ImageTexture:
	if rel == "" or rel == null:
		return null
	if tex_cache.has(rel):
		return tex_cache[rel]
	var img := Image.load_from_file(pack_dir.path_join(rel))
	if mips:
		img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	tex_cache[rel] = t
	return t


func _v(a: Array) -> Vector3:
	return Vector3(a[0], a[1], a[2])


## a pixel of the painting -> the 3D point it shows (characters and ground effects stand there)
func _ground_at(px: float, py: float) -> Variant:
	var x := clampi(roundi(px), 0, depth_img.get_width() - 1)
	var y := clampi(roundi(py), 0, depth_img.get_height() - 1)
	var c := depth_img.get_pixel(x, y)
	var code := roundi(c.r * 255.0) * 256 + roundi(c.g * 255.0)
	if code == 0:
		return null
	var z: float = V.depthNear + (code - 1) / 65534.0 * (V.depthFar - V.depthNear)
	var f: float = V.focalPx
	var cam_p := Vector3((x + 0.5 - V.principal[0]) / f * z, -(y + 0.5 - V.principal[1]) / f * z, -z)
	return B * cam_p


# ---------------------------------------------------------------- stage
func _build_stage() -> void:
	var stage := Node3D.new()
	stage.basis = B
	world.add_child(stage)
	var W: int = V.depthSize[0]
	var H: int = V.depthSize[1]
	var plane := PlaneMesh.new()                              # W x H vertices; the shader places them
	plane.subdivide_width = W - 2
	plane.subdivide_depth = H - 2
	var mi := MeshInstance3D.new()
	mi.mesh = plane
	mi.custom_aabb = AABB(Vector3(-2000, -2000, -2000), Vector3(4000, 4000, 4000))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var bg: Dictionary = V.background
	windows_on = night and bg.has("ids")
	relief_mat.shader = load("res://relief.gdshader")
	relief_mat.set_shader_parameter("depth_tex", _tex(V.depth, false))
	relief_mat.set_shader_parameter("depth_range", Vector2(V.depthNear, V.depthFar))
	relief_mat.set_shader_parameter("principal", Vector2(V.principal[0], V.principal[1]))
	relief_mat.set_shader_parameter("dsize", Vector2(W, H))
	relief_mat.set_shader_parameter("focal", V.focalPx)
	relief_mat.set_shader_parameter("edge_rtol", 0.04 if "--edges" in OS.get_cmdline_user_args() else 1e9)
	relief_mat.set_shader_parameter("albedo_tex", _tex(bg.albedo))
	relief_mat.set_shader_parameter("read_tex", _tex(bg.reading))
	relief_mat.set_shader_parameter("windows_on", windows_on)
	if windows_on:
		relief_mat.set_shader_parameter("light_tex", _tex(bg.light))
		relief_mat.set_shader_parameter("halo_tex", _tex(bg.halo))
		relief_mat.set_shader_parameter("id_tex", _tex(bg.ids, false))
	relief_mat.set_shader_parameter("win", win_levels)
	mi.material_override = relief_mat
	stage.add_child(mi)

	# the painting far away on the same projection fills the sky MoGe masked out
	var far := 900.0
	var sky := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(2 * far * tan(deg_to_rad(V.fov[0]) / 2), 2 * far * tan(deg_to_rad(V.fov[1]) / 2))
	sky.mesh = q
	var sm := StandardMaterial3D.new()
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.albedo_texture = _tex(bg.albedo)
	sky.material_override = sm
	sky.position = Vector3(0, 0, -far)
	stage.add_child(sky)

	env.background_mode = Environment.BG_COLOR
	env.background_color = Color8(10, 16, 34) if night else Color8(150, 190, 230)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color8(70, 80, 120) if night else Color8(215, 205, 170)
	env.ambient_light_energy = 0.45 if night else 0.75
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.glow_enabled = true
	env.glow_intensity = 0.8 if night else 0.35
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 0.9
	var we := WorldEnvironment.new()
	we.environment = env
	world.add_child(we)


func _omni(col: Color, energy: float, rng: float, pos: Vector3, att := 1.0) -> OmniLight3D:
	var o := OmniLight3D.new()
	o.light_color = col
	o.light_energy = energy
	o.omni_range = rng
	o.omni_attenuation = att
	o.position = pos
	world.add_child(o)
	return o


func _build_lights() -> void:
	var sun := DirectionalLight3D.new()
	sun.light_color = Color8(150, 175, 255) if night else Color8(255, 236, 205)
	sun.light_energy = 0.3 if night else 1.1
	sun.rotation_degrees = Vector3(-45, -40, 0)
	world.add_child(sun)
	if night:
		for l in V.lights:
			_omni(Color8(255, 170, 90), clamp(float(l.size) / 60.0, 0.6, 3.0), clamp(float(l.depth) * 0.09, 2.0, 9.0), _v(l.pos), 1.3)


func _build_camera() -> void:
	vp.add_child(cam)
	_place_camera()
	var near_d: float
	var far_d: float
	if view == "pano":
		var ds: Array = []
		for k in buildings:
			ds.append(buildings[k].pos.length())
		ds.sort()
		near_d = ds[0] * 0.9
		far_d = ds[ds.size() - 1] * 1.05
	else:
		var subj := "web/src/city" if view == "close" else "install"
		var dd: float = buildings[subj].pos.length()
		if view == "close":
			dd = (dd + buildings["specs"].pos.length()) / 2.0
		near_d = dd * 0.8
		far_d = dd * 1.15
	cam_attr.dof_blur_near_enabled = use_dof
	cam_attr.dof_blur_near_distance = near_d
	cam_attr.dof_blur_near_transition = near_d * 0.35
	cam_attr.dof_blur_far_enabled = use_dof
	cam_attr.dof_blur_far_distance = far_d
	cam_attr.dof_blur_far_transition = far_d * 0.6
	cam_attr.dof_blur_amount = 0.06 if view == "pano" else 0.09
	cam.attributes = cam_attr
	cam.near = 0.5
	cam.far = 2000.0
	cam.current = true


func _place_camera() -> void:
	var W: float = V.depthSize[0]
	var H: float = V.depthSize[1]
	var F: float = V.focalPx
	if view == "pano":
		cam.basis = B
		cam.fov = V.fov[1]
	else:
		var center := Vector2(640, 445) if view == "close" else Vector2(1085, 730)
		var d := B * Vector3((center.x - W / 2) / F, -(center.y - H / 2) / F, -1.0)
		cam.look_at_from_position(Vector3.ZERO, d, Vector3.UP)
		cam.fov = rad_to_deg(2.0 * atan(360.0 / 2.0 / F))


func _disc(r: float, col: Color, energy: float, ring: bool) -> MeshInstance3D:
	# MoGe flattens the painted ground, so flat discs are stretched in depth to read as round
	var mi := MeshInstance3D.new()
	var p := PlaneMesh.new()
	p.size = Vector2(r * 2, r * 2 * 2.5)
	mi.mesh = p
	var sh := ShaderMaterial.new()
	sh.shader = load("res://glow.gdshader")
	sh.set_shader_parameter("color", col)
	sh.set_shader_parameter("energy", energy)
	sh.set_shader_parameter("ring", 1.0 if ring else 0.0)
	mi.material_override = sh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	world.add_child(mi)
	return mi


# ---------------------------------------------------------------- sprites
func _sprite_new(h: float) -> Dictionary:
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_DEPTH_PRE_PASS
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	m.roughness = 1.0
	m.metallic_specular = 0.0
	m.normal_enabled = true
	m.normal_scale = 0.7
	var mi := MeshInstance3D.new()
	mi.mesh = QuadMesh.new()
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	world.add_child(mi)
	return {"mi": mi, "mat": m, "h": h, "name": "", "flip": false, "meta": {}, "t": randf() * 2.0}


func _sprite_set(s: Dictionary, name: String, flip := false) -> void:
	if s.name == name and s.flip == flip:
		return
	s.name = name
	s.flip = flip
	var meta: Dictionary = pack.sprites[name]
	s.meta = meta
	var m: StandardMaterial3D = s.mat
	m.albedo_texture = _tex(meta.albedo)
	m.normal_texture = _tex(meta.normal)
	var H: float = s.h * float(meta.cell[1]) / float(meta.char_h)
	var W: float = H * float(meta.cell[0]) / float(meta.cell[1])
	var q := QuadMesh.new()
	q.size = Vector2(W, H)
	var px: float = meta.pivot[0]
	var py: float = meta.pivot[1]
	q.center_offset = Vector3(((0.5 - px) if not flip else (px - 0.5)) * W, (0.5 - py) * H, 0)
	s.mi.mesh = q
	_sprite_frame(s, 0)


func _sprite_frame(s: Dictionary, f: int) -> void:
	var meta: Dictionary = s.meta
	var cols := int(meta.cols)
	var rows := int(meta.rows)
	var c := f % cols
	var r := f / cols
	var m: StandardMaterial3D = s.mat
	if s.flip:
		m.uv1_scale = Vector3(-1.0 / cols, 1.0 / rows, 1)
		m.uv1_offset = Vector3(float(c + 1) / cols, float(r) / rows, 0)
	else:
		m.uv1_scale = Vector3(1.0 / cols, 1.0 / rows, 1)
		m.uv1_offset = Vector3(float(c) / cols, float(r) / rows, 0)


func _sprite_update(s: Dictionary, dt: float) -> void:
	if s.meta.is_empty():
		return
	s.t += dt
	if int(s.meta.frames) > 1:
		_sprite_frame(s, int(s.t * float(s.meta.fps)) % int(s.meta.frames))


func _sparks(h: float, col: Color) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 40
	p.lifetime = 0.7
	p.preprocess = 1.0
	p.explosiveness = 0.6
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 55.0
	pm.initial_velocity_min = h * 1.2
	pm.initial_velocity_max = h * 2.6
	pm.gravity = Vector3(0, -h * 6.0, 0)
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 1))
	fade.set_color(1, Color(1, 1, 1, 0))
	var gt := GradientTexture1D.new()
	gt.gradient = fade
	pm.color_ramp = gt
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(h, h) * 0.035
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = col
	m.emission_enabled = true
	m.emission = col
	m.emission_energy_multiplier = 6.0
	q.material = m
	p.draw_pass_1 = q
	world.add_child(p)
	return p


# ---------------------------------------------------------------- agents
func _door_spot(bid: String, character: String, action: String) -> Vector3:
	var b: Dictionary = buildings.get(bid, buildings["(root)"])
	var off: Vector2 = BLOCKED_SLOT if action == "blocked" else SLOT.get(character, Vector2(0, 50))
	var p = _ground_at(b.pixel.x + off.x, b.pixel.y + off.y)
	return p if p != null else b.pos


func _agent_new(a: Dictionary) -> Dictionary:
	var h := CHAR_H * (BIG if big else 1.0)
	var col := Color(COLORS.get(a.character, "#ffffff"))
	var pos := _door_spot(a.building, a.character, a.action)
	return {
		"state": a, "character": a.character, "h": h, "pos": pos, "target": pos,
		"sprite": _sprite_new(h),
		"shadow": _disc(h * 0.32, Color(0, 0, 0, 0.45), 1.0, false),
		"ring": _disc(h * 0.36, col, 2.5 if night else 1.6, true),
		"light": _omni(col, 0.8 if night else 0.3, h * 1.2, pos),
		"alert": null, "sparks": null, "left": true,
	}


func _agent_free(ag: Dictionary) -> void:
	for k in ["shadow", "ring", "light"]:
		ag[k].queue_free()
	ag.sprite.mi.queue_free()
	if ag.alert != null:
		ag.alert.mi.queue_free()
	if ag.sparks != null:
		ag.sparks.queue_free()


func _agent_update(ag: Dictionary, dt: float) -> void:
	var d: Vector3 = ag.target - ag.pos
	var walking := d.length() > 0.05
	if walking:
		var before := cam.unproject_position(ag.pos).x
		ag.pos += d.limit_length(WALK_SPEED * (BIG if big else 1.0) * dt)
		ag.left = cam.unproject_position(ag.pos).x < before
	var clips: Dictionary = CLIP.get(ag.character, {})
	var clip = clips.get("walk") if walking else clips.get(ag.state.action)
	var name: String = clip if clip != null else ag.character + "_idle"
	_sprite_set(ag.sprite, name, walking and not ag.left)
	ag.sprite.mi.position = ag.pos
	_sprite_update(ag.sprite, dt)
	var h: float = ag.h
	ag.shadow.position = ag.pos + Vector3(h * 0.25, 0.03, h * 0.1)
	ag.ring.position = ag.pos + Vector3(0, 0.04, 0)
	ag.light.position = ag.pos + Vector3(0, h * 0.3, h * 0.4)

	var blocked: bool = not walking and ag.state.action == "blocked"
	if blocked and ag.alert == null:
		ag.alert = _sprite_new(h * 0.4)
		_sprite_set(ag.alert, "alert")
		var am: StandardMaterial3D = ag.alert.mat
		am.emission_enabled = true
		am.emission = Color(1.0, 0.2, 0.2)
		am.emission_energy_multiplier = 0.6 if night else 0.25
	elif not blocked and ag.alert != null:
		ag.alert.mi.queue_free()
		ag.alert = null
	if ag.alert != null:
		ag.alert.mi.position = ag.pos + Vector3(-h * 0.05, h * 0.98, 0)
	var hammering: bool = not walking and ag.sprite.name == "hero_hammer"
	if hammering and ag.sparks == null:
		ag.sparks = _sparks(h, Color(1.0, 0.65, 0.2))
	elif not hammering and ag.sparks != null:
		ag.sparks.queue_free()
		ag.sparks = null
	if ag.sparks != null:
		ag.sparks.position = ag.pos + Vector3(h * 0.05, h * 0.28, 0.05)


# ---------------------------------------------------------------- building effects
func _magic(shader: String, strength: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://%s.gdshader" % shader)
	m.set_shader_parameter("strength", strength)
	m.set_shader_parameter("day", 0.0 if night else 1.0)
	return m


func _mesh(mesh: Mesh, mat: Material, pos: Vector3) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = pos
	world.add_child(mi)
	return mi


func _barrier(b: Dictionary) -> Array:
	var pos: Vector3 = b.pos
	var r := 3.76
	var ground := PlaneMesh.new()
	ground.size = Vector2(r, r) * 2.5
	var nodes: Array = [_mesh(ground, _magic("runes", 3.0 if night else 1.6), pos + Vector3(0, 0.03, 0))]
	var c := CylinderMesh.new()
	c.top_radius = r * 1.1
	c.bottom_radius = r * 1.1
	c.height = r * 2.2
	c.cap_top = false
	c.cap_bottom = false
	c.radial_segments = 64
	var cm := _magic("curtain", 2.8 if night else 2.6)
	cm.set_shader_parameter("height", c.height)
	nodes.append(_mesh(c, cm, pos + Vector3(0, r * 1.1, 0)))
	nodes.append(_omni(Color8(255, 70, 80), 3.0 if night else 1.2, r * 1.8, pos + Vector3(0, r * 0.5, r * 0.6)))
	return nodes


func _scaffold(b: Dictionary) -> Array:
	var meta: Dictionary = pack.sprites.scaffold
	var s := _sprite_new(5.47 * float(meta.char_h) / (float(meta.cell[0]) - 12.0))
	_sprite_set(s, "scaffold")
	s.mi.position = b.pos + Vector3(0, 0, 0.5)
	return [s.mi]


func _spill(b: Dictionary) -> Array:
	var pos: Vector3 = b.pos
	var r := pos.length() * 0.07
	var g = _ground_at(b.pixel.x, b.pixel.y + 20)
	var at: Vector3 = g if g != null else pos * 0.985
	var p := PlaneMesh.new()
	p.size = Vector2(r * 2.2, r * 5.0)
	var sh := ShaderMaterial.new()
	sh.shader = load("res://spill.gdshader")
	sh.set_shader_parameter("energy", 0.9)
	return [_mesh(p, sh, at + Vector3(0, 0.03, 0)), _omni(Color8(255, 175, 100), 2.0, r * 1.6, at + Vector3(0, r * 0.4, 0))]


func _sync_fx(have: Dictionary, want: Dictionary, make: Callable) -> void:
	for id in have.keys():
		if not want.has(id):
			for n in have[id]:
				n.queue_free()
			have.erase(id)
	for id in want:
		if not have.has(id) and buildings.has(id):
			have[id] = make.call(buildings[id])


# ---------------------------------------------------------------- live state
func _on_state(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	polling = false
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		return
	var s = JSON.parse_string(body.get_string_from_utf8())
	if typeof(s) != TYPE_DICTIONARY:
		return
	var seen := {}
	var at := {}
	var blocked := {}
	var writing := {}
	var reading := false
	for a in s.agents:
		if a.action != "idle":
			at[a.building] = true
		if a.action == "blocked":
			blocked[a.building] = true
		if a.action == "write":
			writing[a.building] = true
		if a.action == "read":
			reading = true
		if a.action == "idle" and not agents.has(a.key):
			continue
		seen[a.key] = true
		if not agents.has(a.key):
			agents[a.key] = _agent_new(a)
		else:
			agents[a.key].state = a
			agents[a.key].target = _door_spot(a.building, a.character, a.action)
	for k in agents.keys():
		if not seen.has(k):
			_agent_free(agents[k])
			agents.erase(k)
	var recent := {}
	for r in s.recent:
		recent[r] = true
	var lit := {}
	for id in buildings:
		var i: int = buildings[id].index
		win_levels[i] = WIN.agent if at.has(id) else (WIN.recent if recent.has(id) else WIN.rest)
		if windows_on and win_levels[i] >= SPILL_MIN:
			lit[id] = true
	relief_mat.set_shader_parameter("win", win_levels)
	relief_mat.set_shader_parameter("read_energy", (2.2 if night else 1.4) if reading else 0.0)
	_sync_fx(barriers, blocked, _barrier)
	_sync_fx(scaffolds, writing, _scaffold)
	_sync_fx(spills, lit, _spill)


func _process(dt: float) -> void:
	poll_t -= dt
	if poll_t <= 0.0 and not polling:
		poll_t = 0.25
		polling = true
		if http.request(state_url) != OK:
			polling = false
	for k in agents:
		_agent_update(agents[k], dt)
	fps_t += dt
	fps_frames += 1
	if show_hud and fps_t >= 0.5:
		var lines := ["%d fps · load %.1f s · %d prims" % [fps_frames / fps_t, load_ms / 1000.0, Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)]]
		for k in agents:
			lines.append("%s: %s @ %s" % [agents[k].character, agents[k].state.action, agents[k].state.building])
		hud.text = "\n".join(lines)
	if fps_t >= 0.5:
		fps_t = 0.0
		fps_frames = 0
	if bench_s > 0.0:
		if bench_warm > 0.0:
			bench_warm -= dt
			return
		bench_t += dt
		bench_frames += 1
		gpu_ms.append(RenderingServer.viewport_get_measured_render_time_gpu(vp.get_viewport_rid()))
		dts.append(dt * 1000.0)
		bench_min_fps = min(bench_min_fps, 1.0 / max(dt, 1e-6))
		if bench_t >= bench_s:
			var r := {
				"variant": variant, "view": view, "size": "%dx%d" % [vp.size.x, vp.size.y],
				"avg_fps": snappedf(bench_frames / bench_t, 0.1), "min_fps": snappedf(bench_min_fps, 0.1),
				"load_s": snappedf(load_ms / 1000.0, 0.01),
				"video_mem_mb": snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1),
				"static_mem_mb": snappedf(OS.get_static_memory_usage() / 1048576.0, 0.1),
				"draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
				"primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
				"agents": agents.size(),
				"gpu_ms_avg": snappedf(_avg(gpu_ms), 0.001), "gpu_ms_p99": snappedf(_p99(gpu_ms), 0.001),
				"p99_ms": snappedf(_p99(dts), 0.01), "over_20ms": dts.filter(func(x): return x > 20.0).size(),
			}
			print("BENCH ", JSON.stringify(r))
			get_tree().quit()
	elif shot_path != "":
		shot_wait -= 1
		if shot_wait <= 0:
			vp.get_texture().get_image().save_png(shot_path)
			get_tree().quit()


func _avg(a: Array) -> float:
	var t := 0.0
	for x in a:
		t += x
	return t / max(a.size(), 1)


func _p99(a: Array) -> float:
	var b := a.duplicate()
	b.sort()
	return b[int(b.size() * 0.99)] if b.size() > 0 else 0.0
