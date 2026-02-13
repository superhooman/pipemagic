export default `\
@group(0) @binding(0) var jfaTex: texture_2d<f32>;
@group(0) @binding(1) var distTex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(jfaTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let pos = vec2f(gid.xy);
  let seed = textureLoad(jfaTex, vec2i(gid.xy), 0).xy;

  var dist = 0.0;
  if (seed.x < 0.0) {
    dist = 1e10;
  } else {
    dist = distance(pos, seed);
  }

  textureStore(distTex, vec2i(gid.xy), vec4f(dist, 0.0, 0.0, 0.0));
}
`
