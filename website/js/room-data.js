/* Where the screens are in the room's paintings, in painting pixels (the wide painting is 1664 x 928, the tall one 832 x 1792).
   `q` is each device's glass, corners in the order top left, top right, bottom right, bottom left, measured on the painting itself:
   the light uses it to find the screen nearest the hand. `lit` is the patch of the same painting with that screen awake: the
   painting's own glass reflections, its rim above the picture and the light on the furniture only, cut out at `x`, `y`, `w` and `h`
   and shown over the dark room. A page never bends a picture onto a screen. */
window.RENPLAY_ROOMS = {
  wide: {
    w: 1664, h: 928,
    laptop: { q: [[1285.1, 273.3], [1511.9, 278.1], [1483.3, 476.7], [1257, 445.5]] },
    tablet: { q: [[699.4, 349.5], [855.7, 355.6], [828.2, 499.7], [665.8, 484.4]] },
    phone: { q: [[270.2, 726.1], [355.8, 702.8], [430.4, 807.7], [327.8, 829.2]] },
  },
  tall: {
    w: 832, h: 1792,
    laptop: { q: [[639.3, 687.2], [772.5, 703.9], [748.8, 802.1], [618, 778]] },
    tablet: { q: [[389.1, 890.5], [506.4, 891.1], [505, 1042.6], [381.3, 1041.1]] },
    phone: { q: [[56.7, 1122.5], [89.3, 1103.1], [175.6, 1139.3], [134, 1159.1]] },
  },
}
const lit = (kind, name, x, y, w, h, sizes) => ({
  x, y, w, h,
  avif: Object.fromEntries(sizes.map((s) => [s, `/img/screens/${kind}-${name}-${s}.avif`])),
  webp: Object.fromEntries(sizes.map((s) => [s, `/img/screens/${kind}-${name}-${s}.webp`])),
})
window.RENPLAY_LIT_ROOMS = {
  wide: {
    laptop: lit('wide', 'laptop', 1023, 278, 641, 375, [1200, 1600]),
    tablet: lit('wide', 'tablet', 607, 345, 343, 227, [1200, 1600]),
    phone: lit('wide', 'phone', 220, 683, 302, 202, [1200, 1600]),
  },
  tall: {
    laptop: lit('tall', 'laptop', 518, 687, 314, 190, [832]),
    tablet: lit('tall', 'tablet', 272, 886, 331, 235, [832]),
    phone: lit('tall', 'phone', 22, 1078, 212, 172, [832]),
  },
}
