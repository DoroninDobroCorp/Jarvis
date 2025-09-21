import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { TaskPathInfo } from './taskUtils';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface TaskCompletionSummary extends TaskPathInfo {
  completedAt: number;
  difficulty: Difficulty;
  xp: number;
  note?: string;
}

export type XpSource = 'task' | 'achievement' | 'bonus' | 'manual';

export interface XPEntry {
  id: string;
  amount: number;
  source: XpSource;
  note?: string;
  taskId?: string;
  achievementId?: string;
  ts: number;
}

export interface LevelUpEvent {
  level: number;
  totalXp: number;
  completions: TaskCompletionSummary[];
  triggeredAt: number;
}

export interface LevelTitleInfo {
  title: string;
  assignedAt: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  imageUrl?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface ClaimedBonusInfo {
  xp: number;
  ts: number;
}

export interface GamificationState {
  xp: number;
  level: number;
  xpHistory: XPEntry[];
  completions: TaskCompletionSummary[];
  processedTasks: Record<string, boolean>;
  achievements: Achievement[];
  levelTitles: Record<number, LevelTitleInfo>;
  claimedBonuses: Record<string, ClaimedBonusInfo>;
  pendingLevelUps: LevelUpEvent[];
  registerTaskCompletion: (info: TaskPathInfo, xp: number, difficulty: Difficulty, note?: string, completedAt?: number) => void;
  ignoreTaskCompletion: (taskId: string) => void;
  addXp: (entry: { amount: number; source: XpSource; note?: string; taskId?: string; achievementId?: string; ts?: number }) => void;
  assignLevelTitle: (level: number, title: string) => void;
  clearLevelUpEvent: (level: number) => void;
  addAchievement: (input: { title: string; description: string; xpReward: number; imageUrl?: string }) => Achievement;
  updateAchievement: (achievement: Achievement) => void;
  removeAchievement: (id: string) => void;
  markBonusClaimed: (dateKey: string, xp: number) => void;
}

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const storage = createJSONStorage(() => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return memoryStorage;
});

function xpRequiredForNext(level: number): number {
  const base = 250;
  return Math.max(150, Math.round(base * Math.pow(Math.max(level, 1), 1.35) + 180));
}

export function totalXpForLevel(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += xpRequiredForNext(i);
  }
  return total;
}

export function levelForXp(totalXp: number): number {
  let level = 1;
  while (totalXp >= totalXpForLevel(level + 1)) {
    level += 1;
    if (level > 999) break;
  }
  return level;
}

export function progressWithinLevel(totalXp: number, level: number): { current: number; required: number } {
  const base = totalXpForLevel(level);
  const next = totalXpForLevel(level + 1);
  return { current: Math.max(0, totalXp - base), required: Math.max(1, next - base) };
}

function clampXp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

const MAX_HISTORY = 200;
const MAX_COMPLETIONS = 200;

export const useGamificationStore = create<GamificationState>()(
  persist(
    (set, get) => ({
      xp: 0,
      level: 1,
      xpHistory: [],
      completions: [],
      processedTasks: {},
      achievements: [],
      levelTitles: { 1: { title: 'Новичок', assignedAt: Date.now() } },
      claimedBonuses: {},
      pendingLevelUps: [],
      registerTaskCompletion: (info, amount, difficulty, note, completedAt) => {
        const xp = clampXp(amount);
        const summary: TaskCompletionSummary = {
          ...info,
          completedAt: completedAt ?? Date.now(),
          difficulty,
          xp,
          note,
        };
        set((state) => ({
          completions: [...state.completions, summary].slice(-MAX_COMPLETIONS),
          processedTasks: { ...state.processedTasks, [info.id]: true },
        }));
        if (xp > 0) {
          get().addXp({ amount: xp, source: 'task', note: note || info.title, taskId: info.id, ts: summary.completedAt });
        }
      },
      ignoreTaskCompletion: (taskId) => {
        set((state) => ({
          processedTasks: { ...state.processedTasks, [taskId]: true },
        }));
      },
      addXp: ({ amount, source, note, taskId, achievementId, ts }) => {
        const xpToAdd = clampXp(amount);
        if (xpToAdd <= 0) return;
        set((state) => {
          const nextXp = state.xp + xpToAdd;
          const history: XPEntry[] = [...state.xpHistory, {
            id: uuidv4(),
            amount: xpToAdd,
            source,
            note,
            taskId,
            achievementId,
            ts: ts ?? Date.now(),
          }].slice(-MAX_HISTORY);
          let nextLevel = state.level;
          const pending = [...state.pendingLevelUps];
          const titles = { ...state.levelTitles };
          while (nextXp >= totalXpForLevel(nextLevel + 1)) {
            nextLevel += 1;
            const completions = state.completions.slice(-8);
            pending.push({ level: nextLevel, totalXp: nextXp, completions, triggeredAt: Date.now() });
            if (!titles[nextLevel]) {
              titles[nextLevel] = { title: `Уровень ${nextLevel}`, assignedAt: Date.now() };
            }
          }
          return {
            xp: nextXp,
            level: nextLevel,
            xpHistory: history,
            pendingLevelUps: pending,
            levelTitles: titles,
          };
        });
      },
      assignLevelTitle: (level, title) => {
        set((state) => ({
          levelTitles: { ...state.levelTitles, [level]: { title, assignedAt: Date.now() } },
          pendingLevelUps: state.pendingLevelUps.filter((evt) => evt.level !== level),
        }));
      },
      clearLevelUpEvent: (level) => {
        set((state) => ({
          pendingLevelUps: state.pendingLevelUps.filter((evt) => evt.level !== level),
        }));
      },
      addAchievement: ({ title, description, xpReward, imageUrl }) => {
        const achievement: Achievement = {
          id: uuidv4(),
          title,
          description,
          xpReward: clampXp(xpReward),
          imageUrl,
          createdAt: Date.now(),
        };
        set((state) => ({ achievements: [...state.achievements, achievement] }));
        if (achievement.xpReward > 0) {
          get().addXp({ amount: achievement.xpReward, source: 'achievement', note: title, achievementId: achievement.id });
        }
        return achievement;
      },
      updateAchievement: (achievement) => {
        set((state) => ({
          achievements: state.achievements.map((a) => (a.id === achievement.id ? { ...achievement, updatedAt: Date.now() } : a)),
        }));
      },
      removeAchievement: (id) => {
        set((state) => ({ achievements: state.achievements.filter((a) => a.id !== id) }));
      },
      markBonusClaimed: (dateKey, xp) => {
        const bonusXp = clampXp(xp);
        set((state) => ({
          claimedBonuses: { ...state.claimedBonuses, [dateKey]: { xp: bonusXp, ts: Date.now() } },
        }));
        if (bonusXp > 0) {
          get().addXp({ amount: bonusXp, source: 'bonus', note: `Бонус за ${dateKey}` });
        }
      },
    }),
    {
      name: 'GAMIFICATION_STATE_V1',
      storage,
      partialize: (state) => ({
        xp: state.xp,
        level: state.level,
        xpHistory: state.xpHistory,
        completions: state.completions,
        processedTasks: state.processedTasks,
        achievements: state.achievements,
        levelTitles: state.levelTitles,
        claimedBonuses: state.claimedBonuses,
        pendingLevelUps: state.pendingLevelUps,
      }),
    }
  )
);

