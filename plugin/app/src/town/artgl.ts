// The painted town at ANY angle (Carl, 2026-10-27: "move around the entire map 360, slide with no art drop").
// Each of the 8 paintings comes with a mesh (scripts/town-depth/mesh.py): for a grid of points over the picture, the tile
// (i, j) where that bit of paint touches the ground and how high above the ground it stands. The GPU turns those points to
// the current angle with the same projection as the map, so the art itself turns. Between two painted angles both
// neighbours are drawn, the farther first and the nearer over it, faded by how close the view is to each.

const N = 12, C = (N - 1) / 2, TW = 60, TH = 30, OX = 450, OY = 70
const GW = 344, GH = 192

export interface ArtPlate { deg: number; file: string; mesh: string }

const VS = `
attribute vec4 a;      // tile i, tile j (x500), height (x200), keep (0/1)
attribute vec2 uv;
uniform float rot;
uniform vec4 vb;       // the SVG viewBox: x, y, w, h
varying vec2 vuv;
varying float vkeep;
void main() {
  float i = a.x / 500.0, j = a.y / 500.0, h = a.z / 200.0;
  float c = cos(rot), s = sin(rot), p = i - ${C.toFixed(1)}, q = j - ${C.toFixed(1)};
  float ri = p * c - q * s + ${C.toFixed(1)}, rj = p * s + q * c + ${C.toFixed(1)};
  float x = ${OX.toFixed(1)} + (ri - rj) * ${(TW / 2).toFixed(1)};
  float yb = ${OY.toFixed(1)} + (ri + rj) * ${(TH / 2).toFixed(1)};
  float y = yb - h;
  // nearer = further down the map at its foot; the painter's order, as a depth buffer
  float z = 1.0 - clamp((yb + 300.0) / 1200.0, 0.0, 1.0);
  gl_Position = vec4((x - vb.x) / vb.z * 2.0 - 1.0, 1.0 - (y - vb.y) / vb.w * 2.0, z, 1.0);
  vuv = uv; vkeep = a.w;
}`
const FS = `
precision mediump float;
uniform sampler2D tex;
uniform float alpha;
varying vec2 vuv;
varying float vkeep;
void main() {
  if (vkeep < 0.5) discard;
  vec4 c = texture2D(tex, vuv);
  gl_FragColor = vec4(c.rgb, alpha);
}`

interface Loaded { deg: number; tex: WebGLTexture; buf: WebGLBuffer; idx: WebGLBuffer; count: number; fill: WebGLBuffer; fillCount: number }

