export default `\
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rg32float, write>;

struct Params {
  stepSize: i32,
  _pad1: i32,
  _pad2: i32,
  _pad3: i32,
}
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(inputTex);
  let size = vec2i(dims);
  let pos = vec2i(gid.xy);

  if (pos.x >= size.x || pos.y >= size.y) {
    return;
  }

  let step = params.stepSize;
  var bestSeed = textureLoad(inputTex, pos, 0).xy;
  var bestDist = 1e20;

  if (bestSeed.x >= 0.0) {
    let d = distance(vec2f(pos), bestSeed);
    bestDist = d;
  }

  // Check 8 neighbors + self at stepSize
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let neighbor = pos + vec2i(dx, dy) * step;
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= size.x || neighbor.y >= size.y) {
        continue;
      }
      let seed = textureLoad(inputTex, neighbor, 0).xy;
      if (seed.x < 0.0) { continue; }
      let d = distance(vec2f(pos), seed);
      if (d < bestDist) {
        bestDist = d;
        bestSeed = seed;
      }
    }
  }

  textureStore(outputTex, pos, vec4f(bestSeed, 0.0, 0.0));
}
`
