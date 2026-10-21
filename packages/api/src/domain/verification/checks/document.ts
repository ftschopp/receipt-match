import { formatMoney } from '../../money';
import type { Money } from '../../types';
import type { Check } from '../types';

const EDITING_SOFTWARE =
  /photoshop|gimp|canva|pixelmator|affinity|lightroom|snapseed|picsart|firefly|midjourney|dall|stable diffusion|openai|chatgpt|gemini|imagen/i;

function sameCurrency(amounts: (Money | null)[]): amounts is Money[] {
  const present = amounts.filter((a): a is Money => a !== null);
  return present.length === amounts.length && present.every((a) => a.currency === present[0]!.currency);
}

export const lineItemsArithmeticCheck: Check = (input, config) => {
  const { lineItems, subtotal, total } = input.extraction;
  // Item prices may exclude tax (they add up to the subtotal) or include it, as is usual on
  // Mexican tickets (they add up to the total). Either convention is fine.
  const references = [subtotal.value, total.value].filter((r): r is Money => r !== null);
  const amounts = lineItems.map((li) => li.amount);
  if (references.length === 0 || amounts.length === 0 || !sameCurrency([...references, ...amounts])) return [];

  const sum = amounts.reduce((acc, a) => acc + a!.amountMinor, 0);
  const fits = (ref: Money) => Math.abs(sum - ref.amountMinor) / ref.amountMinor <= config.arithmetic.lineItemsTolerance;
  if (references.some(fits)) return [];

  const itemsSum = { amountMinor: sum, currency: references[0]!.currency };
  const printed = [
    subtotal.value ? `subtotal ${formatMoney(subtotal.value)}` : null,
    total.value ? `total ${formatMoney(total.value)}` : null,
  ].filter(Boolean);
  return [
    {
      code: 'ARITHMETIC_LINE_ITEMS',
      severity: 'moderate',
      title: "Line items don't add up",
      explanation: `The ${lineItems.length} items add up to ${formatMoney(itemsSum)}, which matches neither the ${printed.join(' nor the ')}. Edited or generated receipts often get this wrong.`,
      evidence: { itemsSum, subtotal: subtotal.value, total: total.value },
    },
  ];
};

export const totalArithmeticCheck: Check = (input) => {
  const { subtotal, tax, tip, total } = input.extraction;
  if (!subtotal.value || !total.value) return [];
  const parts = [subtotal.value, tax.value, tip.value];
  if (!sameCurrency([total.value, ...parts.filter((p) => p !== null)])) return [];

  const s = subtotal.value.amountMinor;
  const t = tax.value?.amountMinor ?? 0;
  const g = tip.value?.amountMinor ?? 0;
  const tolerance = parts.filter((p) => p !== null).length; // 1 minor unit per component
  // In Mexico prices often include tax, with IVA printed for information only.
  const explained = [s + t + g, s + g].some((candidate) => Math.abs(candidate - total.value!.amountMinor) <= tolerance);
  if (explained) return [];

  return [
    {
      code: 'ARITHMETIC_TOTAL',
      severity: 'moderate',
      title: "Total doesn't match subtotal, tax and tip",
      explanation:
        `Subtotal ${formatMoney(subtotal.value)}` +
        (tax.value ? ` + tax ${formatMoney(tax.value)}` : '') +
        (tip.value ? ` + tip ${formatMoney(tip.value)}` : '') +
        ` doesn't equal the total ${formatMoney(total.value)}.`,
      evidence: { subtotal: subtotal.value, tax: tax.value, tip: tip.value, total: total.value },
    },
  ];
};

export const editingSoftwareCheck: Check = (input) => {
  const software = input.image.meta.software;
  if (!software || !EDITING_SOFTWARE.test(software)) return [];
  return [
    {
      code: 'EDITING_SOFTWARE',
      severity: 'weak',
      title: 'Image was saved by editing or generation software',
      explanation: `The image metadata names "${software}". Not proof on its own: people crop or annotate genuine receipts too.`,
      evidence: { software },
    },
  ];
};

export const cameraMetadataCheck: Check = (input) => {
  const { format, make, model } = input.image.meta;
  // PDFs are digital-native invoices; JPEGs from messaging apps lose EXIF routinely.
  if (format !== 'png' || make || model) return [];
  return [
    {
      code: 'NO_CAMERA_METADATA',
      severity: 'weak',
      title: 'Image is not a camera photo',
      explanation:
        'PNG without camera make or model. Screenshots and generated images look like this; so do some scanner apps. Worth a closer look, not a verdict.',
      evidence: { format },
    },
  ];
};

export const extractionConfidenceCheck: Check = (input, config) => {
  const { total, date } = input.extraction;
  const low = [
    total.value && total.confidence < config.lowConfidenceThreshold ? `total (${Math.round(total.confidence)}%)` : null,
    date.value && date.confidence < config.lowConfidenceThreshold ? `date (${Math.round(date.confidence)}%)` : null,
  ].filter(Boolean);
  if (low.length === 0) return [];
  return [
    {
      code: 'LOW_EXTRACTION_CONFIDENCE',
      severity: 'weak',
      title: 'Parts of the receipt were hard to read',
      explanation: `Low reading confidence for ${low.join(' and ')}. Check the values against the image.`,
      evidence: { totalConfidence: total.confidence, dateConfidence: date.confidence },
    },
  ];
};

export const documentChecks: Check[] = [
  lineItemsArithmeticCheck,
  totalArithmeticCheck,
  editingSoftwareCheck,
  cameraMetadataCheck,
  extractionConfidenceCheck,
];
