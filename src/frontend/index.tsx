/* @refresh reload */
import { render } from 'solid-js/web'
import './css/index.css'
import App from '../Frontend/App.tsx'

const root = document.getElementById('root')

render(() => <App />, root!)
