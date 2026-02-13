export default `\
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rg32float, write>;

struct Params {
  threshold: f32,
  invert: f32,
  _pad2: f32,
  _pad3: f32,
}
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(inputTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let color = textureLoad(inputTex, vec2i(gid.xy), 0);
  let alpha = color.a;

  var isSeed = alpha > params.threshold;
  if (params.invert > 0.5) {
    isSeed = !isSeed;
  }

  if (isSeed) {
    // Seed: store own coordinates
    textureStore(outputTex, vec2i(gid.xy), vec4f(f32(gid.x), f32(gid.y), 0.0, 0.0));
  } else {
    // No seed: sentinel
    textureStore(outputTex, vec2i(gid.xy), vec4f(-1.0, -1.0, 0.0, 0.0));
  }
}
`
