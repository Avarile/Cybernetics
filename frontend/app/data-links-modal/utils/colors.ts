export const GROUP_COLORS: Record<number, string> = {
  0:  '#4b5563',
  1:  '#1d4ed8',
  2:  '#b91c1c',
  3:  '#065f46',
  4:  '#92400e',
  5:  '#5b21b6',
  6:  '#9d174d',
  7:  '#c2410c',
  8:  '#0e7490',
  9:  '#3f6212',
  10: '#7e22ce',
};

export const GROUP_LABELS: Record<number, string> = {
  1:  'Enterprise client',
  2:  'Mid-market client',
  3:  'Small business client',
  4:  'Individual client',
  10: 'Sales rep',
};

export const getColor = (group: number): string =>
  GROUP_COLORS[group % Object.keys(GROUP_COLORS).length] ?? '#888888';
