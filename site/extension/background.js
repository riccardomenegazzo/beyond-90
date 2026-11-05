// The toolbar button opens Beyond 90 in a tab of its own. Nothing else runs in the background: no permissions,
// no access to the pages you visit, no network.
const api = globalThis.browser ?? globalThis.chrome;
api.action.onClicked.addListener(() => api.tabs.create({ url: api.runtime.getURL("index.html") }));
