import type { LineItem } from '../types';

export type Category =
  | 'alcohol'
  | 'lodging'
  | 'fuel'
  | 'transport'
  | 'electronics'
  | 'software'
  | 'food'
  | 'groceries';

/**
 * Keywords per category, Spanish and English. Keywords of 4+ letters also match as a prefix
 * ("taco" → "tacos", "cerv" → "cerveza"); shorter ones must match a whole word.
 * Order matters: the first category that matches wins ("michelada con camarón" is alcohol).
 */
const KEYWORDS: [Category, string[]][] = [
  ['alcohol', ['cerv', 'beer', 'vino', 'wine', 'tequila', 'mezcal', 'whisk', 'vodka', 'ron', 'rum', 'gin',
    'margarita', 'michelada', 'mojito', 'cocktail', 'coctel', 'champa', 'brandy', 'cognac', 'sangria',
    'corona', 'heineken', 'tecate', 'quilmes', 'stella', 'birra', 'fernet', 'malbec', 'cabernet', 'espumante',
    'licor', 'liquor', 'cuba', 'carajillo', 'aperol', 'spritz', 'gancia']],
  ['lodging', ['habitacion', 'room', 'noche', 'night', 'hospedaje', 'alojamiento', 'estancia', 'stay',
    'hotel', 'suite', 'lodging']],
  // "premium" is left out on purpose: "hamburguesa premium" would read as fuel.
  ['fuel', ['nafta', 'infinia', 'gasoil', 'magna', 'diesel', 'gasolina', 'litros', 'lts', 'combustible', 'fuel']],
  ['transport', ['viaje', 'trip', 'tarifa', 'fare', 'peaje', 'toll', 'taxi', 'remis', 'vuelo', 'flight',
    'transporte', 'estacionamiento', 'parking', 'cochera', 'casetas', 'caseta']],
  ['electronics', ['cable', 'cargador', 'charger', 'audifonos', 'headphone', 'mouse', 'teclado',
    'keyboard', 'laptop', 'monitor', 'usb', 'adaptador', 'adapter', 'bateria', 'battery']],
  ['software', ['subscription', 'suscripcion', 'license', 'licencia', 'seat', 'monthly', 'mensual',
    'annual', 'anual', 'workspace']],
  ['food', ['taco', 'comida', 'menu', 'sandwich', 'cafe', 'coffee', 'latte', 'capuchino', 'cappuccino',
    'americano', 'espresso', 'ensalada', 'salad', 'pizza', 'burger', 'hamburguesa', 'papas', 'fries',
    'pollo', 'chicken', 'carne', 'arrachera', 'pescado', 'fish', 'camaron', 'shrimp', 'ostion', 'oyster',
    'guacamole', 'quesadilla', 'enchilada', 'torta', 'sopa', 'soup', 'postre', 'dessert', 'pastel', 'cake',
    'agua', 'refresco', 'soda', 'jugo', 'juice', 'limonada', 'horchata', 'jamaica', 'desayuno', 'breakfast',
    'almuerzo', 'lunch', 'cena', 'dinner', 'muffin', 'croissant', 'bagel', 'frappe', 'mocha',
    'chilaquiles', 'pastor', 'birria', 'pozole', 'tostada', 'ceviche', 'aguachile', 'mole', 'flan',
    'medialuna', 'empanada', 'milanesa', 'bife', 'asado', 'provoleta', 'choripan', 'lomo', 'cortado', 'tostado',
    'alfajor', 'facturas', 'ravioles', 'noquis', 'sorrentinos', 'parrillada', 'ensalada', 'gaseosa']],
  ['groceries', ['almacen', 'yerba', 'galletitas', 'abarrotes', 'leche', 'milk', 'huevo', 'eggs', 'arroz', 'rice', 'frijol', 'aceite',
    'azucar', 'sugar', 'detergente', 'papel', 'jabon', 'soap', 'shampoo', 'despensa']],
];

function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function keywordMatches(word: string, keyword: string): boolean {
  return keyword.length >= 4 ? word.startsWith(keyword) : word === keyword;
}

/** The category of a single line item, or null when no keyword matches. */
export function classifyLineItem(description: string): Category | null {
  const ws = words(description);
  for (const [category, keywords] of KEYWORDS) {
    if (ws.some((w) => keywords.some((k) => keywordMatches(w, k)))) return category;
  }
  return null;
}

export type ReceiptClassification = {
  /** Categories that make up at least `minCategoryShare` of the classified items. */
  categories: Category[];
  /** Share of the receipt (by amount, or by item count when amounts are missing) that was classified. */
  classifiedShare: number;
  items: { description: string; category: Category | null }[];
};

export function classifyReceipt(lineItems: LineItem[], minCategoryShare: number): ReceiptClassification {
  const items = lineItems.map((li) => ({ description: li.description, category: classifyLineItem(li.description) }));
  if (items.length === 0) return { categories: [], classifiedShare: 0, items };

  const useAmounts = lineItems.every((li) => li.amount && li.amount.amountMinor > 0);
  const weightOf = (i: number) => (useAmounts ? lineItems[i]!.amount!.amountMinor : 1);

  const totalWeight = items.reduce((sum, _, i) => sum + weightOf(i), 0);
  const byCategory = new Map<Category, number>();
  let classifiedWeight = 0;
  items.forEach((item, i) => {
    if (!item.category) return;
    classifiedWeight += weightOf(i);
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + weightOf(i));
  });

  const categories = [...byCategory.entries()]
    .filter(([, weight]) => classifiedWeight > 0 && weight / classifiedWeight >= minCategoryShare)
    .sort((a, b) => b[1] - a[1])
    .map(([category]) => category);

  return { categories, classifiedShare: classifiedWeight / totalWeight, items };
}