export function mountArtGL(canvas: HTMLCanvasElement, base: string, plates: ArtPlate[]) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true })
  if (!gl) return null
  const ext = gl.getExtension('OES_element_index_uint')
  const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); return s }
  const prog = gl.createProgram()!
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  gl.useProgram(prog)
  const aLoc = gl.getAttribLocation(prog, 'a'), uvLoc = gl.getAttribLocation(prog, 'uv')
  const uRot = gl.getUniformLocation(prog, 'rot'), uVb = gl.getUniformLocation(prog, 'vb'), uAlpha = gl.getUniformLocation(prog, 'alpha')
  // the grid's texture coordinates are the same for every painting
  const uvs = new Float32Array(GW * GH * 2)
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { uvs[(y * GW + x) * 2] = x / (GW - 1); uvs[(y * GW + x) * 2 + 1] = y / (GH - 1) }
  const uvBuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)

  const loaded = new Map<number, Loaded>()
  let alive = true
  for (const p of plates) {
    Promise.all([
      fetch(base + p.mesh).then(r => r.arrayBuffer()),
      new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = base + p.file }),
    ]).then(([buf, im]) => {
      if (!alive) return
      const a = new Int16Array(buf)
      // triangles only between grid points that are kept and don't jump in height (a roof edge against the ground
      // behind it would stretch into a smear; the neighbouring painting fills that gap instead)
      const tris: number[] = [], all: number[] = []
      const k = (n: number) => a[n * 4 + 3] > 0, hh = (n: number) => a[n * 4 + 2] / 200
      for (let y = 0; y < GH - 1; y++) for (let x = 0; x < GW - 1; x++) {
        const n0 = y * GW + x, n1 = n0 + 1, n2 = n0 + GW, n3 = n2 + 1
        for (const [p0, p1, p2] of [[n0, n2, n1], [n1, n2, n3]]) {
          if (!k(p0) || !k(p1) || !k(p2)) continue
          all.push(p0, p1, p2)
          const h0 = hh(p0), h1 = hh(p1), h2 = hh(p2)
          if (Math.max(h0, h1, h2) - Math.min(h0, h1, h2) > 18) continue
          tris.push(p0, p1, p2)
        }
      }
      const vbuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW)
      const ibuf = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ext ? new Uint32Array(tris) : new Uint16Array(tris), gl.STATIC_DRAW)
      const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      // every triangle, stretched ones too: drawn underneath as a filler so a turn never opens a hole in the art
      const fbuf = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fbuf)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ext ? new Uint32Array(all) : new Uint16Array(all), gl.STATIC_DRAW)
      loaded.set(p.deg, { deg: p.deg, tex, buf: vbuf, idx: ibuf, count: tris.length, fill: fbuf, fillCount: all.length })
    }).catch(() => {})
  }

  function drawPlate(L: Loaded, rot: number, vb: [number, number, number, number], alpha: number, filler = false) {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, L.buf); gl!.enableVertexAttribArray(aLoc); gl!.vertexAttribPointer(aLoc, 4, gl!.SHORT, false, 0, 0)
    gl!.bindBuffer(gl!.ARRAY_BUFFER, uvBuf); gl!.enableVertexAttribArray(uvLoc); gl!.vertexAttribPointer(uvLoc, 2, gl!.FLOAT, false, 0, 0)
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, filler ? L.fill : L.idx)
    gl!.bindTexture(gl!.TEXTURE_2D, L.tex)
    gl!.uniform1f(uRot, rot); gl!.uniform4f(uVb, vb[0], vb[1], vb[2], vb[3]); gl!.uniform1f(uAlpha, alpha)
    gl!.drawElements(gl!.TRIANGLES, filler ? L.fillCount : L.count, ext ? gl!.UNSIGNED_INT : gl!.UNSIGNED_SHORT, 0)
  }

  return {
    // true once at least the two paintings around this angle are in
    ready(rot: number) { const [a, b] = around(rot); return loaded.has(a.deg) && loaded.has(b.deg) },
    draw(rot: number, vb: [number, number, number, number]) {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      gl!.viewport(0, 0, w, h)
      gl!.clearColor(0, 0, 0, 0); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT)
      gl!.enable(gl!.DEPTH_TEST); gl!.depthFunc(gl!.LEQUAL)
      gl!.enable(gl!.BLEND); gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA)
      const [a, b, t] = around(rot)
      const near = t < 0.5 ? a : b, far = t < 0.5 ? b : a, wNear = 1 - Math.min(t, 1 - t)
      const Ln = loaded.get(near.deg), Lf = loaded.get(far.deg)
      // the farther painting first, fully; then the nearer over it, as strong as the view is close to it
      // (mesh points are real tile coordinates, so both are turned by the view angle itself)
      if (Ln) drawPlate(Ln, rot, vb, 1, true)
      gl!.clear(gl!.DEPTH_BUFFER_BIT)
      if (Lf && wNear < 0.999) drawPlate(Lf, rot, vb, 1)
      gl!.clear(gl!.DEPTH_BUFFER_BIT)
      if (Ln) drawPlate(Ln, rot, vb, Lf && wNear < 0.999 ? wNear : 1)
    },
    destroy() { alive = false },
  }

  // the two painted angles either side of rot, and how far rot is from the first (0..1)
  function around(rot: number): [ArtPlate, ArtPlate, number] {
    const d = ((rot * 180 / Math.PI) % 360 + 360) % 360
    const sorted = plates.slice().sort((x, y) => x.deg - y.deg)
    let a = sorted[sorted.length - 1], b = sorted[0]
    for (let n = 0; n < sorted.length; n++) { if (sorted[n].deg <= d) a = sorted[n]; if (sorted[n].deg > d) { b = sorted[n]; break } if (n === sorted.length - 1) b = sorted[0] }
    const span = ((b.deg - a.deg) % 360 + 360) % 360 || 360
    return [a, b, (((d - a.deg) % 360) + 360) % 360 / span]
  }
}
