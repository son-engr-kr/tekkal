import { create } from "zustand";
import type { PlanResult } from "@/ai/pipeline";

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  stage?: string;
}

export interface PendingApproval {
  plan: PlanResult;
  resolve: (approved: boolean) => void;
}

interface ChatState {
  messages: ChatMessage[];
  isProcessing: boolean;
  currentStage: string | null;
  pendingApproval: PendingApproval | null;
  logs: string[];

  addMessage: (role: MessageRole, content: string, stage?: string) => void;
  setProcessing: (processing: boolean) => void;
  setCurrentStage: (stage: string | null) => void;
  setPendingApproval: (approval: PendingApproval | null) => void;
  addLog: (log: string) => void;
  clearLogs: () => void;
  clearMessages: () => void;
}

let _messageCounter = 0;

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  isProcessing: false,
  currentStage: null,
  pendingApproval: null,
  logs: [],

  addMessage: (role, content, stage) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: `msg-${++_messageCounter}`,
          role,
          content,
          timestamp: Date.now(),
          stage,
        },
      ],
    })),

  setProcessing: (processing) => set({ isProcessing: processing }),

  setCurrentStage: (stage) => set({ currentStage: stage }),

  setPendingApproval: (approval) => set({ pendingApproval: approval }),

  addLog: (log) =>
    set((state) => ({
      logs: [...state.logs, log],
    })),

  clearLogs: () => set({ logs: [] }),

  clearMessages: () => set({ messages: [], logs: [] }),
}));
