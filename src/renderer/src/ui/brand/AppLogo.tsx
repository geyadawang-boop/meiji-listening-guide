/** 摘云应用标识：云朵与向下摘取的箭头。 */
export function AppLogo({size = 28}: {size?: number}) {
 return (
  <svg
   width={size}
   height={size}
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth="1.7"
   strokeLinecap="round"
   strokeLinejoin="round"
   aria-hidden="true"
  >
   <path d="M7.4 15.4h9a3.4 3.4 0 0 0 .7-6.72 5 5 0 0 0-9.63-1.6 3.7 3.7 0 0 0-.07 8.32Z" />
   <path d="M12 10.6v6" />
   <path d="m9.8 14.2 2.2 2.2 2.2-2.2" />
   <path d="M6.8 19.6h10.4" />
  </svg>
 )
}
