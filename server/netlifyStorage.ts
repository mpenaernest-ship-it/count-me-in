import { getStore } from '@netlify/blobs';
import {
  normalizeAutomationData,
  prepareAutomationSave,
  type PersistedAutomationData,
} from './whatsappAutomation.ts';
import {
  normalizeScheduleConfig,
  type AutoScheduleConfig,
  type WhatsAppStorageAdapter,
} from './whatsappCore.ts';

const BLOB_STORE_NAME = 'cams-gold-whatsapp';
const AUTOMATION_BLOB_KEY = 'automation-state-v1';
const SCHEDULE_BLOB_KEY = 'legacy-schedule-v1';

let memoryAutomation: PersistedAutomationData | null = null;
let memorySchedule: AutoScheduleConfig | null = null;

const getBlobStoreSafe = () => {
  try {
    return getStore({ name: BLOB_STORE_NAME, consistency: 'strong' });
  } catch (err) {
    console.warn('Netlify Blobs unavailable, using in-memory fallback:', err);
    return null;
  }
};

export const createNetlifyStorageAdapter = (): WhatsAppStorageAdapter => ({
  async loadAutomationData(): Promise<PersistedAutomationData> {
    const store = getBlobStoreSafe();
    if (!store) {
      return memoryAutomation ?? normalizeAutomationData(null);
    }
    try {
      const parsed = (await store.get(AUTOMATION_BLOB_KEY, {
        type: 'json',
      })) as Partial<PersistedAutomationData> | null;
      const normalized = normalizeAutomationData(parsed);
      memoryAutomation = normalized;
      return normalized;
    } catch (err) {
      console.warn('Failed to read automation state from Netlify Blobs:', err);
      return memoryAutomation ?? normalizeAutomationData(null);
    }
  },

  async saveAutomationData(data: PersistedAutomationData): Promise<PersistedAutomationData> {
    const next = prepareAutomationSave(data);
    memoryAutomation = next;
    const store = getBlobStoreSafe();
    if (store) {
      try {
        await store.setJSON(AUTOMATION_BLOB_KEY, next);
      } catch (err) {
        console.error('Failed to persist automation state to Netlify Blobs:', err);
      }
    }
    return next;
  },

  async loadScheduleConfig(): Promise<AutoScheduleConfig> {
    const store = getBlobStoreSafe();
    if (!store) {
      return memorySchedule ?? normalizeScheduleConfig(null);
    }
    try {
      const parsed = (await store.get(SCHEDULE_BLOB_KEY, {
        type: 'json',
      })) as Partial<AutoScheduleConfig> | null;
      const normalized = normalizeScheduleConfig(parsed);
      memorySchedule = normalized;
      return normalized;
    } catch (err) {
      console.warn('Failed to read schedule config from Netlify Blobs:', err);
      return memorySchedule ?? normalizeScheduleConfig(null);
    }
  },

  async saveScheduleConfig(config: AutoScheduleConfig): Promise<AutoScheduleConfig> {
    const next: AutoScheduleConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    };
    memorySchedule = next;
    const store = getBlobStoreSafe();
    if (store) {
      try {
        await store.setJSON(SCHEDULE_BLOB_KEY, next);
      } catch (err) {
        console.error('Failed to persist schedule config to Netlify Blobs:', err);
      }
    }
    return next;
  },
});
