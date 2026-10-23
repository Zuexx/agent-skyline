shader_type spatial;
render_mode unshaded, cull_disabled;
// Painted relief rebuilt from the town pack's depth map (specs/10): one vertex per depth pixel,
// placed along its camera ray. Night: dark-window painting + light layer * strength of the building
// that owns the pixel, a halo and a warm wash for buildings brighter than 1. Same as web/town.js.
uniform sampler2D depth_tex : filter_nearest;    // R = high byte, G = low byte, 0 = sky
uniform vec2 depth_range;
uniform vec2 principal;
uniform vec2 dsize;
uniform float focal;
uniform float edge_rtol = 1e9;
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap;
uniform sampler2D light_tex : source_color, filter_linear;
uniform sampler2D halo_tex : filter_linear;
uniform sampler2D id_tex : filter_nearest;
uniform sampler2D read_tex : filter_linear;
uniform bool windows_on = false;
uniform float read_energy = 0.0;
uniform float win[32];

varying float edge;

float d_at(ivec2 p) {
	vec4 c = texelFetch(depth_tex, clamp(p, ivec2(0), ivec2(dsize) - 1), 0);
	float code = floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5);
	return code < 0.5 ? -1.0 : depth_range.x + (code - 1.0) / 65534.0 * (depth_range.y - depth_range.x);
}

void vertex() {
	ivec2 p = ivec2(round(UV * (dsize - 1.0)));
	float z = d_at(p);
	float lo = z, hi = z;
	for (int j = -1; j <= 1; j++) {
		for (int i = -1; i <= 1; i++) {
			float n = d_at(p + ivec2(i, j));
			if (n < 0.0) n = 1e3;
			lo = min(lo, n);
			hi = max(hi, n);
		}
	}
	edge = (z < 0.0 || (hi - lo) / max(lo, 1e-3) > edge_rtol) ? 1.0 : 0.0;
	if (z < 0.0) z = 100.0;
	vec2 px = vec2(p) + 0.5;
	VERTEX = vec3((px.x - principal.x) / focal * z, -(px.y - principal.y) / focal * z, -z);
	UV = px / dsize;
}

float level(float code) {
	int i = int(round(code * 255.0 / 10.0)) - 1;
	return (i >= 0 && i < 32) ? win[i] : 0.0;
}

void fragment() {
	if (edge > 0.001) discard;
	vec3 c = texture(albedo_tex, UV).rgb;
	if (windows_on) {
		vec4 id = texture(id_tex, UV);
		c += texture(light_tex, UV).rgb * level(id.r);
		vec4 h = texture(halo_tex, UV);
		c += h.rgb * max(level(id.g) - 1.0, 0.0) * 0.5;
		float wash = h.a * clamp((level(id.b) - 1.0) / 3.0, 0.0, 1.0);
		c += c * vec3(1.6, 1.0, 0.45) * wash * 0.9 + vec3(0.05, 0.025, 0.0) * wash;
	}
	// reading: the library windows glow blue
	c += vec3(0.073, 0.38, 1.0) * texture(read_tex, UV).r * read_energy * (0.75 + 0.25 * sin(TIME * 3.0));
	ALBEDO = c;
}
