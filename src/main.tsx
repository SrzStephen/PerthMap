import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserAgent} from '@newrelic/browser-agent/loaders/browser-agent'
import App from './App.tsx'
import './index.css'

const NEW_RELIC_LICENSE_KEY:string = import.meta.env.NEW_RELIC_LICENSE_KEY;
const NEW_RELIC_AGENT_ID:string = import.meta.env.NEW_RELIC_AGENT_ID;
const NEW_RELIC_ACCOUNT_ID:string = import.meta.env.NEW_RELIC_ACCOUNT_ID;

const options = {
  init: {distributed_tracing:{enabled:true},privacy:{cookies_enabled:true},ajax:{deny_list:["bam.nr-data.net"]}}, // NREUM.init
  info: {beacon:"bam.nr-data.net",errorBeacon:"bam.nr-data.net",licenseKey:NEW_RELIC_LICENSE_KEY,applicationID:NEW_RELIC_AGENT_ID,sa:1}, // NREUM.info
  loader_config: {accountID:NEW_RELIC_ACCOUNT_ID,trustKey:NEW_RELIC_ACCOUNT_ID,agentID:NEW_RELIC_AGENT_ID,licenseKey:NEW_RELIC_LICENSE_KEY,applicationID:NEW_RELIC_AGENT_ID} // NREUM.loader_config
}
new BrowserAgent(options)
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App></App>
    </StrictMode>,
)
