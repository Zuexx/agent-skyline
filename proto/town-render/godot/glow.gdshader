shader_type spatial;
// soft coloured disc on the ground (agent ring) or a dark blob (shadow); stretched in depth by the mesh
render_mode blend_mix, unshaded, depth_draw_never, cull_disabled;
uniform vec4 color : source_color = vec4(1.0, 0.6, 0.2, 1.0);
uniform float energy = 2.0;
uniform float ring = 1.0;      // 1 = ring with a bright rim, 0 = filled soft blob
void fragment() {
	float d = length(UV - 0.5) * 2.0;
	float a = ring > 0.5 ? smoothstep(1.0, 0.82, d) * (0.25 + 0.75 * smoothstep(0.55, 0.85, d)) : smoothstep(1.0, 0.2, d);
	ALBEDO = color.rgb * energy;
	ALPHA = a * color.a;
}
