export type Theme = 'light' | 'dark';

type Swatch = { stroke: [string, string]; fill: [string, string] };

// [light, dark(chalkboard)]
export const PALETTE: Record<string, Swatch> = {
  ink: { stroke: ['#1f2328', '#ece8df'], fill: ['#3b4048', '#d9d4c8'] },
  gray: { stroke: ['#868e96', '#a9b1b9'], fill: ['#e9ecef', '#3a4448'] },
  red: { stroke: ['#e03131', '#ff8f8f'], fill: ['#ffc9c9', '#6a3434'] },
  orange: { stroke: ['#e8590c', '#ffae5c'], fill: ['#ffd8a8', '#6b4524'] },
  yellow: { stroke: ['#e67700', '#ffd95c'], fill: ['#ffec99', '#6b5d22'] },
  green: { stroke: ['#2f9e44', '#79e08a'], fill: ['#b2f2bb', '#2b5534'] },
  teal: { stroke: ['#0c8599', '#6fdcea'], fill: ['#a6f0e8', '#215457'] },
  blue: { stroke: ['#1971c2', '#82c7ff'], fill: ['#a5d8ff', '#24456b'] },
  violet: { stroke: ['#6741d9', '#bba3ff'], fill: ['#d0bfff', '#45366f'] },
  pink: { stroke: ['#c2255c', '#ff8fb8'], fill: ['#fcc2d7', '#66294a'] },
};

export const COLOR_ORDER = ['ink', 'gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'];

const ti = (t: Theme) => (t === 'light' ? 0 : 1);

export function strokeColor(token: string, theme: Theme) {
  return PALETTE[token]?.stroke[ti(theme)] ?? token;
}
export function fillColor(token: string, theme: Theme) {
  if (token === 'none') return 'transparent';
  return PALETTE[token]?.fill[ti(theme)] ?? token;
}

export const THEME = {
  light: {
    paper: '#fbfaf6',
    dot: '#d8d2c4',
    ink: '#1f2328',
    selection: '#4c6ef5',
    selectionFill: 'rgba(76,110,245,0.06)',
    note: '#fff1a8',
    noteDark: '#fff1a8',
    laser: '#ff3b5c',
  },
  dark: {
    paper: '#1f2826',
    dot: '#34403d',
    ink: '#ece8df',
    selection: '#8aa4ff',
    selectionFill: 'rgba(138,164,255,0.08)',
    note: '#5c5530',
    noteDark: '#5c5530',
    laser: '#ff6b81',
  },
};
