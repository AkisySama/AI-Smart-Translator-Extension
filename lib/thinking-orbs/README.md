# thinking-orbs engine

Vendored from the official `thinking-orbs@0.3.2` npm package (MIT, Jakub Antalik).

- Repository: https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/thinking-orbs
- Package: https://registry.npmjs.org/thinking-orbs/-/thinking-orbs-0.3.2.tgz
- Upstream commit: `5e7afad5fc8f3661e0bf0b4cd3f87de482ffcf16`
- Package integrity (SHA-512): `QZFeBaPEzqhjiZoXy961EvDgaXk2WgXacF3Rbz+Sj5IfzDzBvTC86vdREUHniBffYibJFKSwbfllxLUdI/Xv6g==`

`engine.js` contains the unchanged `dist/index-Rl6_4MTr.cjs` engine inside an
IIFE with a local `exports` object, exposed as `AIThinkingOrbEngine`. No React,
remote scripts, runtime downloads, or build step are required. Keep `LICENSE`
with this file when redistributing the extension.

`content/thinking-orb.js` mounts the engine on a 2D canvas and manages animation,
visibility, reduced motion, and disposal. The loading state is selected by
`THINKING_ORB_STATE` in `content/content.js`. Supported states: `working`,
`searching`, `solving`, `listening`, `connecting`, `weaving`, `composing`,
`breathing`, and `shaping`. Use the upstream tuned sizes, `64` or `20`.

The loading capsule's shape follows `sites/home/public/assets/examples.css`,
with the text shimmer from the official demo. Its surface shares the word card's
background, opacity, border, shadow, and backdrop blur through local CSS variables.
The orb and shimmer use dark ink on this light surface. Its 64px engine renders at 36 CSS pixels,
inside a 48px capsule with 14px text; related lookups use the compact 36px capsule with a 20px
orb. Only loading indicators use the bundled Inter Regular Latin font, licensed
under the SIL Open Font License in `asset/fonts/OFL.txt`. The font is loaded
locally, without contacting Google Fonts at runtime.
