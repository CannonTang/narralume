# Third-party notices

NarraLume is licensed under Apache-2.0. Its npm runtime and development dependencies remain governed by their publishers' licenses. The exact name, version, usage scope, and SPDX expression derived from `package-lock.json` are recorded in [`docs/third-party-licenses.csv`](docs/third-party-licenses.csv) and checked by `npm run licenses:check`.

Reviewed license families include MIT/MIT-0, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, MPL-2.0 and Unicode-style permissive terms. Notable alternatives or additional terms are:

- DOMPurify is offered under MPL-2.0 or Apache-2.0; this distribution relies on the Apache-2.0 option.
- JSZip is offered under MIT or GPL-3.0-or-later; this distribution relies on the MIT option.
- pako includes MIT and Zlib terms.
- Optional libvips binaries in the development toolchain include LGPL-3.0-or-later components; they are not part of NarraLume's Windows launcher runtime.
- `caniuse-lite` browser compatibility data is CC-BY-4.0 and is used only by the build toolchain.

The demo cover in `assets/narralume-demo-cover.jpg` is derived from [Night Sky - Boney Mountain](<https://commons.wikimedia.org/wiki/File:Night_Sky_-_Boney_Mountain_(12957596483).jpg>), photographed by Santa Monica Mountains National Recreation Area. Wikimedia Commons identifies the source as a work of the U.S. National Park Service and marks it as public domain. The source image is retained as `assets/narralume-cover-source.jpg` for provenance.

The installed packages include their own license and notice files. Release archives must preserve those files inside `node_modules`; removing them is not supported. Projects referenced in design/research documents were studied for patterns but their source is not copied into NarraLume.
