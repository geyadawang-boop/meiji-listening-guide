import React from 'react'
import {createRoot} from 'react-dom/client'
import App from '@renderer/app/App'
import {ToastHost} from '@renderer/ui/ToastHost'
import '@renderer/styles/tailwind.css'
createRoot(document.getElementById('root')!).render(
 <React.StrictMode>
  <ToastHost />
  <App />
 </React.StrictMode>
)
