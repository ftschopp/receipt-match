import { describe, expect, it } from 'vitest';
import { jaroWinkler, levenshtein, merchantSimilarity, merchantTokens, tokenSetRatio } from '../../src/domain/text';

describe('merchantTokens', () => {
  it.each([
    ['REST LA DOCENA CDMX', ['docena']],
    ['La Docena Oyster Bar', ['docena', 'oyster', 'bar']],
    ['STARBUCKS 1123', ['starbucks']],
    ['UBER *TRIP', ['uber', 'trip']],
    ['NOTION.SO', ['notion']],
    ['Notion Labs, Inc.', ['notion', 'labs']],
    ['Café Ñandú S.A. de C.V.', ['cafe', 'nandu']],
    ['SQ *BLUE BOTTLE', ['blue', 'bottle']],
  ])('normalizes %s', (name, tokens) => {
    expect(merchantTokens(name)).toEqual(tokens);
  });
});

describe('string distances', () => {
  it('levenshtein counts edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('jaro-winkler rewards shared prefixes', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });

  it('token set ratio is 1 when one name contains the other', () => {
    expect(tokenSetRatio(['docena'], ['docena', 'oyster', 'bar'])).toBe(1);
  });
});

describe('merchantSimilarity', () => {
  it('matches a descriptor to the receipt name of the same business', () => {
    expect(merchantSimilarity('La Docena Oyster Bar', 'REST LA DOCENA CDMX').score).toBe(1);
    expect(merchantSimilarity('Starbucks Coffee', 'STARBUCKS 1123').score).toBe(1);
    expect(merchantSimilarity('Notion Labs, Inc.', 'NOTION.SO').score).toBe(1);
  });

  it('tolerates truncated or misspelled descriptor words', () => {
    expect(merchantSimilarity('Starbucks Coffee', 'STARBCKS 1123').score).toBe(1);
    expect(merchantSimilarity('Liverpool Insurgentes', 'LIVERPOOL INSURGENT').score).toBe(1);
  });

  it('scores unrelated businesses low', () => {
    expect(merchantSimilarity('OXXO', 'UBER *TRIP').score).toBeLessThan(0.5);
    expect(merchantSimilarity('Vinos y Licores', 'STARBUCKS 1123').score).toBeLessThan(0.5);
  });

  it('scores 0 when a name has no meaningful tokens', () => {
    expect(merchantSimilarity('S.A. de C.V.', 'OXXO 4421').score).toBe(0);
  });
});
