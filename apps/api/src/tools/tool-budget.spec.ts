import { MAX_FETCHES_PER_EXCHANGE, TOOL_TOTAL_MAX_CHARS, ToolBudget } from './tool-budget';

describe('ToolBudget', () => {
  it('claimChars returns the text unchanged and decrements when under budget', () => {
    const budget = new ToolBudget();
    const result = budget.claimChars('hello');
    expect(result).toBe('hello');
    expect(budget.charsRemaining).toBe(TOOL_TOTAL_MAX_CHARS - 5);
  });

  it('claimChars truncates exactly at the remaining boundary', () => {
    const budget = new ToolBudget();
    budget.charsRemaining = 3;
    const result = budget.claimChars('hello');
    expect(result).toBe('hel');
    expect(budget.charsRemaining).toBe(0);
  });

  it('claimChars returns empty once the budget is exhausted', () => {
    const budget = new ToolBudget();
    budget.charsRemaining = 0;
    expect(budget.claimChars('anything')).toBe('');
    expect(budget.charsRemaining).toBe(0);
  });

  it('claimFetch allows exactly MAX_FETCHES_PER_EXCHANGE calls then returns false', () => {
    const budget = new ToolBudget();
    const results: boolean[] = [];
    for (let i = 0; i < MAX_FETCHES_PER_EXCHANGE + 1; i++) {
      results.push(budget.claimFetch());
    }
    expect(results).toEqual([
      ...Array(MAX_FETCHES_PER_EXCHANGE).fill(true),
      false,
    ]);
    expect(budget.fetchesRemaining).toBe(0);
  });
});
