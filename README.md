# Nova+ Custom Drills

A personal controller for the Pongbot **Nova S Pro** and **Halo S Pro**. It
rebuilds the official app's **Custom Drills** section and adds **per-shot
variation**: a ± range on speed, spin, ball height and drop point (and rail
position on the Halo), rolled again for every single shot while the ball order
stays fixed.

Built on [olanga/nova](https://github.com/olanga/nova) (the original app is on
the `main` branch). Protocol details, parameter conversion and ball physics are
taken from the official app; see `../re/FINDINGS.md`.

## Run it

Web Bluetooth needs Chrome or Edge (Android, Windows, macOS, Linux; not iPhone)
and a secure origin:

- **On this PC:** `python tools/serve.py`, then open <http://localhost:8000>.
  This server turns off browser caching, so a normal reload picks up code
  changes. With plain `python -m http.server`, Chrome can keep running old
  code; press Ctrl+Shift+R after updates.
- **On your phone at the table:** host the folder on HTTPS, for example GitHub
  Pages, and open it in Chrome.
- **Without the robot:** add `?mock` (simulated Nova) or `?mock=halo`
  (simulated Halo) to the URL, for example `http://localhost:8000/?mock=halo`.

Drills live in the browser's local storage. Use ··· → Export to back them up.

### Install on your phone

The app is a PWA. Open it in Chrome on Android and choose ⋮ → **Install app**
(or Add to Home screen). It then opens full screen from its own icon.

- **Works offline:** after one visit with internet, it opens without a
  connection. The robot connects over Bluetooth, so no internet is needed at
  the table.
- **Updates:** when online, each launch loads the latest version. If the
  network is slow (over 3 seconds), the saved copy opens instead, and the new
  version is used next time.
- **Adding a file to the app:** list it in `APP_FILES` in `sw.js`.
  `tests/pwa.test.mjs` fails if one is missing.

## Nova vs Halo

The switch at the top of the drill list picks the robot. When you connect, the
app switches to the connected robot's model automatically, and it won't start a
drill made for the other model.

| | Nova S Pro | Halo S Pro |
| --- | --- | --- |
| Positions | 1–9, Standard, Near-Net, plus robot angle on the table | 1 (behind the end line), 2 / 3 (beside the net) |
| Spin direction | 8 directions on the dial; the head is turned by hand, so a drill uses the two directions of one head position | any angle on the dial, set per ball; the head turns by itself |
| Extra | – | Rail position, with its own ± range |

## Flow (same as the official app)

1. **Custom Drills → Mine.** Tap a drill to open Drill Prep. Press and hold to
   select drills for delete or duplicate. Tap Add New to create one.
2. **Select Robot Position.** Choose 1–9, Standard or Near-Net. Orange dots
   show the drop-point coverage from that spot.
3. **Combo Rotation Type** (Nova only). Choose the manual head position.
   Each ball then picks one of its two spin directions.
4. **Edit Combo.**
   - Set the title and the list of balls.
   - Tap a ball to preview it. Press and hold, or tap ✎, to edit it.
   - Drag ☰ to reorder. Drag a ball to the bottom of the screen to delete it.
   - Combo Test serves the combo twice.
5. **Ball settings.** Set Ball Height, Rotation Type (circular dial), Drop
   Point, Rail (Halo), Speed, Spin, Freq. and Number of Repetition, with live
   top and side ball prediction.
   - Tap **±** on Speed, Spin, Ball Height or Drop Point to set a random
     range. The preview shows the spread and the share of varied shots that
     land.
   - Ball Test serves the ball five times, each shot with its own roll.
6. **Drill Prep.** Choose the serve mode (number of combos, or minutes) and
   Sequential or Random order, then Start.
   - The serving screen shows the values of the shot just fired.

## How variation is sent

- **Drills without ± ranges** are uploaded once, and the robot loops them
  itself, exactly like the official app.
- **Drills with ranges** are sent in batches of up to 20 shots. Each repetition
  of a varied ball becomes its own shot with fresh values, and as many whole
  combos as fit go into one upload. There is a short pause when one batch ends
  and the next is uploaded, about once every 20 balls.

## Importing existing drills

- **Official app:** run `python tools/import_official.py` and log in with your
  Pongbot account. It writes `official_drills.json` with your Nova and Halo
  drills; import that file in the app. It keeps the raw server responses in
  `official_raw/`.
- **olanga/nova CSV:** import the CSV directly. Variants of a ball are merged
  into one ball with ± ranges that cover them.
- **Nova+ backup JSON:** import it directly.

## Development

- `node --test tests/core.test.mjs tests/halo.test.mjs tests/pwa.test.mjs` runs the unit tests
  (Nova and Halo physics, framing, variation, scheduler, protocol, import and
  the offline file list).
- No build step. The app is plain ES modules.

## Credits

- Based on [olanga/nova](https://github.com/olanga/nova).
- Numbers use the Bai Jamjuree font (Cadson Demak), licensed under the SIL Open
  Font License 1.1.
- All images are drawn for this app. No artwork from the official app is
  included.
