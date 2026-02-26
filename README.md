# Earth Orbital Debris Viewer

A 3D WebGL experience that visualizes Earth and the cloud of artificial objects orbiting it with a glowing, geometric aesthetic. The scene shows a stylized Earth, the Moon, and thousands of catalogued man‑made objects (satellites, space stations, rocket bodies, and debris).

Internally the app simulates **~5,200** orbiting objects:
- 1 natural object: the **Moon**
- 3 well‑known catalogued spacecraft (ISS, CSS, Hubble)
- ~5,200 synthetic objects generated from realistic orbital statistics to represent the larger population of tracked satellites and debris

Each point you see (other than the Moon) represents a distinct man‑made object with its own orbit and name.

## Run locally

From the project root:

```bash
cd Gravity
python3 -m http.server 3333
```

Then open **http://localhost:3333** in your browser.

> Any static HTTP server is fine; the only requirement is that `index.html` and `main.js` are served from the same directory so the ES module imports work.

## Controls

- **Rotate**: click & drag
- **Zoom**: scroll / pinch
- **Select object**: left‑click a particle (selected point turns solid blue; details appear in the tooltip)
- **Deselect**: click empty space

## Features

- **Geometric Earth**: Hollow, low‑poly icosahedron shell with an inner core, translucent fresnel glow, wireframe edges, and multiple halo layers.
- **Geometric Moon**: Smaller icosahedron with its own core, glow, and wireframe, orbiting Earth in real time.
- **Orbital debris cloud**: Thousands of particles distributed across realistic Earth orbits; each particle animates along its own trajectory.
- **Orbit trails**: Faint additive lines for a subset of objects to hint at their full paths, matching the “spark trail” aesthetic from the reference.
- **Selection & details**: Clicking a particle turns it solid blue and shows:
  - Object name (e.g. `Starlink-4321`, `Rocket body 70832`)
  - Type: `Satellite`, `Space station`, `Space debris`, `Rocket body`, or `Natural satellite`
  - Short description in the tooltip.

## Tech stack

- **Three.js** (ES modules from CDN)
- **Custom shaders** for:
  - Fresnel‑based translucent shells and cores
  - Point sprites with additive glow
- **EffectComposer + UnrealBloomPass** for bloom/tone‑mapped glow
- **Vanilla HTML/CSS/JS** (no build step required)

## Notes and limitations

- The orbital population is **representative, not a full catalog**. Realistic parameters (altitudes, inclinations, periods) are used to approximate where debris tends to be (LEO bands, ISS‑like orbits, etc.), but the IDs are synthetic.
- All non‑Moon objects are man‑made; there are currently **no asteroids or natural multi‑body systems** in the scene.
- The visualization is tuned for aesthetics rather than precise scientific accuracy; scales and glow radii are compressed to keep the scene readable.
