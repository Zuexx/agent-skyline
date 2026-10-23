shader_type spatial;
render_mode blend_premul_alpha, unshaded, cull_disabled, depth_draw_never;
// light rising from the rim of a ground magic circle: thin vertical streaks that fade with height
#include "res://magic.gdshaderinc"
uniform float strength = 1.0;
uniform float day = 0.0;
uniform float height = 1.0;
varying float hy;
void vertex() { hy = clamp(VERTEX.y / height + 0.5, 0.0, 1.0); }
uniform vec3 tint : source_color = vec3(1.0, 0.18, 0.24);
uniform vec3 hot : source_color = vec3(1.0, 0.70, 0.55);

void fragment() {
	float h = hy;                                                  // 0 at the ground, 1 at the top
	float fade = pow(max(1.0 - h, 0.0), 2.2);
	float u = UV.x * 90.0;
	float col_id = floor(u);
	float lane = smoothstep(0.5, 0.0, abs(fract(u) - 0.5)) * step(0.55, mg_hash(vec2(col_id, 7.0)));
	float rise = fract(h * 1.5 - TIME * (0.25 + 0.3 * mg_hash(vec2(col_id, 3.0))) + mg_hash(vec2(col_id, 1.0)));
	float streak = lane * smoothstep(0.0, 0.35, rise) * smoothstep(1.0, 0.6, rise);
	float sheet = mix(0.06, 0.12, day);
	float back = FRONT_FACING ? 1.0 : 0.4;
	float i = (sheet + streak * mix(0.7, 1.1, day)) * fade * back;
	i += smoothstep(0.06, 0.0, h) * 0.6 * back;                     // bright seam where it leaves the ground
	ALBEDO = mix(tint, hot, streak * 0.5) * i * strength;
	ALPHA = clamp(i * mix(0.15, 0.65, day), 0.0, 0.85);
}
