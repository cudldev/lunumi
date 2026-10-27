import { afterEach, expect, it, vi } from 'vitest';
import { currentDevicePrefersCPU, currentModelSize, modelSizeForDevice, MODEL_CONFIGS } from './conversation-config';
import { deferAI, isAIDeferred, markAIWork, wasAIInterrupted } from './model-recovery';
afterEach(() => vi.unstubAllGlobals());
it('uses compact weights for phones, iPad desktop mode, and reported low-memory devices', () => {
  for (const device of [{userAgent:'Mozilla/5.0 (Linux; Android 14; SM-F956B) AppleWebKit/537.36 SamsungBrowser/27.0 Chrome/125 Mobile Safari/537.36'}, {userAgent:'X11 Linux x86_64 SamsungBrowser/27.0 Chrome/125 Safari/537.36'}, {userAgent:'Android Chrome'}, {userAgent:'iPhone Safari'}, {userAgent:'Macintosh Safari',maxTouchPoints:5}, {userAgent:'Desktop Chrome',deviceMemory:4}]) expect(modelSizeForDevice(device)).toBe('compact');
  expect(modelSizeForDevice({userAgent:'Macintosh Safari',maxTouchPoints:0})).toBe('standard');
  expect(modelSizeForDevice({})).toBe('standard');
  vi.stubGlobal('navigator', {userAgent:'iPad'});
  expect(currentModelSize()).toBe('compact'); expect(currentDevicePrefersCPU()).toBe(true);
  vi.stubGlobal('navigator', {userAgent:'Android Chrome'}); expect(currentDevicePrefersCPU()).toBe(true);
  expect(MODEL_CONFIGS.compact.id).toContain('360M');
});
it('persists interrupted-work recovery independently from the choice to defer AI', () => {
  const data = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(key:string)=>data.get(key),setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)});
  markAIWork(true); expect(wasAIInterrupted()).toBe(true);
  deferAI(true); markAIWork(false);
  expect(wasAIInterrupted()).toBe(false); expect(isAIDeferred()).toBe(true);
  deferAI(false); expect(isAIDeferred()).toBe(false);
});
it('works when browser storage is unavailable', () => {
  vi.stubGlobal('localStorage', {getItem:()=>{throw new Error('blocked')},setItem:()=>{throw new Error('blocked')}});
  expect(() => markAIWork(true)).not.toThrow(); expect(wasAIInterrupted()).toBe(false);
});
