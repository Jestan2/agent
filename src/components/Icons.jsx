// src/components/Icons.jsx
export const Plus = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export const Mic = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
    <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <path d="M5 12a7 7 0 0 0 14 0M12 19v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export const Voice = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
    <path d="M4 10h3l3 8 4-16 3 8h3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const Send = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
  </svg>
);

export const Copy = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
    <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <rect x="5" y="5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
);

export const Kebab = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
    <circle cx="5" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="19" cy="12" r="1.5" fill="currentColor"/>
  </svg>
);

// src/components/Icons.jsx
export const Menu = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const X = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
  </svg>
);

