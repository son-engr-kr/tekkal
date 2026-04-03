import { useState, useRef, useEffect, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { runPipeline, type PipelineCallbacks, type PlanResult } from "@/ai/pipeline";
import { getApiKey, setApiKey, clearApiKey, getAgentModels, setAgentModel, AVAILABLE_MODELS, type AgentRole } from "@/ai/geminiClient";

export function AiChatPanel() {
  const [input, setInput] = useState("");
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const currentStage = useChatStore((s) => s.currentStage);
  const pendingApproval = useChatStore((s) => s.pendingApproval);
  const logs = useChatStore((s) => s.logs);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // API key state
  const [hasKey, setHasKey] = useState(() => !!getApiKey());
  const [keyInput, setKeyInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [agentModels, setAgentModels] = useState(getAgentModels);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, logs]);

  const handleSaveKey = () => {
    if (keyInput.trim()) {
      setApiKey(keyInput.trim());
      setHasKey(true);
      setKeyInput("");
    }
  };

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isProcessing) return;
    setInput("");

    const { addMessage, setProcessing, setCurrentStage, setPendingApproval, addLog, clearLogs } =
      useChatStore.getState();

    addMessage("user", text);
    setProcessing(true);
    clearLogs();

    const callbacks: PipelineCallbacks = {
      onStageChange: (stage) => {
        setCurrentStage(stage);
      },
      onLog: (message) => {
        addLog(message);
      },
      onPlanReady: (plan: PlanResult) => {
        return new Promise<boolean>((resolve) => {
          addMessage("assistant", formatPlan(plan), "plan");
          setPendingApproval({ plan, resolve });
        });
      },
      onComplete: (summary) => {
        addMessage("assistant", summary);
        setProcessing(false);
        setCurrentStage(null);
      },
      onError: (error) => {
        addMessage("system", `Error: ${error}`);
        setProcessing(false);
        setCurrentStage(null);
      },
    };

    await runPipeline(text, callbacks);
  }, [input, isProcessing]);

  const handleApprove = (approved: boolean) => {
    const { pendingApproval, setPendingApproval, addMessage } = useChatStore.getState();
    if (pendingApproval) {
      addMessage("user", approved ? "Approved" : "Rejected");
      pendingApproval.resolve(approved);
      setPendingApproval(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // API key setup screen
  if (!hasKey) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-4 text-zinc-400">
        <div className="text-sm font-medium text-zinc-300">Gemini API Key</div>
        <p className="text-xs text-center">
          Enter your Gemini API key to enable AI features.
          <br />
          Stored in browser localStorage only.
        </p>
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
          placeholder="AIza..."
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleSaveKey}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 transition-colors"
        >
          Save Key
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-300">AI Chat</span>
          {currentStage && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">
              {stageLabel(currentStage)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className={`text-[10px] transition-colors ${showSettings ? "text-blue-400" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Settings
          </button>
          <button
            onClick={() => useChatStore.getState().clearMessages()}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="border-b border-zinc-800 px-3 py-2 space-y-2 bg-zinc-900/50">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Agent Models</div>
          {(["planner", "generator", "reviewer", "writer"] as AgentRole[]).map((role) => (
            <div key={role} className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-400 w-16 capitalize">{role}</span>
              <select
                value={agentModels[role]}
                onChange={(e) => {
                  setAgentModel(role, e.target.value);
                  setAgentModels(getAgentModels());
                }}
                className="flex-1 text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-zinc-200 focus:outline-none focus:border-blue-500"
              >
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-zinc-400 w-16">API Key</span>
            <button
              onClick={() => { clearApiKey(); setHasKey(false); }}
              className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
            >
              Reset Key
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && (
          <div className="text-xs text-zinc-500 text-center mt-8">
            Ask me to create slides, modify content, write speaker notes, or review your deck.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-xs leading-relaxed ${
              msg.role === "user"
                ? "text-zinc-200 bg-zinc-800 rounded-lg px-3 py-2 ml-8"
                : msg.role === "system"
                  ? "text-red-400 bg-red-950/30 rounded-lg px-3 py-2"
                  : "text-zinc-300 bg-zinc-900 rounded-lg px-3 py-2 mr-8"
            }`}
          >
            <div className="whitespace-pre-wrap">{msg.content}</div>
            {msg.stage && (
              <div className="text-[10px] text-zinc-500 mt-1">
                Stage: {stageLabel(msg.stage)}
              </div>
            )}
          </div>
        ))}

        {/* Live logs */}
        {isProcessing && logs.length > 0 && (
          <div className="text-[10px] text-zinc-500 bg-zinc-900/50 rounded px-2 py-1.5 space-y-0.5">
            {logs.slice(-5).map((log, i) => (
              <div key={i} className="truncate">{log}</div>
            ))}
          </div>
        )}

        {/* Approval gate */}
        {pendingApproval && (
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => handleApprove(true)}
              className="flex-1 text-xs py-1.5 bg-green-600 text-white rounded hover:bg-green-500 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => handleApprove(false)}
              className="flex-1 text-xs py-1.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 transition-colors"
            >
              Reject
            </button>
          </div>
        )}

        {/* Processing indicator */}
        {isProcessing && !pendingApproval && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Processing...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 px-3 py-2">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI..."
            disabled={isProcessing}
            rows={1}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-200 resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={isProcessing || !input.trim()}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "plan": return "Planning";
    case "generate": return "Generating";
    case "review": return "Reviewing";
    case "notes": return "Writing Notes";
    default: return stage;
  }
}

function formatPlan(plan: PlanResult): string {
  if (plan.intent === "modify") {
    return `**Plan: Modify Deck**\n\n${plan.actions?.map((a, i) => `${i + 1}. ${a}`).join("\n") ?? plan.reasoning}\n\nApprove to proceed?`;
  }
  if (!plan.plan) return plan.reasoning;

  const lines = [
    `**Plan: ${plan.plan.topic}**`,
    `Audience: ${plan.plan.audience} | Slides: ${plan.plan.slideCount}`,
    "",
    ...plan.plan.slides.map(
      (s, i) =>
        `${i + 1}. **${s.title}** (${s.type})\n   ${s.keyPoints.join(" · ")}`,
    ),
    "",
    "Approve to generate?",
  ];
  return lines.join("\n");
}
