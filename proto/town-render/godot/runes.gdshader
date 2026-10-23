shader_type spatial;
render_mode blend_premul_alpha, unshaded, cull_disabled, depth_draw_never;
// magic circle: on the ground under a barrier, or standing upright as a seal on a door
#include "res://magic.gdshaderinc"
uniform float strength = 1.0;
uniform float day = 0.0;
uniform float width = 0.012;
uniform float spin = 1.0;
uniform vec3 tint : source_color = vec3(1.0, 0.18, 0.24);
uniform vec3 hot : source_color = vec3(1.0, 0.70, 0.55);

void fragment() {
	vec2 p = (UV - 0.5) * 2.0;
	float o = mg_circle(p, TIME * spin, width * mix(1.0, 1.5, day));
	float halo = smoothstep(1.0, 0.0, length(p)) * 0.10;          // soft glow filling the circle
	float pulse = 0.85 + 0.15 * sin(TIME * 2.0);
	float i = (o * pulse + halo);
	ALBEDO = mix(tint, hot, o * 0.5) * i * strength;
	ALPHA = clamp(i * mix(0.25, 0.7, day), 0.0, 0.9);
}
