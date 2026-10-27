import { createContext } from 'react';
import type { Place } from './core';
import type { FoodPreferences, HistorySignal } from './recommendations';
export const AssistantState = createContext<{ nearby: Place[]; history: HistorySignal[]; preferences: FoodPreferences; openPlace: (place: Place) => void } | null>(null);
