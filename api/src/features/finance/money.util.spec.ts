import {
  add,
  compare,
  convert,
  fromUnits,
  isNegative,
  isZero,
  multiply,
  percentOf,
  subtract,
  sum,
  toUnits,
} from './money.util';

describe('money arithmetic', () => {
  describe('parsing', () => {
    it('round-trips a decimal string', () => {
      expect(fromUnits(toUnits('123.45'))).toBe('123.4500');
    });

    it('treats null and empty as zero', () => {
      expect(fromUnits(toUnits(null))).toBe('0.0000');
      expect(fromUnits(toUnits(''))).toBe('0.0000');
    });

    it('handles negatives', () => {
      expect(fromUnits(toUnits('-5.25'))).toBe('-5.2500');
    });

    it('rejects a non-numeric amount rather than reading it as zero', () => {
      expect(() => toUnits('abc')).toThrow(/not a decimal amount/);
      expect(() => toUnits('1,000')).toThrow(/not a decimal amount/);
    });

    it('truncates precision beyond the column scale', () => {
      // The column holds four places; more than that is the caller's bug, and
      // silently rounding would hide it.
      expect(fromUnits(toUnits('1.123456'))).toBe('1.1234');
    });
  });

  describe('addition', () => {
    it('adds exactly where floats would not', () => {
      // The canonical float failure: 0.1 + 0.2 === 0.30000000000000004.
      expect(add('0.1', '0.2')).toBe('0.3000');
    });

    it('sums a list exactly', () => {
      const cents = Array.from({ length: 10 }, () => '0.1');
      expect(sum(cents)).toBe('1.0000');
    });

    it('subtracts', () => {
      expect(subtract('100.00', '33.33')).toBe('66.6700');
    });

    it('handles large amounts without losing precision', () => {
      // Beyond 2^53, a float silently drops the last digits.
      expect(add('99999999999999.9999', '0.0001')).toBe('100000000000000.0000');
    });
  });

  describe('multiplication', () => {
    it('multiplies an hourly rate by fractional hours', () => {
      expect(multiply('150.00', '7.5')).toBe('1125.0000');
    });

    it('rounds half up', () => {
      expect(multiply('0.0001', '0.5')).toBe('0.0001');
    });

    it('handles a negative factor', () => {
      expect(multiply('-10.00', '3')).toBe('-30.0000');
    });
  });

  describe('percentages', () => {
    it('computes tax', () => {
      expect(percentOf('100.00', '10')).toBe('10.0000');
    });

    it('computes an awkward rate exactly', () => {
      expect(percentOf('1000.00', '8.25')).toBe('82.5000');
    });

    it('is zero for a zero rate', () => {
      expect(percentOf('100.00', '0')).toBe('0.0000');
    });
  });

  describe('conversion', () => {
    it('applies an FX rate', () => {
      expect(convert('100.00', '1.5432')).toBe('154.3200');
    });
  });

  describe('predicates', () => {
    it('detects sign and zero', () => {
      expect(isNegative('-0.0001')).toBe(true);
      expect(isNegative('0.0000')).toBe(false);
      expect(isZero('0')).toBe(true);
      expect(isZero('0.0001')).toBe(false);
    });

    it('compares without parsing as a number', () => {
      expect(compare('10.00', '9.99')).toBe(1);
      expect(compare('9.99', '10.00')).toBe(-1);
      expect(compare('10.0000', '10')).toBe(0);
    });
  });
});
