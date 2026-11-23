// Мост между интерфейсом и главным процессом: window.xc
const { contextBridge, ipcRenderer } = require("electron");

const call = (ch) => (arg) => ipcRenderer.invoke(ch, arg);
const on = (ch) => (fn) => {
  const h = (_e, data) => fn(data);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld("xc", {
  state: { get: call("state:get"), set: call("state:set") },
  models: { list: call("models:list"), refresh: call("models:refresh"), recent: call("models:recent"), addCustom: call("models:addCustom"), onUpdated: on("models:updated") },
  image: { choose: call("image:choose") },
  limits: { reset: call("limits:reset") },
  net: { check: call("net:check"), onState: on("net:state") },
  chatgpt: { login: call("chatgpt:login"), logout: call("chatgpt:logout"), info: call("chatgpt:info"), limits: call("chatgpt:limits") },
  providers: { list: call("providers:list"), setKey: call("providers:setKey"), addCustom: call("providers:addCustom"), removeCustom: call("providers:removeCustom") },
  projects: { pick: call("projects:pick"), open: call("projects:open") },
  sessions: { list: call("sessions:list"), get: call("sessions:get"), save: call("sessions:save"), remove: call("sessions:delete") },
  agent: { run: call("agent:run"), stop: call("agent:stop"), approve: call("agent:approve"), compress: call("agent:compress"), onEvent: on("agent:event") },
  openExternal: call("open:external"),
  auth: { get: call("auth:get"), refresh: call("auth:refresh"), start: call("auth:start"), open: call("auth:open"), cancel: call("auth:cancel"), logout: call("auth:logout"), onChanged: on("auth:changed") },
  backup: { list: call("backup:list"), restore: call("backup:restore") },
  update: { get: call("update:get"), download: call("update:download"), check: call("update:check"), onState: on("update:state") },
  prefs: { get: call("prefs:get"), set: call("prefs:set"), onTheme: on("prefs:theme"), onChanged: on("prefs:changed") },
  agents: { save: call("agents:save"), remove: call("agents:remove"), generate: call("agents:generate") },
  projectsRemove: call("projects:remove"),
  importChats: { scan: call("import:scan"), run: call("import:run") },
  files: { search: call("files:search") },
  bug: { send: call("bug:send") },
  privacy: { get: call("privacy:get"), improve: call("privacy:improve"), exportAll: call("privacy:export"), deleteCopies: call("privacy:deleteCopies"), openLocal: call("privacy:openLocal"), deleteLocal: call("privacy:deleteLocal") },
  ext: { list: call("ext:list"), toggle: call("ext:toggle"), importItem: call("ext:import"), remove: call("ext:remove"), addConnector: call("ext:addConnector") },
});
