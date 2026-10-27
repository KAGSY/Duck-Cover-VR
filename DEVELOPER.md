# Duck & Cover — developer notes

Plain JavaScript (ES modules) on three.js r170, bundled with esbuild into one HTML file.

## Build

```
npm install
node build.mjs          # minified
node build.mjs --dev    # readable
```

Outputs in `dist/`:

- `duck-and-cover.html` — loads three.js from the jsDelivr CDN. Host it anywhere over https.
- `artifact.html` — the same page as a fragment, for publishing as a Claude artifact.
- `offline/` — self-contained installable web app (three.js bundled, service worker, manifest, icons).
  This is the folder to package as a Quest app with Bubblewrap (see `offline/README.md`).

## Where things live

| Area | File |
| --- | --- |
| Graphics quality tiers (Quest 1 → PC) | `src/quality.js` |
| Terrain generation, craters, baked lighting | `src/terrain.js` |
| Sky, lights, water, distant hills | `src/sky.js` |
| Trees, rocks, buildings (procedural models) | `src/models.js`, `src/props.js` |
| Ducks (skinned model, animation, name tags) | `src/duck.js` |
| Weapons | `src/weapons.js` |
| Careers, ranks, kit and bonuses | `src/classes.js` |
| Rules: turns, firing, explosions, crates, mines, objectives | `src/battle.js` |
| Enemy AI (physics-simulated aiming, time-sliced) | `src/ai.js` |
| First-person VR + desktop controls | `src/player.js`, `src/input.js` |
| 3D menus, HUD | `src/ui.js`, `src/menus.js`, `src/hud.js` |
| Campaign missions, factions, promotion points | `src/campaign.js` |
| Campaign map (the Pondlands, drawn procedurally) | `src/campaignmap.js` |
| Particles, arcs, lasers | `src/fx.js` |
| Synthesised audio | `src/audio.js` |
| Boot, scene flow, WebXR session | `src/main.js` |

## Raising graphics quality for a newer headset

Rendering reads `ctx.quality` only; game rules, AI and saves never do. To improve a tier,
edit its entry in `TIERS` (`src/quality.js`): render scale, foveation, shadows, grass,
tree density, particle budget, fog distance, water detail and material model. Detection
(Quest 1/2/3/Pro/PC) is in `detectDevice()`. To swap in detailed artist models later,
replace the builders in `src/models.js` / `buildDuckGeometry` in `src/duck.js` for the
higher tiers; gameplay uses its own colliders, so visuals can change freely.

## Duck bodies and your body in VR

Each duck is one skinned mesh (one draw call): a duck's head on a human body in field
uniform, built from primitives in `buildDuckGeometry` (`src/duck.js`). The skeleton has 27
bones: hips, spine, chest, neck, head, bib (the collar feathers); clavicle, upper arm, forearm, hand, three finger bones
per side; thigh, shin, foot per side. Joints use two-bone skin weights, and the forearm
sleeve is partly weighted to the hand so it can stretch a few centimetres.

- **Third person** (`Duck.animate`): procedural walk, idle, swim, tumble, cheer and salute,
  then IK (`src/ik.js`) puts the hands on the weapon. Two-handed weapons hang off the spine
  with their pivot on the right shoulder; `HOLD` lists grip distance, rest pitch, chest
  twist and support-hand position per weapon. `MUZZLE` is shared with `muzzleFor()` in
  `battle.js`, so shots leave from where the barrel is.
- **VR full body** (`Duck.driveVR`, fed by `Player.vrPose`): the neck hangs below the
  headset, the torso bends from there to hips placed between head and feet, crouching
  drops the hips and bends the knees, feet stay planted and step when you move or turn,
  and the arms solve to the controllers. Grip squeezes the fist, trigger curls the index
  finger, and touching the thumbstick or buttons lowers the thumb. The head is hidden from
  your own eyes. `WRIST` and `HANDQ` at the top of `src/player.js` set where the glove sits
  relative to a Touch controller; adjust these if a different controller feels off.
- **On a screen** the same duck stays visible with its head hidden (`Duck.screenBody`): the
  eye stays put while you aim (`EYE_STAND` in `src/player.js`) and only tips forward when you
  look far down (`EYE_PEER`), so you see your chest, belt and feet; your duck holds the real
  weapon low and to the right (`FP` in `src/duck.js`), shots leave its muzzle, and direct-fire
  weapons converge on the crosshair (`Player.crosshairPoint`). Mouse look ignores stray
  jumps, and dragging with any button looks around when the browser won't capture the mouse.
- Setting **Your body** switches between the full body and the old floating gloves/weapon.
- Hit volumes are three spheres (legs, torso, head) in `src/physics.js`.

## Careers and promotions

Modelled on the shape of Hogs of War's promotion tree. Every duck starts as a Private and, at
its first promotion, chooses one of four careers for life; each career has three levels, then
every career goes on to Commando, War Hero and Legend (the final boss is a Legend too).

