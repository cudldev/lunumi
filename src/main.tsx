import React from 'react';import{createRoot}from'react-dom/client';import App from './App';import'./style.css';import'./navigation.css';import'./location-picker.css';import'./food-illustration.css';import'./layout.css';import'./opening-hours.css';
import { scheduleMenuClassifierWarmup } from './menu-classifier';
scheduleMenuClassifierWarmup();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
