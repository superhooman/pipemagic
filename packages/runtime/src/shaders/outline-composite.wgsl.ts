export default `\
@group(0) @binding(0) var originalTex: texture_2d<f32>;
@group(0) @binding(1) var outerDistTex: texture_2d<f32>;
@group(0) @binding(2) var innerDistTex: texture_2d<f32>;
@group(0) @binding(3) var outputTex: texture_storage_2d<rgba8unorm, write>;

struct Params {
  outlineColor: vec4f,
  thickness: f32,
  opacity: f32,
  position: f32,
  threshold: f32,
}
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(originalTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let original = textureLoad(originalTex, vec2i(gid.xy), 0);
  let outerDist = textureLoad(outerDistTex, vec2i(gid.xy), 0).r;
  let innerDist = textureLoad(innerDistTex, vec2i(gid.xy), 0).r;

  let innerEdge = params.thickness * params.position;
  let outerEdge = params.thickness * (1.0 - params.position);

  let isInside = original.a > 0.1;

  var signedDist: f32;
  if (isInside) {
    signedDist = -innerDist;
  } else {
    signedDist = outerDist;
  }
  signedDist = signedDist + params.threshold;

  let outlineAlpha = smoothstep(-outerEdge - 0.5, -outerEdge + 0.5, signedDist)
                   * (1.0 - smoothstep(innerEdge - 0.5, innerEdge + 0.5, signedDist));

  let blendAlpha = outlineAlpha * params.opacity;
  let outColor = mix(original, vec4f(params.outlineColor.rgb, 1.0), blendAlpha);

  let finalAlpha = max(original.a, blendAlpha * params.outlineColor.a);

  textureStore(outputTex, vec2i(gid.xy), vec4f(outColor.rgb, finalAlpha));
}
`