| Rank | Cost (points) | HP | Heavy Weapons | Engineers | Recon | Medical Corps |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | – | 80 | Private | | | |
| 2 | 1 | 95 | Gunner | Sapper | Scout | Orderly |
| 3 | 1 | 110 | Bombardier | Engineer | Sniper | Medic |
| 4 | 1 | 125 | Artillerist | Saboteur | Infiltrator | Surgeon |
| 5 | 2 | 140 | Commando | | | |
| 6 | 2 | 160 | War Hero | | | |
| 7 | 2 | 200 | Legend | | | |

- **Promotion points** pay for every promotion. Winning a mission earns one
  (`POINTS_VICTORY` in `src/campaign.js`) and bringing every deployed duck home earns a bonus
  one (`POINTS_ALL_SURVIVED`). Each mission pays each medal once (`camp.completed`,
  `camp.flawless`), so replaying can collect a missed bonus but can't farm points. Costs per rank
  are `PROMOTION_COST` and `ELITE_COST` in `src/classes.js`; a whole campaign pays at most 24
  points, and taking one duck from Private to Legend costs 9.
- You spend points in the barracks (a Promote button on each card, showing its cost) or on the
  career screen (`S.career` in `src/menus.js`), which shows the tree, each rank's kit and
  bonuses, and the choice of career for a private. Reinforcements and Pip join as Privates.

- `src/classes.js` holds the whole tree: `RANKS`, `BRANCHES`, the kit for every rank
  (`loadoutFor`), passive bonuses (`perksFor`, described by `perkLines`) and the promotion
  helpers. A duck's rank is `info.rank` (1–7) and its career `info.spec`.
- Bonuses: Heavy Weapons explosions hit harder; Engineers' mines are hidden from the enemy
  and they resist knockback; Recon move faster; Medical Corps heal every turn and their
  medkits splash onto squadmates. Elite ranks keep their old career's bonuses and add
  knockback resistance, mine spotting, regeneration and extra damage.
- New kit: airburst shells (burst 3 m over the ground), TNT, shotgun (seven short-lived
  pellets), medicine darts (heal a squadmate from afar). Free actions that don't end the
  turn: camouflage (lasts until your second turn after, broken by firing or being hit),
  sandbags (a 60 HP wall two metres ahead), jetpack (a hop of up to 24 m) and paradrop (a
  plane drops you anywhere on dry land).
- The computer uses camouflage when it has nothing good to shoot, can't target hidden ducks
  unless one of its own is within 7 m (it goes searching instead), uses medicine darts on
  hurt squadmates, and walks into hidden mines it can't know about.

## Campaign map

The campaign screen is a field map of the Pondlands (`src/campaignmap.js`): thirteen regions,
one per mission plus the Fusiliers' headquarters, washed in the colour of whoever holds them.
The front line runs round the Fusiliers' ground, the line of advance links the missions in
order, flags mark who holds each site, a crown marks an enemy commander, a star marks a mission
won with every duck home, and a CAPTURED stamp marks the region just taken.

- The map is generated, not painted: a noisy island with the Great Pond, Boot Camp Pond and the
  Frozen Firth cut in (`landField`), regions as a warped, weighted Voronoi of the sites (each
  flood-filled so it is one piece), coast ripples from a distance transform, then ink work:
  rivers, terrain symbols per biome, landmarks, ice, ships, compass, key and title cartouche.
  Generation runs a few milliseconds per frame while the menus are up (`campaignMap.work`), so
  the headset never stalls; `REGIONS` and `RIVERS` at the top of the file set the geography.
- Each redraw only composites the cached paper, the ownership wash (rebuilt when ownership
  changes), highlights, route, names and flags. Regions are clickable by their real shape: panel
  hotspots take a `test(x, y)` that looks up the region under the pointer (mouse or VR laser).

## Turns

Turns are timed, not distance-limited: the active duck can walk, swim, hop and jump anywhere
until the turn clock runs out (Settings → Turn timer, 30–120 s; computer turns get 45 s).
A VR teleport hop takes the time walking there would have taken. The computer plans moves of
up to `MOVE_RANGE` metres (`src/ai.js`).

## Tests (headless Chromium + IWER WebXR emulation)

```
node tests/soak.mjs       # AI plays every mission against AI
node tests/vr.mjs         # emulated Quest 1: menus, picking a map region with the laser, hop, turn, weapons, firing, pause
node tests/vr2.mjs        # throws, knockback blackout, losing the duck you're in
node tests/vrbody.mjs     # looking down at your body, hands up, crouch, walking, spectator views, mirror
node tests/screenbody.mjs # standard mode: your body on screen, timed turns, hop time, crosshair aim
node tests/body.mjs       # rig checks in Node: skin weights, holds, VR hand/foot accuracy
node tests/duckshots.mjs  # photo set: menu line-up, weapon holds, gestures
node tests/screens.mjs    # renders every menu screen
node tests/classes.mjs    # promotion points, career tree, barracks, career and map screens, every career's kit, bonuses and abilities
node tests/classphotos.mjs # photo set of every rank and career, abilities, first-person kit
```

The tests expect Playwright's Chromium (they use the copy in `/opt/npm-tools`); adjust
`tests/lib.mjs` and `tests/serve.mjs` for your machine.
