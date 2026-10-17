export function ThemeIcon({dark}: {dark: boolean}) {
 return (
  <svg
   className="theme-switch-icon"
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth="1.7"
   strokeLinecap="round"
   strokeLinejoin="round"
   aria-hidden="true"
  >
   {dark ? (
    <>
     <circle cx="12" cy="12" r="4" />
     <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
   ) : (
    <path d="M20.5 14a8.5 8.5 0 0 1-10.5-10.5A8.5 8.5 0 1 0 20.5 14Z" />
   )}
  </svg>
 )
}
