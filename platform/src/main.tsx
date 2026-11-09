import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { RouteTransitionLoader, SiteImagesProvider } from './SiteImages'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SiteImagesProvider><App /><RouteTransitionLoader /></SiteImagesProvider>
    </BrowserRouter>
  </React.StrictMode>,
)