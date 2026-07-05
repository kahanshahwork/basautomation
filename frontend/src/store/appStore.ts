/**
 * store/appStore.ts — global app state (Zustand).
 * Mirrors the globals from the original index.html script block.
 * Page-local UI state (modals, inputs) stays in useState within each page.
 */

import { create } from 'zustand';
import type { Client, Quarter, Statement, Category } from '../types';

export type PageName =
  | 'clients' | 'parse' | 'approve' | 'categorize' | 'gst' | 'pnl'
  | 'consolidate'
  | 'vendormemory' | 'categorymanager' | 'aicategorize' | 'aivision';

export type NavStepStatus = 'locked' | 'active' | 'done';

interface NavState {
  parse: NavStepStatus;
  approve: NavStepStatus;
  categorize: NavStepStatus;
  gst: NavStepStatus;
  pnl: NavStepStatus;
}

interface AppState {
  currentPage: PageName;
  setPage: (page: PageName) => void;

  // Context
  activeClientId: number | null;
  activeClientName: string | null;
  activeQuarterId: number | null;
  activeQuarterLabel: string | null;
  activeStatementId: number | null;
  activeStatementName: string | null;
  activeBankId: string | null;

  setClient: (id: number, name: string) => void;
  setQuarter: (id: number, label: string) => void;
  setStatement: (id: number, name?: string, bankId?: string) => void;
  clearStatement: () => void;

  // Cached lists
  clients: Client[];
  quarters: Quarter[];
  statements: Statement[];
  categories: Category[];
  setClients: (c: Client[]) => void;
  setQuarters: (q: Quarter[]) => void;
  setStatements: (s: Statement[]) => void;
  setCategories: (c: Category[]) => void;

  // Nav unlock/done
  navState: NavState;
  unlockNav: (...pages: Array<keyof NavState>) => void;
  markDone: (page: keyof NavState) => void;
  resetNav: () => void;
}

const defaultNav: NavState = {
  parse: 'locked', approve: 'locked', categorize: 'locked', gst: 'locked', pnl: 'locked',
};

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'clients',
  setPage: (page) => set({ currentPage: page }),

  activeClientId: null,
  activeClientName: null,
  activeQuarterId: null,
  activeQuarterLabel: null,
  activeStatementId: null,
  activeStatementName: null,
  activeBankId: null,

  setClient: (id, name) => set({ activeClientId: id, activeClientName: name }),

  setQuarter: (id, label) =>
    set((s) => ({
      activeQuarterId: id,
      activeQuarterLabel: label,
      // selecting a quarter unlocks Step 1 (parse) but resets the rest
      navState: { ...defaultNav, parse: 'active' },
      activeStatementId: s.activeQuarterId === id ? s.activeStatementId : null,
      activeStatementName: s.activeQuarterId === id ? s.activeStatementName : null,
    })),

  setStatement: (id, name, bankId) =>
    set({
      activeStatementId: id,
      activeStatementName: name ?? null,
      activeBankId: bankId ?? null,
    }),

  clearStatement: () => set({ activeStatementId: null, activeStatementName: null, activeBankId: null }),

  clients: [], quarters: [], statements: [], categories: [],
  setClients: (c) => set({ clients: c }),
  setQuarters: (q) => set({ quarters: q }),
  setStatements: (s) => set({ statements: s }),
  setCategories: (c) => set({ categories: c }),

  navState: defaultNav,
  unlockNav: (...pages) =>
    set((state) => {
      const next = { ...state.navState };
      pages.forEach((p) => { if (next[p] === 'locked') next[p] = 'active'; });
      return { navState: next };
    }),
  markDone: (page) => set((state) => ({ navState: { ...state.navState, [page]: 'done' } })),
  resetNav: () => set({ navState: defaultNav }),
}));
