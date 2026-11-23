// Sprite atlas for assets/office-sheet.png (PixelOfficeAssets by 2dPig, CC0).
// Rects were measured from the sheet's opaque pixel islands: { x, y, w, h } in sheet pixels.

export const SHEET_URL = 'assets/office-sheet.png';
export const SHEET_SIZE = Object.freeze({ w: 256, h: 160 });

const rect = (x, y, w, h) => Object.freeze({ x, y, w, h });

export const SPRITES = Object.freeze({
  sky: rect(0, 0, 256, 38),

  chairRed: rect(6, 41, 11, 22),
  chairYellow: rect(19, 41, 11, 22),
  chairGreen: rect(32, 41, 11, 22),
  chairBlue: rect(45, 41, 11, 22),
  chairWhite: rect(58, 41, 11, 22),
  chairGray: rect(71, 41, 11, 22),

  tableSmall: rect(85, 47, 26, 16),
  tableLong: rect(115, 47, 40, 16),

  partition: rect(171, 44, 79, 17),
  deskA: rect(188, 63, 17, 19),
  deskB: rect(213, 63, 17, 19),
  post: rect(207, 63, 4, 27),

  plant: rect(170, 65, 14, 19),
  couchGray: rect(119, 66, 33, 15),
  couchBlue: rect(120, 83, 33, 16),
  couchGreen: rect(120, 102, 33, 16),
  couchOrange: rect(120, 121, 33, 16),

  whiteboard: rect(234, 81, 17, 11),
  window: rect(59, 96, 26, 21),
  windowNote: rect(88, 96, 26, 21),
  door: rect(98, 120, 16, 31),

  coffeeMaker: rect(159, 91, 7, 11),
  mug: rect(169, 95, 8, 7),
  flagIN: rect(179, 94, 12, 9),
  flagUK: rect(193, 94, 12, 9),
  flagUS: rect(207, 94, 12, 9),
  picBlue: rect(222, 94, 6, 8),
  picSunset: rect(230, 94, 6, 8),
  picLandscape: rect(239, 94, 11, 8),

  paperA: rect(183, 107, 6, 8),
  paperB: rect(192, 107, 6, 9),
  phone: rect(200, 107, 9, 9),
  magnets: rect(217, 107, 6, 8),
  binderRed: rect(211, 119, 11, 8),
  binderBlue: rect(211, 129, 11, 8),
  binderGreen: rect(211, 140, 11, 8),
  tray: rect(211, 151, 10, 6),

  pc: rect(233, 106, 15, 19),

  person0: rect(2, 105, 15, 23),
  person1: rect(19, 104, 19, 24),
  person2: rect(40, 107, 13, 21),
  person3: rect(3, 132, 17, 23),
  person4: rect(22, 132, 17, 23),

  cat: rect(65, 129, 17, 14),
  corgi: rect(59, 146, 24, 11),

  binGreen: rect(116, 143, 9, 14),
  binRed: rect(126, 143, 9, 14),
  binBlue: rect(136, 143, 9, 14),
  cooler: rect(147, 140, 9, 17),
  vending: rect(159, 123, 24, 34),
  fridge: rect(184, 126, 24, 31),
});

export const PEOPLE = Object.freeze(['person0', 'person1', 'person2', 'person3', 'person4']);
