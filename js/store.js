// App state: drill library, editing draft and settings.
import { loadDrills, saveDrills, normalizeDrill } from './core/drills.js';

const SETTINGS_KEY = 'novaplus.settings.v1';

export const store = {
  drills: loadDrills(),
  draft: null,       // drill being edited (deep copy until saved)
  draftDirty: false,
  settings: { countdown: true, countdownSecs: 3, device: 'nova', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') },

  get(id) {
    return this.drills.find(d => d.id === id);
  },

  upsert(drill) {
    const d = normalizeDrill({ ...drill, updatedAt: Date.now() });
    const i = this.drills.findIndex(x => x.id === d.id);
    if (i >= 0) this.drills[i] = d; else this.drills.unshift(d);
    saveDrills(this.drills);
    return d;
  },

  remove(ids) {
    this.drills = this.drills.filter(d => !ids.includes(d.id));
    saveDrills(this.drills);
  },

  add(list) {
    this.drills.unshift(...list);
    saveDrills(this.drills);
  },

  saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  },

  startDraft(drill) {
    this.draft = structuredClone(drill);
    this.draftDirty = false;
  },
};
