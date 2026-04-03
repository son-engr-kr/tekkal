import { GoogleGenerativeAI, type Content, type Part, type Tool, type FunctionDeclaration, SchemaType } from "@google/generative-ai";

const STORAGE_KEY = "deckode:gemini-api-key";

export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = getApiKey();
  assert(key, "Gemini API key not set");
  if (!_client || (_client as unknown as { apiKey: string }).apiKey !== key) {
    _client = new GoogleGenerativeAI(key);
  }
  return _client;
}

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) throw new Error(msg);
}

export type GeminiModel = string;

// -- Agent model configuration (persisted in localStorage) --

export const AVAILABLE_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-3-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro",
] as const;

export type AgentRole = "planner" | "generator" | "reviewer" | "writer";

export const DEFAULT_AGENT_MODELS: Record<AgentRole, string> = {
  planner: "gemini-2.0-flash",
  generator: "gemini-2.5-pro",
  reviewer: "gemini-2.0-flash",
  writer: "gemini-2.5-pro",
};

const MODELS_STORAGE_KEY = "deckode:agent-models";

export function getAgentModels(): Record<AgentRole, string> {
  const raw = localStorage.getItem(MODELS_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_AGENT_MODELS };
  try {
    return { ...DEFAULT_AGENT_MODELS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_AGENT_MODELS };
  }
}

export function setAgentModel(role: AgentRole, model: string): void {
  const current = getAgentModels();
  current[role] = model;
  localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(current));
}

export function getModelForAgent(role: AgentRole): string {
  return getAgentModels()[role];
}

export interface ChatMessage {
  role: "user" | "model";
  parts: Part[];
}

export interface GeminiCallOptions {
  model: GeminiModel;
  systemInstruction: string;
  history?: Content[];
  tools?: Tool[];
  message: string;
  onStream?: (chunk: string) => void;
}

export interface GeminiResponse {
  text: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

export async function callGemini(opts: GeminiCallOptions): Promise<GeminiResponse> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: opts.model,
    systemInstruction: opts.systemInstruction,
    tools: opts.tools,
  });

  const chat = model.startChat({
    history: opts.history ?? [],
  });

  const result = await chat.sendMessage(opts.message);
  const response = result.response;

  const functionCalls = response.functionCalls() ?? [];
  const text = response.text?.() ?? "";

  return {
    text,
    functionCalls: functionCalls.map((fc) => ({
      name: fc.name,
      args: fc.args as Record<string, unknown>,
    })),
  };
}

export async function callGeminiStream(opts: GeminiCallOptions): Promise<GeminiResponse> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: opts.model,
    systemInstruction: opts.systemInstruction,
    tools: opts.tools,
  });

  const chat = model.startChat({
    history: opts.history ?? [],
  });

  const result = await chat.sendMessageStream(opts.message);

  let fullText = "";
  const allFunctionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for await (const chunk of result.stream) {
    const chunkText = chunk.text?.() ?? "";
    if (chunkText && opts.onStream) {
      opts.onStream(chunkText);
    }
    fullText += chunkText;

    const fcs = chunk.functionCalls?.() ?? [];
    for (const fc of fcs) {
      allFunctionCalls.push({
        name: fc.name,
        args: fc.args as Record<string, unknown>,
      });
    }
  }

  return { text: fullText, functionCalls: allFunctionCalls };
}

export function buildFunctionDeclarations(tools: DeckodeTool[]): Tool[] {
  const declarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  })) as unknown as FunctionDeclaration[];
  return [{ functionDeclarations: declarations }];
}

export interface DeckodeTool {
  name: string;
  description: string;
  parameters: {
    type: SchemaType;
    properties: Record<string, unknown>;
    required?: string[];
  };
}
