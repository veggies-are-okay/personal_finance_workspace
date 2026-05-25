/** Primary navigation model — mirrors the wireframe's left rail. */
export const NAV_ITEMS = [
  { to: '/', label: 'Story', end: true, icon: '✦' },
  { to: '/budget', label: 'Budget', icon: '◧' },
  { to: '/net-worth', label: 'Net Worth', icon: '▲' },
  { to: '/investments', label: 'Investments', icon: '◈' },
  { to: '/debt', label: 'Debt', icon: '▤' },
  { to: '/goals', label: 'Goals', icon: '◎' },
] as const;
