import { mount } from 'svelte'

import './app.css'
import App from './App.svelte'

const target = document.getElementById('app')
if (!target) {
  throw new Error('Timer App: mount element #app is missing from index.html')
}

mount(App, { target })
