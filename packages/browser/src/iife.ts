import { initPulsemonBrowser, type PulsemonBrowser } from './browser';
import { optionsFromDataset } from './script-tag';

interface Global {
  PulsemonBrowser?: { init: typeof initPulsemonBrowser; instance?: PulsemonBrowser };
}

try {
  if (typeof window !== 'undefined') {
    const g = window as unknown as Global;
    const api: NonNullable<Global['PulsemonBrowser']> = g.PulsemonBrowser ?? { init: initPulsemonBrowser };
    api.init = initPulsemonBrowser;
    g.PulsemonBrowser = api;
    // currentScript is only set while this script's top level runs, so read it now.
    const script = document.currentScript as HTMLScriptElement | null;
    if (script?.dataset.endpoint && script.dataset.key && !api.instance) {
      api.instance = initPulsemonBrowser(optionsFromDataset({ ...script.dataset }));
    }
  }
} catch {
  // never throw into the host page
}
