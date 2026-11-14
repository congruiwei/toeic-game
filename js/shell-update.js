// A cold home screen may adopt a newer complete offline package. Existing practice
// and exam screens keep their document and never reload in response to a worker.
export function watchShellUpdates(registration, mayReload, openedUnder) {
  const sw = navigator.serviceWorker;
  let previous = openedUnder;
  let touched = false;
  let reloading = false;
  let asked = null;
  function checkpoint() {
    return !touched && !document.hidden && mayReload();
  }
  function activate(worker) {
    if (worker && previous && asked !== worker && checkpoint()) {
      asked = worker;
      worker.postMessage({type:'activate-ready-shell'});
    }
  }
  function installed() {
    const worker = registration.installing;
    if (!worker) return;
    const check = () => {
      if (worker.state === 'installed') activate(registration.waiting || worker);
    };
    worker.addEventListener('statechange', check);
    check();
  }
  for (const event of ['pointerdown','keydown','click']) {
    document.addEventListener(event, () => { touched = true; }, {capture:true, once:true});
  }
  function changed() {
    const next = sw.controller;
    const hadController = Boolean(previous);
    previous = next;
    if (hadController && next && !reloading && checkpoint()) {
      reloading = true;
      location.reload();
    }
  }
  sw.addEventListener('controllerchange', changed);
  if (previous !== sw.controller) changed();
  registration.addEventListener('updatefound', installed);
  installed();
  activate(registration.waiting);
  if (navigator.onLine && sw.controller) registration.update().catch(() => {});
}
