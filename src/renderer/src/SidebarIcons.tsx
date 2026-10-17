// Navigation paths from ElecKoi (AGPL-3.0-only); regular icons from Phosphor Icons (MIT).
export function LoginNavIcon() {
 return (
  <svg viewBox="0 0 24 24" aria-hidden="true">
   <circle cx="12" cy="7.5" r="3.5" />
   <path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" />
  </svg>
 )
}
export function PptExtractNavIcon() {
 return (
  <svg viewBox="0 0 24 24" aria-hidden="true">
   <path d="M7 3v14a2 2 0 0 0 2 2h12M3 7h14a2 2 0 0 1 2 2v12M3 3l2 2M19 3l-2 2M3 19l2-2" />
  </svg>
 )
}
export function MessageNavIcon() {
 return (
  <svg viewBox="0 0 24 24" aria-hidden="true">
   <path
    className="nav-fill message-fill"
    d="M6.2 5.1h11.6a3.2 3.2 0 0 1 3.2 3.2v5.2a3.2 3.2 0 0 1-3.2 3.2h-5.5L7.1 20v-3.3h-.9A3.2 3.2 0 0 1 3 13.5V8.3a3.2 3.2 0 0 1 3.2-3.2Z"
   />
   <path d="M6.2 5.1h11.6a3.2 3.2 0 0 1 3.2 3.2v5.2a3.2 3.2 0 0 1-3.2 3.2h-5.5L7.1 20v-3.3h-.9A3.2 3.2 0 0 1 3 13.5V8.3a3.2 3.2 0 0 1 3.2-3.2Z" />
   <circle className="nav-cutout" cx="9.5" cy="10.9" r="1.15" />
   <circle className="nav-cutout" cx="14.5" cy="10.9" r="1.15" />
  </svg>
 )
}

export function ModelNavIcon() {
 return (
  <svg className="model-nav-cube" viewBox="0 0 24 24" aria-hidden="true">
   <path className="nav-fill model-cube-face" d="M12 2.9 20.2 7.35 12 11.9 3.8 7.35Z" />
   <path className="nav-fill model-cube-face" d="M3.8 7.35 12 11.9v9.2l-8.2-4.45Z" />
   <path className="nav-fill model-cube-face" d="M12 11.9 20.2 7.35v9.3L12 21.1Z" />
   <path d="M12 2.9 20.2 7.35v9.3L12 21.1 3.8 16.65v-9.3Z" />
   <path className="model-cube-inner" d="M3.8 7.35 12 11.9l8.2-4.55M12 11.9v9.2" />
  </svg>
 )
}

export function SettingsIcon() {
 return (
  <svg
   aria-hidden="true"
   className="phosphor-rail-icon"
   xmlns="http://www.w3.org/2000/svg"
   viewBox="0 0 256 256"
   fill="currentColor"
  >
   <path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A112.1,112.1,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.62a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Zm-15,34.91-28.57,16.25a8,8,0,0,0-3,3c-.58,1-1.19,2.06-1.81,3.06a7.94,7.94,0,0,0-1.22,4.21l-.15,32.25a95.89,95.89,0,0,1-25.37,14.3L134,199.13a8,8,0,0,0-3.91-1h-.19c-1.21,0-2.43,0-3.64,0a8.08,8.08,0,0,0-4.1,1l-28.84,16.1A96,96,0,0,1,67.88,201l-.11-32.2a8,8,0,0,0-1.22-4.22c-.62-1-1.23-2-1.8-3.06a8.09,8.09,0,0,0-3-3.06l-28.6-16.29a90.49,90.49,0,0,1,0-28.26L61.67,97.63a8,8,0,0,0,3-3c.58-1,1.19-2.06,1.81-3.06a7.94,7.94,0,0,0,1.22-4.21l.15-32.25a95.89,95.89,0,0,1,25.37-14.3L122,56.87a8,8,0,0,0,4.1,1c1.21,0,2.43,0,3.64,0a8.08,8.08,0,0,0,4.1-1l28.84-16.1A96,96,0,0,1,188.12,55l.11,32.2a8,8,0,0,0,1.22,4.22c.62,1,1.23,2,1.8,3.06a8.09,8.09,0,0,0,3,3.06l28.6,16.29A90.49,90.49,0,0,1,222.9,142.12Z" />
  </svg>
 )
}
export function VideoIcon() {
 return (
  <svg
   aria-hidden="true"
   className="phosphor-rail-icon"
   xmlns="http://www.w3.org/2000/svg"
   viewBox="0 0 256 256"
   fill="currentColor"
  >
   <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm48.24-94.78-64-40A8,8,0,0,0,100,88v80a8,8,0,0,0,12.24,6.78l64-40a8,8,0,0,0,0-13.56ZM116,153.57V102.43L156.91,128Z" />
  </svg>
 )
}
export function NotesIcon() {
 return (
  <svg
   aria-hidden="true"
   className="phosphor-rail-icon"
   xmlns="http://www.w3.org/2000/svg"
   viewBox="0 0 256 256"
   fill="currentColor"
  >
   <path d="M229.66,58.34l-32-32a8,8,0,0,0-11.32,0l-96,96A8,8,0,0,0,88,128v32a8,8,0,0,0,8,8h32a8,8,0,0,0,5.66-2.34l96-96A8,8,0,0,0,229.66,58.34ZM124.69,152H104V131.31l64-64L188.69,88ZM200,76.69,179.31,56,192,43.31,212.69,64ZM224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Z" />
  </svg>
 )
}

export function CloudExportNavIcon() {
 return (
  <svg viewBox="0 0 24 24" aria-hidden="true">
   <path d="M7 17H6a4 4 0 0 1-.6-7.95A6.5 6.5 0 0 1 18 8a4.5 4.5 0 0 1 .5 9H17" />
   <path d="M12 12v9m-3-3 3 3 3-3" />
  </svg>
 )
}

export function IdentityNavIcon() {
 return (
  <svg viewBox="0 0 24 24" aria-hidden="true">
   <circle cx="9" cy="8" r="3" />
   <path d="M3 20v-2a6 6 0 0 1 12 0v2M18 5v6m-3-3h6M18 15h3m-3 4h3" />
  </svg>
 )
}
export function AppearanceNavIcon() {
 return (
  <svg viewBox="0 0 24 24" aria-hidden="true">
   <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.6-3.2c-.7-.9-.1-2.3 1.1-2.3H18a3 3 0 0 0 3-3C21 7.3 17 3 12 3Z" />
   <circle cx="7.5" cy="10" r=".75" />
   <circle cx="11" cy="7" r=".75" />
   <circle cx="15.5" cy="8" r=".75" />
  </svg>
 )
}
