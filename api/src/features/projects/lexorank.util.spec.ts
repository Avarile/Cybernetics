import {
  evenlySpacedRanks,
  initialRank,
  needsRebalance,
  rankBetween,
} from './lexorank.util';

describe('lexorank', () => {
  it('produces a rank between two others', () => {
    const mid = rankBetween('a', 'c');
    expect(mid > 'a').toBe(true);
    expect(mid < 'c').toBe(true);
  });

  it('produces a rank before everything', () => {
    const first = rankBetween(null, 'b');
    expect(first < 'b').toBe(true);
  });

  it('produces a rank after everything', () => {
    const last = rankBetween('y', null);
    expect(last > 'y').toBe(true);
  });

  it('handles adjacent ranks by going deeper instead of failing', () => {
    // 'a' and 'b' have no character between them; the rank grows a character.
    const mid = rankBetween('a', 'b');
    expect(mid > 'a').toBe(true);
    expect(mid < 'b').toBe(true);
    expect(mid.length).toBeGreaterThan(1);
  });

  it('survives repeated insertion at the same point', () => {
    // The pathological case for any ordering scheme: always drop the new card
    // immediately after the first one.
    let lo = 'a';
    const hi = 'b';
    for (let i = 0; i < 50; i++) {
      const next = rankBetween(lo, hi);
      expect(next > lo).toBe(true);
      expect(next < hi).toBe(true);
      lo = next;
    }
  });

  it('keeps a whole reordered list sorted', () => {
    const ranks = [initialRank()];
    // Insert at the front, the back and the middle, then check the ordering
    // holds under a plain string sort — which is what Postgres will do.
    ranks.unshift(rankBetween(null, ranks[0]));
    ranks.push(rankBetween(ranks[ranks.length - 1], null));
    ranks.splice(1, 0, rankBetween(ranks[0], ranks[1]));
    expect([...ranks].sort()).toEqual(ranks);
  });

  it('rejects bounds in the wrong order, rather than silently misplacing', () => {
    expect(() => rankBetween('c', 'a')).toThrow(/before < after/);
    expect(() => rankBetween('a', 'a')).toThrow(/before < after/);
  });

  describe('rebalancing', () => {
    it('flags ranks that have grown long', () => {
      expect(needsRebalance(['a', 'aaaaaaaaaaaaaa'])).toBe(true);
      expect(needsRebalance(['a', 'b', 'c'])).toBe(false);
    });

    it('spaces a list evenly and in order', () => {
      const ranks = evenlySpacedRanks(5);
      expect(ranks).toHaveLength(5);
      expect([...ranks].sort()).toEqual(ranks);
    });

    it('returns nothing for an empty list', () => {
      expect(evenlySpacedRanks(0)).toEqual([]);
    });
  });
});
